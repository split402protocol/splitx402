import type { Express } from "express";
import {
  buildReferralClaimSigningBytes,
  createSampleProtocolArtifacts,
  deriveEd25519PublicKey,
  hexToBytes,
  signEd25519Message,
  type ReferralClaimV1
} from "@split402/protocol";
import request from "supertest";
import { describe, expect, it } from "vitest";

import {
  buildCampaignTermsSigningBytes,
  InMemoryCampaignRegistry,
  InMemoryMerchantRegistry,
  InMemoryReceiptIngestionStore,
  InMemoryRouteRegistry,
  InMemoryWalletAuthStore,
  ReceiptIngestor,
  WalletAuthenticator,
  createControlPlaneApp,
  type CampaignVersionRecord,
  type CampaignTermsInput,
  type MerchantFundingBalanceProvider,
  type OutboxEventRecord,
  type PayoutFundingBalance,
  type PayoutFinalityMonitor,
  type PayoutReconciliationFinalityResult,
  type RouteDraft,
  type UnsignedReferralClaim,
  type RequeueDeadLetterWebhookEventInput,
  type WebhookEventManagementStore,
  WebhookEventRequeueConflictError
} from "../src/index.js";

const OWNER_SEED = hexToBytes(
  "a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf"
);
const OTHER_OWNER_SEED = hexToBytes(
  "c0c1c2c3c4c5c6c7c8c9cacbcccdcecfd0d1d2d3d4d5d6d7d8d9dadbdcdddedf"
);
const MERCHANT_SEED = hexToBytes(
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
);
const REFERRER_SEED = hexToBytes(
  "202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f"
);
const PAYOUT_SEED = hexToBytes(
  "404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f"
);
const ROTATED_PAYOUT_SEED = hexToBytes(
  "606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f"
);
const OWNER_WALLET = deriveEd25519PublicKey(OWNER_SEED);
const OTHER_OWNER_WALLET = deriveEd25519PublicKey(OTHER_OWNER_SEED);
const REFERRER_WALLET = deriveEd25519PublicKey(REFERRER_SEED);
const PAYOUT_WALLET = deriveEd25519PublicKey(PAYOUT_SEED);
const ROTATED_PAYOUT_WALLET = deriveEd25519PublicKey(ROTATED_PAYOUT_SEED);
const NETWORK = "solana:devnet";

describe("control-plane HTTP API", () => {
  it("exposes a current public-alpha health endpoint", async () => {
    const { app } = createTestApp();

    const response = await request(app).get("/v1/health").expect(200);

    expect(response.body).toEqual({
      status: "ok",
      service: "split402-control-plane",
      phase: "phase-6",
      releaseStage: "public-alpha"
    });
  });

  it("rate limits control-plane requests when configured", async () => {
    const { app } = createTestApp({
      rateLimitWindowMs: 60_000,
      rateLimitMaxRequests: 1
    });

    await request(app).get("/v1/health").expect(200);
    await request(app).get("/v1/health").expect(429);
  });

  it("accepts a public receipt submission", async () => {
    const { app, store, receipt } = createTestApp();

    const response = await request(app)
      .post("/v1/receipts")
      .send({
        receipt,
        source: "buyer"
      })
      .expect(201);

    expect(response.body).toEqual(
      expect.objectContaining({
        status: "created",
        statusCode: 201
      })
    );
    expect(response.body.receipt).toEqual(
      expect.objectContaining({
        id: receipt.receiptId,
        source: "buyer",
        verificationState: "pending_chain_verification"
      })
    );
    expect(response.body.accrual).toEqual(
      expect.objectContaining({
        receiptId: receipt.receiptId,
        amountAtomic: receipt.referrerCreditAtomic
      })
    );
    expect(store.listAccruals()).toHaveLength(1);
  });

  it("returns duplicate instead of creating a second accrual", async () => {
    const { app, store, receipt } = createTestApp();

    await request(app).post("/v1/receipts").send({ receipt }).expect(201);
    const response = await request(app)
      .post("/v1/receipts")
      .send({ receipt })
      .expect(200);

    expect(response.body.status).toBe("duplicate");
    expect(store.listAccruals()).toHaveLength(1);
  });

  it("previews available merchant payout accruals", async () => {
    const { app, store, receipt } = createTestApp({ withPayouts: true });

    await request(app).post("/v1/receipts").send({ receipt }).expect(201);
    const snapshot = store.getByReceiptId(receipt.receiptId);
    if (snapshot?.accrual === undefined) {
      throw new Error("expected receipt accrual");
    }
    store.save({
      ...snapshot,
      receipt: {
        ...snapshot.receipt,
        verificationState: "signature_verified"
      },
      accrual: {
        ...snapshot.accrual,
        status: "available",
        availableAt: "2026-06-24T00:04:00.000Z"
      }
    });

    const response = await request(app)
      .post(`/v1/merchants/${receipt.merchantId}/payouts/preview`)
      .send({
        now: "2026-06-24T00:05:00Z",
        fundingBalances: [{ asset: receipt.asset, amountAtomic: "1000" }]
      })
      .expect(200);

    expect(response.body.preview).toEqual(
      expect.objectContaining({
        merchantId: receipt.merchantId,
        eligibleAccrualCount: 1,
        totalAmountAtomicByAsset: { [receipt.asset]: receipt.referrerCreditAtomic }
      })
    );
    expect(response.body.preview.batches).toEqual([
      expect.objectContaining({
        asset: receipt.asset,
        totalAmountAtomic: receipt.referrerCreditAtomic,
        fundingStatus: "deficit",
        fundingDeficitAtomic: "800",
        items: [
          expect.objectContaining({
            destinationWallet: receipt.payoutWallet,
            amountAtomic: receipt.referrerCreditAtomic,
            accrualIds: [snapshot.accrual.id]
          })
        ]
      })
    ]);
  });

  it("summarizes merchant payout obligations for dashboard funding views", async () => {
    const { app, store, receipt, merchantRegistry } = createTestApp({
      withMerchantRegistry: true,
      withPayouts: true
    });
    if (merchantRegistry === undefined) {
      throw new Error("expected merchant registry");
    }
    await request(app)
      .post("/v1/merchants")
      .send({
        id: receipt.merchantId,
        slug: "obligation-merchant",
        displayName: "Obligation Merchant",
        ownerWallet: receipt.payerWallet
      })
      .expect(201);
    await request(app).post("/v1/receipts").send({ receipt }).expect(201);
    const snapshot = store.getByReceiptId(receipt.receiptId);
    if (snapshot?.accrual === undefined) {
      throw new Error("expected receipt accrual");
    }
    store.save({
      ...snapshot,
      receipt: {
        ...snapshot.receipt,
        verificationState: "signature_verified"
      },
      accrual: {
        ...snapshot.accrual,
        status: "available",
        availableAt: "2026-06-24T00:04:00.000Z"
      }
    });

    const response = await request(app)
      .get(`/v1/merchants/${receipt.merchantId}/payout-obligations`)
      .expect(200);

    expect(response.body.summary).toEqual(
      expect.objectContaining({
        schema: "split402.merchant_obligation_summary.v1",
        merchantId: receipt.merchantId,
        assets: [
          expect.objectContaining({
            asset: receipt.asset,
            fundingStatus: "unknown",
            availableAmountAtomic: receipt.referrerCreditAtomic,
            outstandingAmountAtomic: receipt.referrerCreditAtomic,
            totalAccruedAmountAtomic: receipt.referrerCreditAtomic,
            availableAccrualCount: 1
          })
        ]
      })
    );
  });

  it("includes live merchant funding balances in payout obligations", async () => {
    const fundingProvider = new FakeMerchantFundingBalanceProvider([
      { asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amountAtomic: "2500" }
    ]);
    const { app, store, receipt, merchantRegistry } = createTestApp({
      withMerchantRegistry: true,
      withPayouts: true,
      merchantFundingBalanceProvider: fundingProvider
    });
    if (merchantRegistry === undefined) {
      throw new Error("expected merchant registry");
    }
    await request(app)
      .post("/v1/merchants")
      .send({
        id: receipt.merchantId,
        slug: "funding-merchant",
        displayName: "Funding Merchant",
        ownerWallet: receipt.payerWallet
      })
      .expect(201);
    await request(app)
      .post(`/v1/merchants/${receipt.merchantId}/payout-wallets`)
      .send({
        id: "mpw_ffffffffffffffffffffffffffffffff",
        network: receipt.network,
        wallet: receipt.payToWallet,
        asset: receipt.asset,
        signerReference: "kms:split402-devnet-payout"
      })
      .expect(201);
    await request(app).post("/v1/receipts").send({ receipt }).expect(201);
    const snapshot = store.getByReceiptId(receipt.receiptId);
    if (snapshot?.accrual === undefined) {
      throw new Error("expected receipt accrual");
    }
    store.save({
      ...snapshot,
      receipt: {
        ...snapshot.receipt,
        verificationState: "signature_verified"
      },
      accrual: {
        ...snapshot.accrual,
        status: "available",
        availableAt: "2026-06-24T00:04:00.000Z"
      }
    });

    const response = await request(app)
      .get(`/v1/merchants/${receipt.merchantId}/payout-obligations`)
      .expect(200);

    expect(fundingProvider.inputs).toEqual([
      expect.objectContaining({
        merchantId: receipt.merchantId,
        payoutWallets: [
          expect.objectContaining({
            id: "mpw_ffffffffffffffffffffffffffffffff",
            asset: receipt.asset
          })
        ]
      })
    ]);
    expect(response.body.summary.assets[0]).toEqual(
      expect.objectContaining({
        fundingStatus: "covered",
        fundingAmountAtomic: "2500",
        fundingDeficitAtomic: "0",
        outstandingAmountAtomic: receipt.referrerCreditAtomic
      })
    );
  });

  it("creates a planned payout batch and marks selected accruals allocated", async () => {
    const { app, store, receipt, merchantRegistry } = createTestApp({
      withMerchantRegistry: true,
      withPayouts: true
    });
    if (merchantRegistry === undefined) {
      throw new Error("expected merchant registry");
    }
    await request(app)
      .post("/v1/merchants")
      .send({
        id: receipt.merchantId,
        slug: "batch-merchant",
        displayName: "Batch Merchant",
        ownerWallet: receipt.payerWallet
      })
      .expect(201);
    await request(app)
      .post(`/v1/merchants/${receipt.merchantId}/payout-wallets`)
      .send({
        id: "mpw_ffffffffffffffffffffffffffffffff",
        network: receipt.network,
        wallet: receipt.payToWallet,
        asset: receipt.asset,
        signerReference: "kms:split402-devnet-payout"
      })
      .expect(201);
    await request(app).post("/v1/receipts").send({ receipt }).expect(201);
    const snapshot = store.getByReceiptId(receipt.receiptId);
    if (snapshot?.accrual === undefined) {
      throw new Error("expected receipt accrual");
    }
    store.save({
      ...snapshot,
      receipt: {
        ...snapshot.receipt,
        verificationState: "signature_verified"
      },
      accrual: {
        ...snapshot.accrual,
        status: "available",
        availableAt: "2026-06-24T00:04:00.000Z"
      }
    });

    const response = await request(app)
      .post(`/v1/merchants/${receipt.merchantId}/payout-batches`)
      .send({
        payoutWalletId: "mpw_ffffffffffffffffffffffffffffffff",
        now: "2026-06-24T00:05:00Z"
      })
      .expect(201);

    expect(response.body.batch).toEqual(
      expect.objectContaining({
        merchantId: receipt.merchantId,
        payoutWalletId: "mpw_ffffffffffffffffffffffffffffffff",
        network: receipt.network,
        asset: receipt.asset,
        status: "planned",
        totalAmountAtomic: receipt.referrerCreditAtomic,
        itemCount: 1,
        accrualCount: 1
      })
    );
    expect(response.body.batch.items).toEqual([
      expect.objectContaining({
        destinationWallet: receipt.payoutWallet,
        amountAtomic: receipt.referrerCreditAtomic,
        status: "allocated",
        allocations: [
          expect.objectContaining({
            accrualId: snapshot.accrual.id,
            amountAtomic: receipt.referrerCreditAtomic
          })
        ]
      })
    ]);
    expect(store.getByReceiptId(receipt.receiptId)?.accrual?.status).toBe(
      "allocated"
    );
    expect(
      store.listPayoutEligibleAccruals({
        merchantId: receipt.merchantId,
        asset: receipt.asset,
        now: "2026-06-24T00:05:00Z"
      })
    ).toHaveLength(0);
  });

  it("releases planned payout batch allocations", async () => {
    const { app, store, receipt, merchantRegistry } = createTestApp({
      withMerchantRegistry: true,
      withPayouts: true
    });
    if (merchantRegistry === undefined) {
      throw new Error("expected merchant registry");
    }
    await request(app)
      .post("/v1/merchants")
      .send({
        id: receipt.merchantId,
        slug: "release-merchant",
        displayName: "Release Merchant",
        ownerWallet: receipt.payerWallet
      })
      .expect(201);
    await request(app)
      .post(`/v1/merchants/${receipt.merchantId}/payout-wallets`)
      .send({
        id: "mpw_ffffffffffffffffffffffffffffffff",
        network: receipt.network,
        wallet: receipt.payToWallet,
        asset: receipt.asset,
        signerReference: "kms:split402-devnet-payout"
      })
      .expect(201);
    await request(app).post("/v1/receipts").send({ receipt }).expect(201);
    const snapshot = store.getByReceiptId(receipt.receiptId);
    if (snapshot?.accrual === undefined) {
      throw new Error("expected receipt accrual");
    }
    store.save({
      ...snapshot,
      receipt: {
        ...snapshot.receipt,
        verificationState: "signature_verified"
      },
      accrual: {
        ...snapshot.accrual,
        status: "available",
        availableAt: "2026-06-24T00:04:00.000Z"
      }
    });
    const availableAccrual = store.getByReceiptId(receipt.receiptId)?.accrual;
    if (availableAccrual === undefined) {
      throw new Error("expected available accrual");
    }
    const batch = store.createPayoutBatch({
      merchantId: receipt.merchantId,
      payoutWalletId: "mpw_ffffffffffffffffffffffffffffffff",
      network: receipt.network,
      asset: receipt.asset,
      accruals: [availableAccrual],
      now: "2026-06-24T00:05:00Z"
    });

    const response = await request(app)
      .post(`/v1/payout-batches/${batch.id}/release-allocations`)
      .send({
        reason: "signer policy failed",
        now: "2026-06-24T00:06:00Z"
      })
      .expect(200);

    expect(response.body.batch).toEqual(
      expect.objectContaining({
        id: batch.id,
        status: "cancelled",
        failureCode: "allocations_released",
        failureMessage: "signer policy failed",
        updatedAt: "2026-06-24T00:06:00.000Z"
      })
    );
    expect(response.body.batch.items[0]).toEqual(
      expect.objectContaining({ status: "released" })
    );
    expect(store.getByReceiptId(receipt.receiptId)?.accrual?.status).toBe(
      "available"
    );
    expect(
      store.listPayoutEligibleAccruals({
        merchantId: receipt.merchantId,
        asset: receipt.asset,
        now: "2026-06-24T00:06:00Z"
      })
    ).toHaveLength(1);
  });

  it("blocks releasing allocations when signed transactions may already be broadcast", async () => {
    const { app, store, receipt, batch, transaction } =
      await createMaybeBroadcastPayoutBatchFixture();

    const response = await request(app)
      .post(`/v1/payout-batches/${batch.id}/release-allocations`)
      .send({ reason: "broadcast timed out", now: "2026-06-24T00:07:00Z" })
      .expect(409);

    expect(response.body).toEqual(
      expect.objectContaining({
        error: "payout_batch_release_blocked",
        hazards: [
          expect.objectContaining({
            transactionId: transaction.id,
            status: "signed",
            expectedSignature: "expected_sig_0"
          })
        ]
      })
    );
    expect(store.getByReceiptId(receipt.receiptId)?.accrual?.status).toBe(
      "allocated"
    );
    expect(store.getPayoutBatch(batch.id)?.status).toBe("planned");
  });

  it("releases allocations after the chain proves the signed transaction expired", async () => {
    const monitor = new FakePayoutFinalityMonitor([
      {
        transactionId: "ignored-by-fake",
        status: "expired",
        signature: "expected_sig_0",
        rpcUrl: "https://rpc.example",
        error: "payout transaction blockhash expired"
      }
    ]);
    const { app, store, receipt, batch, transaction } =
      await createMaybeBroadcastPayoutBatchFixture({
        payoutFinalityMonitor: monitor
      });

    const response = await request(app)
      .post(`/v1/payout-batches/${batch.id}/release-allocations`)
      .send({ reason: "broadcast timed out", now: "2026-06-24T00:07:00Z" })
      .expect(200);

    expect(response.body.batch).toEqual(
      expect.objectContaining({
        id: batch.id,
        status: "cancelled",
        failureCode: "allocations_released",
        failureMessage: "broadcast timed out"
      })
    );
    expect(monitor.transactions).toEqual([transaction.id]);
    expect(store.getByReceiptId(receipt.receiptId)?.accrual?.status).toBe(
      "available"
    );
    expect(store.listPayoutTransactions(batch.id)[0]?.status).toBe("signed");
  });

  it("blocks release and persists finality when the chain shows the signature landed", async () => {
    const monitor = new FakePayoutFinalityMonitor([
      {
        transactionId: "ignored-by-fake",
        status: "confirmed",
        signature: "expected_sig_0",
        rpcUrl: "https://rpc.example"
      }
    ]);
    const { app, store, receipt, batch, transaction } =
      await createMaybeBroadcastPayoutBatchFixture({
        payoutFinalityMonitor: monitor
      });

    const response = await request(app)
      .post(`/v1/payout-batches/${batch.id}/release-allocations`)
      .send({ reason: "broadcast timed out", now: "2026-06-24T00:07:00Z" })
      .expect(409);

    expect(response.body).toEqual(
      expect.objectContaining({
        error: "payout_batch_release_blocked",
        hazards: [
          expect.objectContaining({
            transactionId: transaction.id,
            chainStatus: "confirmed"
          })
        ]
      })
    );
    expect(store.listPayoutTransactions(batch.id)[0]?.status).toBe("confirmed");
    expect(store.getPayoutBatch(batch.id)?.status).toBe("confirmed");
    expect(store.getByReceiptId(receipt.receiptId)?.accrual?.status).toBe(
      "allocated"
    );
  });

  it("blocks release when the chain cannot prove the signed transaction outcome", async () => {
    const monitor = new FakePayoutFinalityMonitor([
      {
        transactionId: "ignored-by-fake",
        status: "retry",
        signature: "expected_sig_0",
        rpcUrl: "https://rpc.example",
        error: "Solana RPC request failed: timeout",
        retryAt: "2026-06-24T00:07:30.000Z"
      }
    ]);
    const { app, store, receipt, batch, transaction } =
      await createMaybeBroadcastPayoutBatchFixture({
        payoutFinalityMonitor: monitor
      });

    const response = await request(app)
      .post(`/v1/payout-batches/${batch.id}/release-allocations`)
      .send({ reason: "broadcast timed out", now: "2026-06-24T00:07:00Z" })
      .expect(409);

    expect(response.body).toEqual(
      expect.objectContaining({
        error: "payout_batch_release_blocked",
        hazards: [
          expect.objectContaining({
            transactionId: transaction.id,
            chainStatus: "retry"
          })
        ]
      })
    );
    expect(store.listPayoutTransactions(batch.id)[0]?.status).toBe("signed");
    expect(store.getByReceiptId(receipt.receiptId)?.accrual?.status).toBe(
      "allocated"
    );
  });

  it("rejects an operator override without a reason", async () => {
    const { app, store, receipt, batch } =
      await createMaybeBroadcastPayoutBatchFixture();

    await request(app)
      .post(`/v1/payout-batches/${batch.id}/release-allocations`)
      .send({
        reason: "broadcast timed out",
        now: "2026-06-24T00:07:00Z",
        override: {}
      })
      .expect(400);

    expect(store.getByReceiptId(receipt.receiptId)?.accrual?.status).toBe(
      "allocated"
    );
  });

  it("releases allocations with an explicit operator override and records the reason", async () => {
    const { app, store, receipt, batch } =
      await createMaybeBroadcastPayoutBatchFixture();

    const response = await request(app)
      .post(`/v1/payout-batches/${batch.id}/release-allocations`)
      .send({
        reason: "broadcast timed out",
        now: "2026-06-24T00:07:00Z",
        override: { reason: "operator verified no transfer landed on explorer" }
      })
      .expect(200);

    expect(response.body.batch).toEqual(
      expect.objectContaining({
        id: batch.id,
        status: "cancelled",
        failureCode: "allocations_released",
        failureMessage:
          "broadcast timed out (operator override: operator verified no transfer landed on explorer)"
      })
    );
    expect(store.getByReceiptId(receipt.receiptId)?.accrual?.status).toBe(
      "available"
    );
  });

  it("lists payout batches that need reconciliation", async () => {
    const { app, store, receipt, merchantRegistry } = createTestApp({
      withMerchantRegistry: true,
      withPayouts: true
    });
    if (merchantRegistry === undefined) {
      throw new Error("expected merchant registry");
    }
    await request(app)
      .post("/v1/merchants")
      .send({
        id: receipt.merchantId,
        slug: "reconciliation-merchant",
        displayName: "Reconciliation Merchant",
        ownerWallet: receipt.payerWallet
      })
      .expect(201);
    await request(app)
      .post(`/v1/merchants/${receipt.merchantId}/payout-wallets`)
      .send({
        id: "mpw_ffffffffffffffffffffffffffffffff",
        network: receipt.network,
        wallet: receipt.payToWallet,
        asset: receipt.asset,
        signerReference: "kms:split402-devnet-payout"
      })
      .expect(201);
    await request(app).post("/v1/receipts").send({ receipt }).expect(201);
    const snapshot = store.getByReceiptId(receipt.receiptId);
    if (snapshot?.accrual === undefined) {
      throw new Error("expected receipt accrual");
    }
    store.save({
      ...snapshot,
      receipt: {
        ...snapshot.receipt,
        verificationState: "signature_verified"
      },
      accrual: {
        ...snapshot.accrual,
        status: "available",
        availableAt: "2026-06-24T00:04:00.000Z"
      }
    });
    const availableAccrual = store.getByReceiptId(receipt.receiptId)?.accrual;
    if (availableAccrual === undefined) {
      throw new Error("expected available accrual");
    }
    const batch = store.createPayoutBatch({
      merchantId: receipt.merchantId,
      payoutWalletId: "mpw_ffffffffffffffffffffffffffffffff",
      network: receipt.network,
      asset: receipt.asset,
      accruals: [availableAccrual],
      now: "2026-06-24T00:05:00Z"
    });
    const [transaction] = store.saveSignedPayoutTransactions({
      payoutBatchId: batch.id,
      now: "2026-06-24T00:06:00Z",
      transactions: [
        {
          sequence: 0,
          signedTransactionBase64: "AQID",
          expectedSignature: "expected_sig_0"
        }
      ]
    });
    if (transaction === undefined) {
      throw new Error("expected payout transaction");
    }
    store.markPayoutTransactionSubmitted({
      id: transaction.id,
      submittedAt: "2026-06-24T00:07:00Z",
      expectedSignature: "expected_sig_0"
    });
    store.markPayoutTransactionFinality({
      id: transaction.id,
      status: "outcome_unknown",
      observedAt: "2026-06-24T00:08:00Z"
    });

    const response = await request(app)
      .get(`/v1/merchants/${receipt.merchantId}/payouts/reconciliation`)
      .query({ limit: "5", asset: receipt.asset })
      .expect(200);

    expect(response.body.items).toEqual([
      expect.objectContaining({
        reason: "outcome_unknown",
        recommendedAction: "requery_chain_before_retry",
        batch: expect.objectContaining({
          id: batch.id,
          status: "outcome_unknown"
        }),
        transactions: [
          expect.objectContaining({
            id: transaction.id,
            status: "outcome_unknown"
          })
        ]
      })
    ]);
  });

  it("reconciles outcome-unknown payout batches by requerying finality", async () => {
    const monitor = new FakePayoutFinalityMonitor([
      {
        transactionId: "ignored-by-fake",
        status: "finalized",
        signature: "expected_sig_0",
        rpcUrl: "https://rpc.example"
      }
    ]);
    const { app, store, receipt, merchantRegistry } = createTestApp({
      withMerchantRegistry: true,
      withPayouts: true,
      payoutFinalityMonitor: monitor
    });
    if (merchantRegistry === undefined) {
      throw new Error("expected merchant registry");
    }
    await request(app)
      .post("/v1/merchants")
      .send({
        id: receipt.merchantId,
        slug: "reconciliation-action-merchant",
        displayName: "Reconciliation Action Merchant",
        ownerWallet: receipt.payerWallet
      })
      .expect(201);
    await request(app).post("/v1/receipts").send({ receipt }).expect(201);
    const snapshot = store.getByReceiptId(receipt.receiptId);
    if (snapshot?.accrual === undefined) {
      throw new Error("expected receipt accrual");
    }
    store.save({
      ...snapshot,
      receipt: {
        ...snapshot.receipt,
        verificationState: "signature_verified"
      },
      accrual: {
        ...snapshot.accrual,
        status: "available",
        availableAt: "2026-06-24T00:04:00.000Z"
      }
    });
    const availableAccrual = store.getByReceiptId(receipt.receiptId)?.accrual;
    if (availableAccrual === undefined) {
      throw new Error("expected available accrual");
    }
    const batch = store.createPayoutBatch({
      merchantId: receipt.merchantId,
      payoutWalletId: "mpw_ffffffffffffffffffffffffffffffff",
      network: receipt.network,
      asset: receipt.asset,
      accruals: [availableAccrual],
      now: "2026-06-24T00:05:00Z"
    });
    const [transaction] = store.saveSignedPayoutTransactions({
      payoutBatchId: batch.id,
      now: "2026-06-24T00:06:00Z",
      transactions: [
        {
          sequence: 0,
          signedTransactionBase64: "AQID",
          expectedSignature: "expected_sig_0"
        }
      ]
    });
    if (transaction === undefined) {
      throw new Error("expected payout transaction");
    }
    store.markPayoutTransactionSubmitted({
      id: transaction.id,
      submittedAt: "2026-06-24T00:07:00Z",
      expectedSignature: "expected_sig_0"
    });
    store.markPayoutTransactionFinality({
      id: transaction.id,
      status: "outcome_unknown",
      observedAt: "2026-06-24T00:08:00Z"
    });

    const response = await request(app)
      .post(`/v1/payout-batches/${batch.id}/reconcile`)
      .send({ observedAt: "2026-06-24T00:09:00Z" })
      .expect(200);

    expect(response.body.report).toEqual(
      expect.objectContaining({
        recommendedAction: "close_ledger_if_finalized",
        retryPaymentAllowed: false,
        batchBefore: expect.objectContaining({ status: "outcome_unknown" }),
        batchAfter: expect.objectContaining({ status: "finalized" }),
        observedTransactions: [
          expect.objectContaining({
            transactionId: transaction.id,
            status: "finalized",
            signature: "expected_sig_0"
          })
        ],
        updatedTransactions: [
          expect.objectContaining({
            id: transaction.id,
            status: "finalized"
          })
        ]
      })
    );
    expect(monitor.transactions).toEqual([transaction.id]);
  });

  it("returns a payout batch with its transactions", async () => {
    const { app, store, receipt, merchantRegistry } = createTestApp({
      withMerchantRegistry: true,
      withPayouts: true
    });
    if (merchantRegistry === undefined) {
      throw new Error("expected merchant registry");
    }
    await request(app)
      .post("/v1/merchants")
      .send({
        id: receipt.merchantId,
        slug: "payout-batch-read-merchant",
        displayName: "Payout Batch Read Merchant",
        ownerWallet: receipt.payerWallet
      })
      .expect(201);
    await request(app).post("/v1/receipts").send({ receipt }).expect(201);
    const snapshot = store.getByReceiptId(receipt.receiptId);
    if (snapshot?.accrual === undefined) {
      throw new Error("expected receipt accrual");
    }
    store.save({
      ...snapshot,
      receipt: {
        ...snapshot.receipt,
        verificationState: "signature_verified"
      },
      accrual: {
        ...snapshot.accrual,
        status: "available",
        availableAt: "2026-06-24T00:04:00.000Z"
      }
    });
    const availableAccrual = store.getByReceiptId(receipt.receiptId)?.accrual;
    if (availableAccrual === undefined) {
      throw new Error("expected available accrual");
    }
    const batch = store.createPayoutBatch({
      merchantId: receipt.merchantId,
      payoutWalletId: "mpw_ffffffffffffffffffffffffffffffff",
      network: receipt.network,
      asset: receipt.asset,
      accruals: [availableAccrual],
      now: "2026-06-24T00:05:00Z"
    });
    const [transaction] = store.saveSignedPayoutTransactions({
      payoutBatchId: batch.id,
      now: "2026-06-24T00:06:00Z",
      transactions: [
        {
          sequence: 0,
          signedTransactionBase64: "AQID",
          expectedSignature: "expected_sig_0"
        }
      ]
    });
    if (transaction === undefined) {
      throw new Error("expected payout transaction");
    }
    store.markPayoutTransactionSubmitted({
      id: transaction.id,
      submittedAt: "2026-06-24T00:07:00Z",
      expectedSignature: "expected_sig_0"
    });

    const response = await request(app)
      .get(`/v1/payout-batches/${batch.id}`)
      .expect(200);

    expect(response.body.batch).toEqual(
      expect.objectContaining({
        id: batch.id,
        merchantId: receipt.merchantId,
        status: "planned",
        itemCount: 1,
        accrualCount: 1
      })
    );
    expect(response.body.transactions).toEqual([
      expect.objectContaining({
        id: transaction.id,
        status: "submitted",
        expectedSignature: "expected_sig_0",
        submittedAt: "2026-06-24T00:07:00.000Z"
      })
    ]);

    await request(app)
      .get("/v1/payout-batches/pbt_00000000000000000000000000000000")
      .expect(404);
  });

  it("shows referrer balances and payout history", async () => {
    const { app, store, receipt, merchantRegistry } = createTestApp({
      withMerchantRegistry: true,
      withPayouts: true
    });
    if (merchantRegistry === undefined) {
      throw new Error("expected merchant registry");
    }
    await request(app)
      .post("/v1/merchants")
      .send({
        id: receipt.merchantId,
        slug: "referrer-view-merchant",
        displayName: "Referrer View Merchant",
        ownerWallet: receipt.payerWallet
      })
      .expect(201);
    await request(app)
      .post(`/v1/merchants/${receipt.merchantId}/payout-wallets`)
      .send({
        id: "mpw_ffffffffffffffffffffffffffffffff",
        network: receipt.network,
        wallet: receipt.payToWallet,
        asset: receipt.asset,
        signerReference: "kms:split402-devnet-payout"
      })
      .expect(201);
    await request(app).post("/v1/receipts").send({ receipt }).expect(201);
    const snapshot = store.getByReceiptId(receipt.receiptId);
    if (snapshot?.accrual === undefined) {
      throw new Error("expected receipt accrual");
    }
    store.save({
      ...snapshot,
      receipt: {
        ...snapshot.receipt,
        verificationState: "signature_verified"
      },
      accrual: {
        ...snapshot.accrual,
        status: "available",
        availableAt: "2026-06-24T00:04:00.000Z"
      }
    });
    const availableAccrual = store.getByReceiptId(receipt.receiptId)?.accrual;
    if (availableAccrual === undefined) {
      throw new Error("expected available accrual");
    }
    const batch = store.createPayoutBatch({
      merchantId: receipt.merchantId,
      payoutWalletId: "mpw_ffffffffffffffffffffffffffffffff",
      network: receipt.network,
      asset: receipt.asset,
      accruals: [availableAccrual],
      now: "2026-06-24T00:05:00Z"
    });
    const [transaction] = store.saveSignedPayoutTransactions({
      payoutBatchId: batch.id,
      now: "2026-06-24T00:06:00Z",
      transactions: [
        {
          sequence: 0,
          signedTransactionBase64: "AQID",
          expectedSignature: "expected_sig_1"
        }
      ]
    });
    if (transaction === undefined) {
      throw new Error("expected payout transaction");
    }
    store.markPayoutTransactionFinality({
      id: transaction.id,
      status: "finalized",
      observedAt: "2026-06-24T00:08:00Z"
    });

    const balances = await request(app)
      .get(`/v1/referrers/${receipt.referrerWallet}/balances`)
      .query({ asset: receipt.asset })
      .expect(200);
    const history = await request(app)
      .get(`/v1/referrers/${receipt.referrerWallet}/payouts`)
      .query({ limit: "5" })
      .expect(200);

    expect(balances.body.summary).toEqual(
      expect.objectContaining({
        referrerWallet: receipt.referrerWallet,
        assets: [
          {
            asset: receipt.asset,
            pendingAmountAtomic: "0",
            availableAmountAtomic: "0",
            heldAmountAtomic: "0",
            inFlightAmountAtomic: "0",
            paidAmountAtomic: receipt.referrerCreditAtomic,
            totalEarnedAmountAtomic: receipt.referrerCreditAtomic
          }
        ]
      })
    );
    expect(history.body.items).toEqual([
      expect.objectContaining({
        accrualId: availableAccrual.id,
        receiptId: receipt.receiptId,
        referrerWallet: receipt.referrerWallet,
        payoutWallet: receipt.payoutWallet,
        amountAtomic: receipt.referrerCreditAtomic,
        status: "paid",
        payoutBatchId: batch.id,
        payoutStatus: "finalized"
      })
    ]);
  });

  it("rejects malformed receipt submission envelopes", async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post("/v1/receipts")
      .send({ source: "buyer" })
      .expect(400);

    expect(response.body).toEqual({
      status: "rejected",
      errors: ["request body must include receipt"]
    });
  });

  it("rejects invalid receipt source values", async () => {
    const { app, receipt } = createTestApp();

    const response = await request(app)
      .post("/v1/receipts")
      .send({
        receipt,
        source: "partner"
      })
      .expect(400);

    expect(response.body).toEqual({
      status: "rejected",
      errors: ["source must be one of buyer, merchant, relay, or unknown"]
    });
  });

  it("creates merchants, origins, service keys, payout wallets, and key revocations", async () => {
    const bundle = createSampleProtocolArtifacts();
    const { app } = createTestApp({ withMerchantRegistry: true });

    const selfApprovedMerchantResponse = await request(app)
      .post("/v1/merchants")
      .send({
        id: bundle.artifacts.receipt.merchantId,
        slug: "demo-merchant",
        displayName: "Demo Merchant",
        ownerWallet: bundle.keys.payerWallet,
        status: "active"
      })
      .expect(400);
    const merchantResponse = await request(app)
      .post("/v1/merchants")
      .send({
        id: bundle.artifacts.receipt.merchantId,
        slug: "demo-merchant",
        displayName: "Demo Merchant",
        ownerWallet: bundle.keys.payerWallet
      })
      .expect(201);
    const selfApprovedOriginResponse = await request(app)
      .post(`/v1/merchants/${bundle.artifacts.receipt.merchantId}/origins`)
      .send({
        origin: bundle.artifacts.receipt.merchantOrigin,
        verificationMethod: "well_known",
        status: "verified"
      })
      .expect(400);
    const selfVerifiedOriginResponse = await request(app)
      .post(`/v1/merchants/${bundle.artifacts.receipt.merchantId}/origins`)
      .send({
        origin: bundle.artifacts.receipt.merchantOrigin,
        verificationMethod: "well_known",
        verifiedAt: "2026-06-24T00:00:30Z"
      })
      .expect(400);
    const originResponse = await request(app)
      .post(`/v1/merchants/${bundle.artifacts.receipt.merchantId}/origins`)
      .send({
        origin: bundle.artifacts.receipt.merchantOrigin,
        verificationMethod: "well_known"
      })
      .expect(201);
    const keyResponse = await request(app)
      .post(`/v1/merchants/${bundle.artifacts.receipt.merchantId}/keys`)
      .send({
        kid: bundle.artifacts.receipt.kid,
        publicKey: bundle.keys.merchantPublicKey,
        validFrom: "2026-06-24T00:00:00Z"
      })
      .expect(201);
    await request(app)
      .post(`/v1/merchants/${bundle.artifacts.receipt.merchantId}/keys`)
      .send({
        kid: "webhook-key",
        publicKey: OTHER_OWNER_WALLET,
        purpose: "webhook",
        validFrom: "2026-06-24T00:00:00Z"
      })
      .expect(201);
    const payoutWalletResponse = await request(app)
      .post(`/v1/merchants/${bundle.artifacts.receipt.merchantId}/payout-wallets`)
      .send({
        id: "mpw_ffffffffffffffffffffffffffffffff",
        network: bundle.artifacts.receipt.network,
        wallet: bundle.keys.payToWallet,
        asset: bundle.artifacts.receipt.asset,
        signerReference: "kms:split402-devnet-payout"
      })
      .expect(201);
    const profileResponse = await request(app)
      .get(`/v1/merchants/${bundle.artifacts.receipt.merchantId}`)
      .expect(200);
    const reliabilityResponse = await request(app)
      .get(
        `/v1/merchants/${bundle.artifacts.receipt.merchantId}/reliability-profile`
      )
      .expect(200);
    const revokeResponse = await request(app)
      .post(
        `/v1/merchants/${bundle.artifacts.receipt.merchantId}/keys/${bundle.artifacts.receipt.kid}/revoke`
      )
      .send({
        revokedAt: "2026-06-24T00:02:00Z",
        reason: "rotation complete"
      })
      .expect(200);

    expect(selfApprovedMerchantResponse.body.message).toBe(
      "status is not accepted on this public endpoint"
    );
    expect(selfApprovedOriginResponse.body.message).toBe(
      "status is not accepted on this public endpoint"
    );
    expect(selfVerifiedOriginResponse.body.message).toBe(
      "verifiedAt is not accepted on this public endpoint"
    );
    expect(merchantResponse.body.merchant).toEqual(
      expect.objectContaining({
        id: bundle.artifacts.receipt.merchantId,
        status: "pending"
      })
    );
    expect(originResponse.body.origin.origin).toBe(
      bundle.artifacts.receipt.merchantOrigin
    );
    expect(originResponse.body.origin.status).toBe("pending");
    expect(keyResponse.body.key.publicKey).toBe(bundle.keys.merchantPublicKey);
    expect(payoutWalletResponse.body.payoutWallet).toEqual(
      expect.objectContaining({
        id: "mpw_ffffffffffffffffffffffffffffffff",
        network: bundle.artifacts.receipt.network,
        wallet: bundle.keys.payToWallet,
        asset: bundle.artifacts.receipt.asset,
        signerReference: "kms:split402-devnet-payout",
        status: "active"
      })
    );
    expect(profileResponse.body.merchant.origins).toHaveLength(1);
    expect(profileResponse.body.merchant.keys).toHaveLength(2);
    expect(profileResponse.body.merchant.payoutWallets).toHaveLength(1);
    expect(reliabilityResponse.body.profile).toEqual(
      expect.objectContaining({
        schema: "split402.merchant_reliability_profile.v1",
        merchant: expect.objectContaining({
          id: bundle.artifacts.receipt.merchantId,
          slug: "demo-merchant",
          displayName: "Demo Merchant",
          status: "pending"
        }),
        signals: {
          verifiedOrigins: 0,
          activeOfferReceiptKeys: 1,
          activeWebhookKeys: 1,
          activePayoutWallets: 1
        },
        readiness: {
          acceptsReceipts: false,
          payoutReady: true,
          webhookReady: true,
          discoveryReady: false
        }
      })
    );
    expect(revokeResponse.body.key.revocationReason).toBe("rotation complete");
  });

  it("returns conflicts for duplicate merchant slugs", async () => {
    const bundle = createSampleProtocolArtifacts();
    const { app } = createTestApp({ withMerchantRegistry: true });
    const merchantBody = {
      id: bundle.artifacts.receipt.merchantId,
      slug: "demo-merchant",
      displayName: "Demo Merchant",
      ownerWallet: bundle.keys.payerWallet
    };

    await request(app).post("/v1/merchants").send(merchantBody).expect(201);
    const response = await request(app)
      .post("/v1/merchants")
      .send({
        ...merchantBody,
        id: "mrc_ffffffffffffffffffffffffffffffff"
      })
      .expect(409);

    expect(response.body.error).toBe("conflict");
  });

  it("lists merchant webhook events for delivery management", async () => {
    const bundle = createSampleProtocolArtifacts();
    const webhookStore = new FakeWebhookEventManagementStore([
      createWebhookEvent({
        id: "22222222-2222-4222-8222-222222222222",
        merchantId: bundle.artifacts.receipt.merchantId,
        status: "pending",
        eventType: "webhook.receipt.accepted.v1"
      }),
      createWebhookEvent({
        id: "33333333-3333-4333-8333-333333333333",
        merchantId: bundle.artifacts.receipt.merchantId,
        status: "delivered",
        eventType: "webhook.payout.finalized.v1"
      }),
      createWebhookEvent({
        id: "44444444-4444-4444-8444-444444444444",
        merchantId: "mrc_ffffffffffffffffffffffffffffffff",
        status: "pending",
        eventType: "webhook.receipt.accepted.v1"
      })
    ]);
    const { app } = createTestApp({
      withMerchantRegistry: true,
      webhookEventManagementStore: webhookStore
    });
    await request(app)
      .post("/v1/merchants")
      .send({
        id: bundle.artifacts.receipt.merchantId,
        slug: "webhook-merchant",
        displayName: "Webhook Merchant",
        ownerWallet: bundle.keys.payerWallet
      })
      .expect(201);

    const response = await request(app)
      .get(`/v1/merchants/${bundle.artifacts.receipt.merchantId}/webhook-events`)
      .query({ status: "pending" })
      .expect(200);

    expect(response.body.events).toEqual([
      expect.objectContaining({
        id: "22222222-2222-4222-8222-222222222222",
        eventType: "webhook.receipt.accepted.v1",
        status: "pending",
        attempts: 0,
        payload: expect.objectContaining({
          merchantId: bundle.artifacts.receipt.merchantId
        })
      })
    ]);
    expect(webhookStore.inputs).toEqual([
      expect.objectContaining({
        merchantId: bundle.artifacts.receipt.merchantId,
        status: "pending",
        eventTypes: expect.arrayContaining([
          "webhook.receipt.accepted.v1",
          "webhook.payout.finalized.v1"
        ])
      })
    ]);
  });

  it("creates wallet-auth sessions and gates merchant mutations", async () => {
    const bundle = createSampleProtocolArtifacts();
    const { app } = createTestApp({
      withMerchantRegistry: true,
      withAuth: true
    });

    await request(app)
      .post("/v1/merchants")
      .send({
        id: bundle.artifacts.receipt.merchantId,
        slug: "demo-merchant",
        displayName: "Demo Merchant"
      })
      .expect(401);

    const accessToken = await createAccessToken(app, OWNER_SEED, OWNER_WALLET);
    const merchantResponse = await request(app)
      .post("/v1/merchants")
      .set("authorization", `Bearer ${accessToken}`)
      .send({
        id: bundle.artifacts.receipt.merchantId,
        slug: "demo-merchant",
        displayName: "Demo Merchant"
      })
      .expect(201);
    const originResponse = await request(app)
      .post(`/v1/merchants/${bundle.artifacts.receipt.merchantId}/origins`)
      .set("authorization", `Bearer ${accessToken}`)
      .send({
        origin: bundle.artifacts.receipt.merchantOrigin,
        verificationMethod: "well_known"
      })
      .expect(201);

    expect(merchantResponse.body.merchant.ownerWallet).toBe(OWNER_WALLET);
    expect(originResponse.body.origin.origin).toBe(
      bundle.artifacts.receipt.merchantOrigin
    );
  });

  it("refreshes wallet-auth sessions and rotates refresh tokens", async () => {
    const { app } = createTestApp({ withAuth: true });
    const challengeResponse = await request(app)
      .post("/v1/auth/challenges")
      .send({
        wallet: OWNER_WALLET,
        network: NETWORK,
        purpose: "merchant-session"
      })
      .expect(201);
    const signature = signEd25519Message(
      new TextEncoder().encode(challengeResponse.body.challenge.message as string),
      OWNER_SEED
    ).signature;
    const sessionResponse = await request(app)
      .post("/v1/auth/sessions")
      .send({
        challengeId: challengeResponse.body.challenge.challengeId,
        signature,
        publicKey: OWNER_WALLET
      })
      .expect(201);

    const refreshToken = sessionResponse.body.session.refreshToken as string;
    const refreshedResponse = await request(app)
      .post("/v1/auth/sessions/refresh")
      .send({ refreshToken })
      .expect(201);

    expect(refreshedResponse.body.session.accessToken).toMatch(/^http-token-/u);
    expect(refreshedResponse.body.session.refreshToken).toMatch(
      /^http-refresh-token-/u
    );
    expect(refreshedResponse.body.session.refreshToken).not.toBe(refreshToken);
    await request(app)
      .post("/v1/auth/sessions/refresh")
      .send({ refreshToken })
      .expect(401);
  });

  it("rejects merchant mutations from a non-owner wallet session", async () => {
    const bundle = createSampleProtocolArtifacts();
    const { app } = createTestApp({
      withMerchantRegistry: true,
      withAuth: true
    });
    const ownerToken = await createAccessToken(app, OWNER_SEED, OWNER_WALLET);
    const otherToken = await createAccessToken(
      app,
      OTHER_OWNER_SEED,
      OTHER_OWNER_WALLET
    );
    await request(app)
      .post("/v1/merchants")
      .set("authorization", `Bearer ${ownerToken}`)
      .send({
        id: bundle.artifacts.receipt.merchantId,
        slug: "demo-merchant",
        displayName: "Demo Merchant"
      })
      .expect(201);

    const response = await request(app)
      .post(`/v1/merchants/${bundle.artifacts.receipt.merchantId}/keys`)
      .set("authorization", `Bearer ${otherToken}`)
      .send({
        kid: bundle.artifacts.receipt.kid,
        publicKey: bundle.keys.merchantPublicKey
      })
      .expect(403);

    expect(response.body.error).toBe("forbidden");
  });

  it("creates campaign versions for an authenticated merchant owner", async () => {
    const bundle = createSampleProtocolArtifacts();
    const { app } = createTestApp({
      withAuth: true,
      withCampaignRegistry: true,
      withMerchantRegistry: true
    });
    const ownerToken = await createAccessToken(app, OWNER_SEED, OWNER_WALLET);
    await request(app)
      .post("/v1/merchants")
      .set("authorization", `Bearer ${ownerToken}`)
      .send({
        id: bundle.artifacts.receipt.merchantId,
        slug: "demo-merchant",
        displayName: "Demo Merchant"
      })
      .expect(201);

    await request(app)
      .post("/v1/campaigns")
      .send({
        id: bundle.artifacts.receipt.campaignId,
        merchantId: bundle.artifacts.receipt.merchantId,
        ...createCampaignBody()
      })
      .expect(401);
    const campaignResponse = await request(app)
      .post("/v1/campaigns")
      .set("authorization", `Bearer ${ownerToken}`)
      .send({
        id: bundle.artifacts.receipt.campaignId,
        merchantId: bundle.artifacts.receipt.merchantId,
        ...createCampaignBody()
      })
      .expect(201);
    const versionResponse = await request(app)
      .get(`/v1/campaigns/${bundle.artifacts.receipt.campaignId}/versions/1`)
      .expect(200);
    const nextVersionResponse = await request(app)
      .post(`/v1/campaigns/${bundle.artifacts.receipt.campaignId}/versions`)
      .set("authorization", `Bearer ${ownerToken}`)
      .send(createCampaignBody({ commissionBps: 2500 }))
      .expect(201);

    expect(campaignResponse.body.campaign.current.termsHash).toMatch(
      /^sha256:[0-9a-f]{64}$/u
    );
    expect(campaignResponse.body.campaign.current.signingBytesHex).toMatch(
      /^[0-9a-f]+$/u
    );
    expect(versionResponse.body.version.version).toBe(1);
    expect(nextVersionResponse.body.version.version).toBe(2);
    expect(nextVersionResponse.body.version.terms.commissionBps).toBe(2500);
  });

  it("activates a campaign with a merchant service-key signature", async () => {
    const bundle = createSampleProtocolArtifacts();
    const { app, merchantRegistry } = createTestApp({
      withAuth: true,
      withCampaignRegistry: true,
      withMerchantRegistry: true
    });
    const ownerToken = await createAccessToken(app, OWNER_SEED, OWNER_WALLET);
    seedMerchantFixture(merchantRegistry, { merchantStatus: "active", originStatus: "verified" });
    const campaignResponse = await request(app)
      .post("/v1/campaigns")
      .set("authorization", `Bearer ${ownerToken}`)
      .send({
        id: bundle.artifacts.receipt.campaignId,
        merchantId: bundle.artifacts.receipt.merchantId,
        ...createCampaignBody()
      })
      .expect(201);
    const currentVersion = campaignResponse.body.campaign
      .current as CampaignVersionRecord;
    const signature = signCampaignTerms(currentVersion);

    await request(app)
      .post(`/v1/campaigns/${bundle.artifacts.receipt.campaignId}/activate`)
      .set("authorization", `Bearer ${ownerToken}`)
      .send({
        kid: bundle.artifacts.receipt.kid,
        signature: mutateSignature(signature)
      })
      .expect(400);
    const activationResponse = await request(app)
      .post(`/v1/campaigns/${bundle.artifacts.receipt.campaignId}/activate`)
      .set("authorization", `Bearer ${ownerToken}`)
      .send({
        kid: bundle.artifacts.receipt.kid,
        signature
      })
      .expect(200);

    expect(activationResponse.body.campaign.status).toBe("active");
    expect(activationResponse.body.campaign.current.merchantKid).toBe(
      bundle.artifacts.receipt.kid
    );
    expect(activationResponse.body.campaign.current.merchantSignature).toBe(
      signature
    );
    expect(activationResponse.body.campaign.current.activatedAt).toBe(
      "2026-06-24T00:02:00.000Z"
    );
  });

  it("rejects campaign activation while the merchant is pending", async () => {
    const bundle = createSampleProtocolArtifacts();
    const { app, merchantRegistry } = createTestApp({
      withCampaignRegistry: true,
      withMerchantRegistry: true
    });
    seedMerchantFixture(merchantRegistry, {
      merchantStatus: "pending",
      originStatus: "verified"
    });
    const campaignResponse = await request(app)
      .post("/v1/campaigns")
      .send({
        id: bundle.artifacts.receipt.campaignId,
        merchantId: bundle.artifacts.receipt.merchantId,
        ...createCampaignBody()
      })
      .expect(201);
    const signature = signCampaignTerms(
      campaignResponse.body.campaign.current as CampaignVersionRecord
    );

    const response = await request(app)
      .post(`/v1/campaigns/${bundle.artifacts.receipt.campaignId}/activate`)
      .send({
        kid: bundle.artifacts.receipt.kid,
        signature
      })
      .expect(400);

    expect(response.body.message).toBe("merchant must be active");
  });

  it("rejects campaign activation while the origin is pending", async () => {
    const bundle = createSampleProtocolArtifacts();
    const { app, merchantRegistry } = createTestApp({
      withCampaignRegistry: true,
      withMerchantRegistry: true
    });
    seedMerchantFixture(merchantRegistry, {
      merchantStatus: "active",
      originStatus: "pending"
    });
    const campaignResponse = await request(app)
      .post("/v1/campaigns")
      .send({
        id: bundle.artifacts.receipt.campaignId,
        merchantId: bundle.artifacts.receipt.merchantId,
        ...createCampaignBody()
      })
      .expect(201);
    const signature = signCampaignTerms(
      campaignResponse.body.campaign.current as CampaignVersionRecord
    );

    const response = await request(app)
      .post(`/v1/campaigns/${bundle.artifacts.receipt.campaignId}/activate`)
      .send({
        kid: bundle.artifacts.receipt.kid,
        signature
      })
      .expect(400);

    expect(response.body.message).toBe(
      "campaign resourceOrigin must match a verified merchant origin"
    );
  });

  it("creates route drafts and activates signed route claims", async () => {
    const bundle = createSampleProtocolArtifacts();
    const { app, merchantRegistry } = createTestApp({
      withCampaignRegistry: true,
      withMerchantRegistry: true,
      withRouteRegistry: true
    });
    await createActiveCampaign({ app, merchantRegistry });

    const draftResponse = await request(app)
      .post("/v1/routes/drafts")
      .send({
        campaignId: bundle.artifacts.receipt.campaignId,
        referrerWallet: REFERRER_WALLET,
        payoutWallet: PAYOUT_WALLET,
        operationIds: [bundle.artifacts.receipt.operationId],
        expiresAt: "2026-06-25T00:00:00Z",
        nonce: "route-nonce-http-0001"
      })
      .expect(201);
    const draft = draftResponse.body.draft as RouteDraft;
    const claim = signRouteDraft(draft);

    await request(app)
      .post("/v1/routes")
      .send({
        claim: {
          ...claim,
          signature: {
            ...claim.signature,
            value: mutateSignature(claim.signature.value)
          }
        }
      })
      .expect(400);
    const routeResponse = await request(app)
      .post("/v1/routes")
      .send({ claim })
      .expect(201);
    const loadedResponse = await request(app)
      .get(`/v1/routes/${draft.routeId}`)
      .expect(200);
    const bazaarResponse = await request(app)
      .get(`/v1/routes/${draft.routeId}/bazaar-resources`)
      .expect(200);
    const dashboardResponse = await request(app)
      .get(`/v1/merchants/${bundle.artifacts.receipt.merchantId}/dashboard-summary`)
      .expect(200);

    expect(draft.claim).toEqual(
      expect.objectContaining({
        routeId: "rte_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        campaignId: bundle.artifacts.receipt.campaignId,
        operationIds: [bundle.artifacts.receipt.operationId]
      })
    );
    expect(draft.signingBytesHex).toMatch(/^[0-9a-f]+$/u);
    expect(routeResponse.body.route.status).toBe("active");
    expect(routeResponse.body.route.claimHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(loadedResponse.body.route.id).toBe(draft.routeId);
    expect(bazaarResponse.body.resources).toEqual([
      expect.objectContaining({
        schema: "split402.bazaar_resource.v1",
        resource: `${bundle.artifacts.receipt.merchantOrigin}/v1/risk`,
        type: "http",
        x402Version: 2,
        accepts: [
          {
            scheme: "exact",
            network: bundle.artifacts.receipt.network,
            amount: bundle.artifacts.receipt.requiredAmountAtomic,
            asset: bundle.artifacts.receipt.asset,
            payTo: bundle.artifacts.receipt.payToWallet
          }
        ],
        metadata: expect.objectContaining({
          method: "POST",
          operationId: bundle.artifacts.receipt.operationId,
          split402: expect.objectContaining({
            routeId: draft.routeId,
            campaignId: bundle.artifacts.receipt.campaignId,
            campaignVersion: 1,
            referrerWallet: REFERRER_WALLET,
            payoutWallet: PAYOUT_WALLET,
            commissionBps: bundle.artifacts.receipt.commissionBps,
            settlementMode: "accrual"
          })
        })
      })
    ]);
    expect(dashboardResponse.body.summary).toEqual(
      expect.objectContaining({
        schema: "split402.merchant_dashboard_summary.v1",
        merchant: expect.objectContaining({
          id: bundle.artifacts.receipt.merchantId,
          status: "active"
        }),
        campaigns: expect.objectContaining({
          total: 1,
          activeCampaignIds: [bundle.artifacts.receipt.campaignId],
          operationCount: 1
        }),
        routes: expect.objectContaining({
          total: 1,
          activeRouteIds: [draft.routeId]
        })
      })
    );
    expect(dashboardResponse.body.summary.reliability.signals).toEqual(
      expect.objectContaining({
        verifiedOrigins: 1,
        activeOfferReceiptKeys: 1
      })
    );
  });

  it("rotates route payout wallets and exposes immutable route versions", async () => {
    const bundle = createSampleProtocolArtifacts();
    const { app, merchantRegistry } = createTestApp({
      withCampaignRegistry: true,
      withMerchantRegistry: true,
      withRouteRegistry: true
    });
    await createActiveCampaign({ app, merchantRegistry });

    const draftResponse = await request(app)
      .post("/v1/routes/drafts")
      .send({
        campaignId: bundle.artifacts.receipt.campaignId,
        referrerWallet: REFERRER_WALLET,
        payoutWallet: PAYOUT_WALLET,
        operationIds: [bundle.artifacts.receipt.operationId],
        expiresAt: "2026-06-25T00:00:00Z",
        nonce: "route-nonce-http-0001"
      })
      .expect(201);
    const draft = draftResponse.body.draft as RouteDraft;
    await request(app)
      .post("/v1/routes")
      .send({ claim: signRouteDraft(draft) })
      .expect(201);

    const rotationDraftResponse = await request(app)
      .post("/v1/routes/drafts")
      .send({
        id: draft.routeId,
        campaignId: bundle.artifacts.receipt.campaignId,
        referrerWallet: REFERRER_WALLET,
        payoutWallet: ROTATED_PAYOUT_WALLET,
        operationIds: [bundle.artifacts.receipt.operationId],
        issuedAt: "2026-06-24T00:01:00Z",
        expiresAt: "2026-06-25T00:00:00Z",
        nonce: "route-nonce-http-0002"
      })
      .expect(201);
    const rotationClaim = signRouteDraft(
      rotationDraftResponse.body.draft as RouteDraft
    );

    const rotationResponse = await request(app)
      .post(`/v1/routes/${draft.routeId}/rotate-payout`)
      .send({ claim: rotationClaim })
      .expect(201);
    const versionsResponse = await request(app)
      .get(`/v1/routes/${draft.routeId}/versions`)
      .expect(200);

    expect(rotationResponse.body.route.currentVersion).toBe(2);
    expect(rotationResponse.body.route.payoutWallet).toBe(ROTATED_PAYOUT_WALLET);
    expect(
      versionsResponse.body.versions.map(
        (version: { version: number; payoutWallet: string }) => ({
          version: version.version,
          payoutWallet: version.payoutWallet
        })
      )
    ).toEqual([
      { version: 1, payoutWallet: PAYOUT_WALLET },
      { version: 2, payoutWallet: ROTATED_PAYOUT_WALLET }
    ]);
  });

  it("searches routes with query filters and status selection", async () => {
    const bundle = createSampleProtocolArtifacts();
    const { app, merchantRegistry } = createTestApp({
      withCampaignRegistry: true,
      withMerchantRegistry: true,
      withRouteRegistry: true
    });
    await createActiveCampaign({ app, merchantRegistry });

    const firstDraftResponse = await request(app)
      .post("/v1/routes/drafts")
      .send({
        campaignId: bundle.artifacts.receipt.campaignId,
        referrerWallet: REFERRER_WALLET,
        payoutWallet: PAYOUT_WALLET,
        operationIds: [bundle.artifacts.receipt.operationId],
        expiresAt: "2026-06-25T00:00:00Z",
        nonce: "route-nonce-http-0001"
      })
      .expect(201);
    const firstDraft = firstDraftResponse.body.draft as RouteDraft;
    await request(app)
      .post("/v1/routes")
      .send({ claim: signRouteDraft(firstDraft) })
      .expect(201);

    const wildcardDraftResponse = await request(app)
      .post("/v1/routes/drafts")
      .send({
        id: "rte_cccccccccccccccccccccccccccccccc",
        campaignId: bundle.artifacts.receipt.campaignId,
        referrerWallet: REFERRER_WALLET,
        payoutWallet: PAYOUT_WALLET,
        operationIds: ["*"],
        expiresAt: "2026-06-25T00:00:00Z",
        nonce: "route-nonce-http-0002"
      })
      .expect(201);
    const wildcardDraft = wildcardDraftResponse.body.draft as RouteDraft;
    await request(app)
      .post("/v1/routes")
      .send({ claim: signRouteDraft(wildcardDraft) })
      .expect(201);

    const activeSearchResponse = await request(app)
      .get("/v1/routes/search")
      .query({
        campaignId: bundle.artifacts.receipt.campaignId,
        operationId: bundle.artifacts.receipt.operationId
      })
      .expect(200);
    expect(activeSearchResponse.body.routes.map((route: { id: string }) => route.id))
      .toEqual([wildcardDraft.routeId, firstDraft.routeId]);

    await request(app)
      .post(`/v1/routes/${wildcardDraft.routeId}/suspend`)
      .expect(200);

    const defaultSearchResponse = await request(app)
      .get("/v1/routes/search")
      .query({ operationId: bundle.artifacts.receipt.operationId })
      .expect(200);
    const suspendedSearchResponse = await request(app)
      .get("/v1/routes/search")
      .query({ operationId: "unknown-operation", status: "suspended" })
      .expect(200);
    const limitedSearchResponse = await request(app)
      .get("/v1/routes/search")
      .query({ limit: "1" })
      .expect(200);

    await request(app).get("/v1/routes/search").query({ limit: "101" }).expect(400);

    expect(defaultSearchResponse.body.routes.map((route: { id: string }) => route.id))
      .toEqual([firstDraft.routeId]);
    expect(
      suspendedSearchResponse.body.routes.map((route: { id: string }) => route.id)
    ).toEqual([wildcardDraft.routeId]);
    expect(limitedSearchResponse.body.routes).toHaveLength(1);
  });

  it("lists referrer routes for dashboard and discovery views", async () => {
    const bundle = createSampleProtocolArtifacts();
    const { app, merchantRegistry } = createTestApp({
      withCampaignRegistry: true,
      withMerchantRegistry: true,
      withRouteRegistry: true
    });
    await createActiveCampaign({ app, merchantRegistry });
    const referrerDraftResponse = await request(app)
      .post("/v1/routes/drafts")
      .send({
        campaignId: bundle.artifacts.receipt.campaignId,
        referrerWallet: REFERRER_WALLET,
        payoutWallet: PAYOUT_WALLET,
        operationIds: [bundle.artifacts.receipt.operationId],
        expiresAt: "2026-06-25T00:00:00Z",
        nonce: "route-nonce-http-0001"
      })
      .expect(201);
    const otherDraftResponse = await request(app)
      .post("/v1/routes/drafts")
      .send({
        id: "rte_cccccccccccccccccccccccccccccccc",
        campaignId: bundle.artifacts.receipt.campaignId,
        referrerWallet: OTHER_OWNER_WALLET,
        payoutWallet: ROTATED_PAYOUT_WALLET,
        operationIds: [bundle.artifacts.receipt.operationId],
        expiresAt: "2026-06-25T00:00:00Z",
        nonce: "route-nonce-http-0002"
      })
      .expect(201);
    const referrerDraft = referrerDraftResponse.body.draft as RouteDraft;
    const otherDraft = otherDraftResponse.body.draft as RouteDraft;
    await request(app)
      .post("/v1/routes")
      .send({ claim: signRouteDraft(referrerDraft) })
      .expect(201);
    await request(app)
      .post("/v1/routes")
      .send({ claim: signRouteDraft(otherDraft, OTHER_OWNER_SEED) })
      .expect(201);

    const response = await request(app)
      .get(`/v1/referrers/${REFERRER_WALLET}/routes`)
      .query({
        campaignId: bundle.artifacts.receipt.campaignId,
        operationId: bundle.artifacts.receipt.operationId,
        limit: "10"
      })
      .expect(200);
    const otherResponse = await request(app)
      .get(`/v1/referrers/${OTHER_OWNER_WALLET}/routes`)
      .query({ operationId: bundle.artifacts.receipt.operationId })
      .expect(200);

    expect(response.body.routes.map((route: { id: string }) => route.id)).toEqual([
      referrerDraft.routeId
    ]);
    expect(response.body.routes[0]).toEqual(
      expect.objectContaining({
        referrerWallet: REFERRER_WALLET,
        payoutWallet: PAYOUT_WALLET,
        status: "active"
      })
    );
    expect(
      otherResponse.body.routes.map((route: { id: string }) => route.id)
    ).toEqual([otherDraft.routeId]);
  });

  it("suspends active routes with merchant-owner authorization when required", async () => {
    const bundle = createSampleProtocolArtifacts();
    const { app, merchantRegistry } = createTestApp({
      withAuth: true,
      withCampaignRegistry: true,
      withMerchantRegistry: true,
      withRouteRegistry: true
    });
    const ownerToken = await createAccessToken(app, OWNER_SEED, OWNER_WALLET);
    const otherOwnerToken = await createAccessToken(
      app,
      OTHER_OWNER_SEED,
      OTHER_OWNER_WALLET
    );
    await createActiveCampaign({ app, merchantRegistry, ownerToken });
    const draftResponse = await request(app)
      .post("/v1/routes/drafts")
      .send({
        campaignId: bundle.artifacts.receipt.campaignId,
        referrerWallet: REFERRER_WALLET,
        payoutWallet: PAYOUT_WALLET,
        operationIds: [bundle.artifacts.receipt.operationId],
        expiresAt: "2026-06-25T00:00:00Z",
        nonce: "route-nonce-http-0001"
      })
      .expect(201);
    const draft = draftResponse.body.draft as RouteDraft;
    await request(app)
      .post("/v1/routes")
      .send({ claim: signRouteDraft(draft) })
      .expect(201);

    await request(app)
      .post(`/v1/routes/${draft.routeId}/suspend`)
      .expect(401);
    await request(app)
      .post(`/v1/routes/${draft.routeId}/suspend`)
      .set("authorization", `Bearer ${otherOwnerToken}`)
      .expect(403);
    const suspendedResponse = await request(app)
      .post(`/v1/routes/${draft.routeId}/suspend`)
      .set("authorization", `Bearer ${ownerToken}`)
      .expect(200);
    const duplicateResponse = await request(app)
      .post(`/v1/routes/${draft.routeId}/suspend`)
      .set("authorization", `Bearer ${ownerToken}`)
      .expect(200);
    const loadedResponse = await request(app)
      .get(`/v1/routes/${draft.routeId}`)
      .expect(200);

    expect(suspendedResponse.body.route.status).toBe("suspended");
    expect(duplicateResponse.body.route.status).toBe("suspended");
    expect(loadedResponse.body.route.status).toBe("suspended");

    await request(app)
      .post(`/v1/routes/${draft.routeId}/resume`)
      .expect(401);
    await request(app)
      .post(`/v1/routes/${draft.routeId}/resume`)
      .set("authorization", `Bearer ${otherOwnerToken}`)
      .expect(403);
    const resumedResponse = await request(app)
      .post(`/v1/routes/${draft.routeId}/resume`)
      .set("authorization", `Bearer ${ownerToken}`)
      .expect(200);
    expect(resumedResponse.body.route.status).toBe("active");
    await request(app)
      .post("/v1/routes/rte_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbc/resume")
      .set("authorization", `Bearer ${ownerToken}`)
      .expect(404);
  });
});

describe("merchant campaign listing route", () => {
  it("lists a merchant's campaigns with status filtering", async () => {
    const { app, merchantRegistry } = createTestApp({
      withMerchantRegistry: true,
      withCampaignRegistry: true
    });
    await createActiveCampaign({ app, merchantRegistry });
    const bundle = createSampleProtocolArtifacts();
    const merchantId = bundle.artifacts.receipt.merchantId;
    const campaignId = bundle.artifacts.receipt.campaignId;

    const listed = await request(app)
      .get(`/v1/merchants/${merchantId}/campaigns`)
      .expect(200);
    expect(listed.body.campaigns).toHaveLength(1);
    expect(listed.body.campaigns[0].id).toBe(campaignId);
    expect(listed.body.campaigns[0].status).toBe("active");

    await request(app).post(`/v1/campaigns/${campaignId}/pause`).expect(200);

    const paused = await request(app)
      .get(`/v1/merchants/${merchantId}/campaigns`)
      .query({ status: "paused" })
      .expect(200);
    expect(paused.body.campaigns).toHaveLength(1);
    expect(paused.body.campaigns[0].status).toBe("paused");

    const active = await request(app)
      .get(`/v1/merchants/${merchantId}/campaigns`)
      .query({ status: "active" })
      .expect(200);
    expect(active.body.campaigns).toHaveLength(0);

    await request(app)
      .get(`/v1/merchants/${merchantId}/campaigns`)
      .query({ status: "bogus" })
      .expect(400);
  });

  it("requires the merchant owner when auth is enabled", async () => {
    const { app, merchantRegistry } = createTestApp({
      withMerchantRegistry: true,
      withCampaignRegistry: true,
      withAuth: true
    });
    const ownerToken = await createAccessToken(app, OWNER_SEED, OWNER_WALLET);
    await createActiveCampaign({ app, merchantRegistry, ownerToken });
    const bundle = createSampleProtocolArtifacts();
    const merchantId = bundle.artifacts.receipt.merchantId;

    await request(app).get(`/v1/merchants/${merchantId}/campaigns`).expect(401);

    const otherToken = await createAccessToken(
      app,
      OTHER_OWNER_SEED,
      OTHER_OWNER_WALLET
    );
    await request(app)
      .get(`/v1/merchants/${merchantId}/campaigns`)
      .set("authorization", `Bearer ${otherToken}`)
      .expect(403);

    const listed = await request(app)
      .get(`/v1/merchants/${merchantId}/campaigns`)
      .set("authorization", `Bearer ${ownerToken}`)
      .expect(200);
    expect(listed.body.campaigns).toHaveLength(1);
  });
});

describe("campaign lifecycle status routes", () => {
  it("pauses, resumes, and closes an activated campaign", async () => {
    const { app, merchantRegistry } = createTestApp({
      withMerchantRegistry: true,
      withCampaignRegistry: true
    });
    await createActiveCampaign({ app, merchantRegistry });
    const bundle = createSampleProtocolArtifacts();
    const campaignId = bundle.artifacts.receipt.campaignId;

    const paused = await request(app)
      .post(`/v1/campaigns/${campaignId}/pause`)
      .expect(200);
    expect(paused.body.campaign.status).toBe("paused");

    const doublePause = await request(app)
      .post(`/v1/campaigns/${campaignId}/pause`)
      .expect(400);
    expect(doublePause.body.message).toMatch(/only active campaigns/u);

    const resumed = await request(app)
      .post(`/v1/campaigns/${campaignId}/resume`)
      .expect(200);
    expect(resumed.body.campaign.status).toBe("active");

    const closed = await request(app)
      .post(`/v1/campaigns/${campaignId}/close`)
      .expect(200);
    expect(closed.body.campaign.status).toBe("closed");

    await request(app)
      .post(`/v1/campaigns/${campaignId}/resume`)
      .expect(400);
    await request(app)
      .post("/v1/campaigns/cmp_00000000000000000000000000000099/pause")
      .expect(404);
  });

  it("requires the campaign merchant owner when auth is enabled", async () => {
    const { app, merchantRegistry } = createTestApp({
      withMerchantRegistry: true,
      withCampaignRegistry: true,
      withAuth: true
    });
    const ownerToken = await createAccessToken(app, OWNER_SEED, OWNER_WALLET);
    await createActiveCampaign({ app, merchantRegistry, ownerToken });
    const bundle = createSampleProtocolArtifacts();
    const campaignId = bundle.artifacts.receipt.campaignId;

    await request(app).post(`/v1/campaigns/${campaignId}/pause`).expect(401);

    const otherToken = await createAccessToken(
      app,
      OTHER_OWNER_SEED,
      OTHER_OWNER_WALLET
    );
    await request(app)
      .post(`/v1/campaigns/${campaignId}/pause`)
      .set("authorization", `Bearer ${otherToken}`)
      .expect(403);

    const paused = await request(app)
      .post(`/v1/campaigns/${campaignId}/pause`)
      .set("authorization", `Bearer ${ownerToken}`)
      .expect(200);
    expect(paused.body.campaign.status).toBe("paused");
  });
});

describe("dead-letter webhook requeue route", () => {
  it("requeues a merchant's dead-letter webhook event and rejects other states", async () => {
    const bundle = createSampleProtocolArtifacts();
    const merchantId = bundle.artifacts.receipt.merchantId;
    const webhookStore = new FakeWebhookEventManagementStore([
      createWebhookEvent({
        id: "55555555-5555-4555-8555-555555555555",
        merchantId,
        status: "dead_letter",
        eventType: "webhook.receipt.accepted.v1"
      }),
      createWebhookEvent({
        id: "66666666-6666-4666-8666-666666666666",
        merchantId,
        status: "delivered",
        eventType: "webhook.payout.finalized.v1"
      }),
      createWebhookEvent({
        id: "77777777-7777-4777-8777-777777777777",
        merchantId: "mrc_ffffffffffffffffffffffffffffffff",
        status: "dead_letter",
        eventType: "webhook.receipt.accepted.v1"
      })
    ]);
    const { app } = createTestApp({
      withMerchantRegistry: true,
      webhookEventManagementStore: webhookStore
    });
    await request(app)
      .post("/v1/merchants")
      .send({
        id: merchantId,
        slug: "requeue-merchant",
        displayName: "Requeue Merchant",
        ownerWallet: bundle.keys.payerWallet
      })
      .expect(201);

    const requeued = await request(app)
      .post(
        `/v1/merchants/${merchantId}/webhook-events/55555555-5555-4555-8555-555555555555/requeue`
      )
      .expect(200);
    expect(requeued.body.event.status).toBe("pending");
    expect(requeued.body.event.attempts).toBe(0);
    expect(requeued.body.event.lastError).toBeUndefined();

    const conflict = await request(app)
      .post(
        `/v1/merchants/${merchantId}/webhook-events/66666666-6666-4666-8666-666666666666/requeue`
      )
      .expect(409);
    expect(conflict.body.message).toMatch(/only dead_letter events/u);

    await request(app)
      .post(
        `/v1/merchants/${merchantId}/webhook-events/77777777-7777-4777-8777-777777777777/requeue`
      )
      .expect(404);
    await request(app)
      .post(
        "/v1/merchants/mrc_00000000000000000000000000000099/webhook-events/55555555-5555-4555-8555-555555555555/requeue"
      )
      .expect(404);
  });
});

describe("payout batch read and ledger closure routes", () => {
  it("reads, lists, and closes finalized payout batches", async () => {
    const { app, store, receipt } = createTestApp({
      withMerchantRegistry: true,
      withPayouts: true
    });
    await request(app)
      .post("/v1/merchants")
      .send({
        id: receipt.merchantId,
        slug: "ledger-merchant",
        displayName: "Ledger Merchant",
        ownerWallet: receipt.payerWallet
      })
      .expect(201);
    await request(app).post("/v1/receipts").send({ receipt }).expect(201);
    const snapshot = store.getByReceiptId(receipt.receiptId);
    if (snapshot?.accrual === undefined) {
      throw new Error("expected receipt accrual");
    }
    store.save({
      ...snapshot,
      receipt: {
        ...snapshot.receipt,
        verificationState: "signature_verified"
      },
      accrual: {
        ...snapshot.accrual,
        status: "available",
        availableAt: "2026-06-24T00:04:00.000Z"
      }
    });
    const availableAccrual = store.getByReceiptId(receipt.receiptId)?.accrual;
    if (availableAccrual === undefined) {
      throw new Error("expected available accrual");
    }
    const batch = store.createPayoutBatch({
      merchantId: receipt.merchantId,
      payoutWalletId: "mpw_ffffffffffffffffffffffffffffffff",
      network: receipt.network,
      asset: receipt.asset,
      accruals: [availableAccrual],
      now: "2026-06-24T00:05:00Z"
    });

    const read = await request(app)
      .get(`/v1/payout-batches/${batch.id}`)
      .expect(200);
    expect(read.body.batch.id).toBe(batch.id);
    expect(read.body.batch.status).toBe("planned");

    const listed = await request(app)
      .get(`/v1/merchants/${receipt.merchantId}/payout-batches`)
      .expect(200);
    expect(listed.body.batches).toHaveLength(1);
    expect(listed.body.batches[0].id).toBe(batch.id);

    const filtered = await request(app)
      .get(`/v1/merchants/${receipt.merchantId}/payout-batches`)
      .query({ status: "finalized" })
      .expect(200);
    expect(filtered.body.batches).toHaveLength(0);
    await request(app)
      .get(`/v1/merchants/${receipt.merchantId}/payout-batches`)
      .query({ status: "bogus" })
      .expect(400);

    const prematureClose = await request(app)
      .post(`/v1/payout-batches/${batch.id}/close-ledger`)
      .expect(400);
    expect(prematureClose.body.message).toMatch(/must be finalized/u);

    const saved = store.saveSignedPayoutTransactions({
      payoutBatchId: batch.id,
      now: "2026-06-24T00:06:00Z",
      transactions: [
        {
          sequence: 0,
          signedTransactionBase64: "AQID",
          expectedSignature: "expected_sig_0"
        }
      ]
    });
    store.markPayoutTransactionSubmitted({
      id: saved[0]?.id ?? "",
      submittedAt: "2026-06-24T00:07:00Z",
      expectedSignature: "expected_sig_0"
    });
    store.markPayoutTransactionFinality({
      id: saved[0]?.id ?? "",
      status: "finalized",
      observedAt: "2026-06-24T00:08:00Z"
    });

    const closed = await request(app)
      .post(`/v1/payout-batches/${batch.id}/close-ledger`)
      .expect(200);
    expect(closed.body.ledgerTransaction.entries.length).toBeGreaterThan(0);
    expect(store.getByReceiptId(receipt.receiptId)?.accrual?.status).toBe(
      "paid"
    );

    const repeated = await request(app)
      .post(`/v1/payout-batches/${batch.id}/close-ledger`)
      .expect(200);
    expect(repeated.body.ledgerTransaction.transactionId).toBe(
      closed.body.ledgerTransaction.transactionId
    );

    await request(app)
      .get("/v1/payout-batches/pbt_00000000000000000000000000000099")
      .expect(404);
    await request(app)
      .post("/v1/payout-batches/pbt_00000000000000000000000000000099/close-ledger")
      .expect(404);
  });
});

describe("merchant payout wallet status routes", () => {
  it("pauses, resumes, and retires payout wallets through the API", async () => {
    const { app, merchantRegistry } = createTestApp({ withMerchantRegistry: true });
    seedMerchantFixture(merchantRegistry, {
      merchantStatus: "active",
      originStatus: "verified"
    });
    const bundle = createSampleProtocolArtifacts();
    const merchantId = bundle.artifacts.receipt.merchantId;
    const wallet = merchantRegistry?.addPayoutWallet({
      id: "mpw_ffffffffffffffffffffffffffffffff",
      merchantId,
      network: bundle.artifacts.receipt.network,
      wallet: bundle.keys.payToWallet,
      asset: bundle.artifacts.receipt.asset,
      signerReference: "kms:split402-devnet-payout"
    });

    const paused = await request(app)
      .post(`/v1/merchants/${merchantId}/payout-wallets/${wallet?.id}/pause`)
      .expect(200);
    expect(paused.body.payoutWallet.status).toBe("paused");

    const resumed = await request(app)
      .post(`/v1/merchants/${merchantId}/payout-wallets/${wallet?.id}/resume`)
      .expect(200);
    expect(resumed.body.payoutWallet.status).toBe("active");

    const retired = await request(app)
      .post(`/v1/merchants/${merchantId}/payout-wallets/${wallet?.id}/retire`)
      .expect(200);
    expect(retired.body.payoutWallet.status).toBe("retired");

    const conflict = await request(app)
      .post(`/v1/merchants/${merchantId}/payout-wallets/${wallet?.id}/resume`)
      .expect(409);
    expect(conflict.body.error).toBe("conflict");

    await request(app)
      .post(
        `/v1/merchants/${merchantId}/payout-wallets/mpw_00000000000000000000000000000099/pause`
      )
      .expect(404);
  });

  it("requires the merchant owner wallet when auth is enabled", async () => {
    const { app, merchantRegistry } = createTestApp({
      withMerchantRegistry: true,
      withAuth: true
    });
    seedMerchantFixture(merchantRegistry, {
      merchantStatus: "active",
      originStatus: "verified"
    });
    const bundle = createSampleProtocolArtifacts();
    const merchantId = bundle.artifacts.receipt.merchantId;
    const wallet = merchantRegistry?.addPayoutWallet({
      id: "mpw_ffffffffffffffffffffffffffffffff",
      merchantId,
      network: bundle.artifacts.receipt.network,
      wallet: bundle.keys.payToWallet,
      asset: bundle.artifacts.receipt.asset,
      signerReference: "kms:split402-devnet-payout"
    });

    await request(app)
      .post(`/v1/merchants/${merchantId}/payout-wallets/${wallet?.id}/pause`)
      .expect(401);

    const ownerToken = await createAccessToken(app, OWNER_SEED, OWNER_WALLET);
    const paused = await request(app)
      .post(`/v1/merchants/${merchantId}/payout-wallets/${wallet?.id}/pause`)
      .set("authorization", `Bearer ${ownerToken}`)
      .expect(200);
    expect(paused.body.payoutWallet.status).toBe("paused");

    const otherToken = await createAccessToken(app, OTHER_OWNER_SEED, OTHER_OWNER_WALLET);
    await request(app)
      .post(`/v1/merchants/${merchantId}/payout-wallets/${wallet?.id}/resume`)
      .set("authorization", `Bearer ${otherToken}`)
      .expect(403);
  });
});

describe("control-plane operator approval endpoints", () => {
  it("fails closed when no operator tokens are configured", async () => {
    const { app, merchantRegistry } = createTestApp({ withMerchantRegistry: true });
    seedMerchantFixture(merchantRegistry, {
      merchantStatus: "pending",
      originStatus: "pending"
    });
    const bundle = createSampleProtocolArtifacts();

    const response = await request(app)
      .post(`/v1/operator/merchants/${bundle.artifacts.receipt.merchantId}/approve`)
      .set("authorization", "Bearer any-token")
      .expect(403);
    expect(response.body.error).toBe("operator_disabled");
    expect(
      merchantRegistry?.getMerchantProfile(bundle.artifacts.receipt.merchantId)?.status
    ).toBe("pending");
  });

  it("rejects missing and invalid operator tokens", async () => {
    const { app, merchantRegistry } = createTestApp({
      withMerchantRegistry: true,
      operatorTokens: ["operator-secret-1"]
    });
    seedMerchantFixture(merchantRegistry, {
      merchantStatus: "pending",
      originStatus: "pending"
    });
    const bundle = createSampleProtocolArtifacts();

    await request(app)
      .post(`/v1/operator/merchants/${bundle.artifacts.receipt.merchantId}/approve`)
      .expect(401);
    await request(app)
      .post(`/v1/operator/merchants/${bundle.artifacts.receipt.merchantId}/approve`)
      .set("authorization", "Bearer wrong-token")
      .expect(401);
    expect(
      merchantRegistry?.getMerchantProfile(bundle.artifacts.receipt.merchantId)?.status
    ).toBe("pending");
  });

  it("approves, suspends, and closes merchants with an operator token", async () => {
    const { app, merchantRegistry } = createTestApp({
      withMerchantRegistry: true,
      operatorTokens: ["operator-secret-1", "operator-secret-2"]
    });
    seedMerchantFixture(merchantRegistry, {
      merchantStatus: "pending",
      originStatus: "pending"
    });
    const bundle = createSampleProtocolArtifacts();
    const merchantId = bundle.artifacts.receipt.merchantId;

    const approved = await request(app)
      .post(`/v1/operator/merchants/${merchantId}/approve`)
      .set("authorization", "Bearer operator-secret-2")
      .expect(200);
    expect(approved.body.merchant.status).toBe("active");

    const suspended = await request(app)
      .post(`/v1/operator/merchants/${merchantId}/suspend`)
      .set("authorization", "Bearer operator-secret-1")
      .expect(200);
    expect(suspended.body.merchant.status).toBe("suspended");

    const closed = await request(app)
      .post(`/v1/operator/merchants/${merchantId}/close`)
      .set("authorization", "Bearer operator-secret-1")
      .expect(200);
    expect(closed.body.merchant.status).toBe("closed");

    await request(app)
      .post("/v1/operator/merchants/mrc_00000000000000000000000000000099/approve")
      .set("authorization", "Bearer operator-secret-1")
      .expect(404);
  });

  it("verifies and revokes merchant origins with an operator token", async () => {
    const { app, merchantRegistry } = createTestApp({
      withMerchantRegistry: true,
      operatorTokens: ["operator-secret-1"]
    });
    seedMerchantFixture(merchantRegistry, {
      merchantStatus: "pending",
      originStatus: "pending"
    });
    const bundle = createSampleProtocolArtifacts();
    const merchantId = bundle.artifacts.receipt.merchantId;
    const origin = bundle.artifacts.receipt.merchantOrigin;

    const verified = await request(app)
      .post(`/v1/operator/merchants/${merchantId}/origins/verify`)
      .set("authorization", "Bearer operator-secret-1")
      .send({ origin, verifiedAt: "2026-06-24T00:05:00Z" })
      .expect(200);
    expect(verified.body.origin.status).toBe("verified");
    expect(verified.body.origin.verifiedAt).toBe("2026-06-24T00:05:00Z");

    const revoked = await request(app)
      .post(`/v1/operator/merchants/${merchantId}/origins/revoke`)
      .set("authorization", "Bearer operator-secret-1")
      .send({ origin })
      .expect(200);
    expect(revoked.body.origin.status).toBe("revoked");
    expect(revoked.body.origin.verifiedAt).toBeUndefined();

    await request(app)
      .post(`/v1/operator/merchants/${merchantId}/origins/verify`)
      .set("authorization", "Bearer operator-secret-1")
      .send({ origin: "https://unknown.example" })
      .expect(404);
    await request(app)
      .post(`/v1/operator/merchants/${merchantId}/origins/verify`)
      .set("authorization", "Bearer operator-secret-1")
      .send({})
      .expect(400);
  });

  it("checks a registered origin's well-known document without changing state", async () => {
    const bundle = createSampleProtocolArtifacts();
    const merchantId = bundle.artifacts.receipt.merchantId;
    const origin = bundle.artifacts.receipt.merchantOrigin;
    const requestedUrls: string[] = [];
    const { app, merchantRegistry } = createTestApp({
      withMerchantRegistry: true,
      operatorTokens: ["operator-secret-1"],
      operatorWellKnownFetch: (input) => {
        requestedUrls.push(String(input));
        return Promise.resolve(
          new Response(
            JSON.stringify({
              protocol: "split402",
              merchantId,
              servicePublicKey: bundle.keys.merchantPublicKey
            }),
            { status: 200 }
          )
        );
      }
    });
    seedMerchantFixture(merchantRegistry, {
      merchantStatus: "pending",
      originStatus: "pending"
    });

    const response = await request(app)
      .post(`/v1/operator/merchants/${merchantId}/origins/check`)
      .set("authorization", "Bearer operator-secret-1")
      .send({ origin })
      .expect(200);
    expect(response.body.check.ok).toBe(true);
    expect(response.body.check.discovered.merchantId).toBe(merchantId);
    expect(requestedUrls).toEqual([`${origin}/.well-known/split402.json`]);
    expect(
      merchantRegistry
        ?.getMerchantProfile(merchantId)
        ?.origins.find((candidate) => candidate.origin === origin)?.status
    ).toBe("pending");

    await request(app)
      .post(`/v1/operator/merchants/${merchantId}/origins/check`)
      .set("authorization", "Bearer operator-secret-1")
      .send({ origin: "https://unregistered.example" })
      .expect(404);
    await request(app)
      .post(`/v1/operator/merchants/${merchantId}/origins/check`)
      .send({ origin })
      .expect(401);
  });

  it("lets an operator-approved merchant pass campaign activation checks", async () => {
    const { app, merchantRegistry } = createTestApp({
      withMerchantRegistry: true,
      withCampaignRegistry: true,
      operatorTokens: ["operator-secret-1"]
    });
    seedMerchantFixture(merchantRegistry, {
      merchantStatus: "pending",
      originStatus: "pending"
    });
    const bundle = createSampleProtocolArtifacts();
    const merchantId = bundle.artifacts.receipt.merchantId;

    await request(app)
      .post(`/v1/operator/merchants/${merchantId}/approve`)
      .set("authorization", "Bearer operator-secret-1")
      .expect(200);
    await request(app)
      .post(`/v1/operator/merchants/${merchantId}/origins/verify`)
      .set("authorization", "Bearer operator-secret-1")
      .send({ origin: bundle.artifacts.receipt.merchantOrigin })
      .expect(200);

    const campaignResponse = await request(app)
      .post("/v1/campaigns")
      .send({
        id: bundle.artifacts.receipt.campaignId,
        merchantId,
        ...createCampaignBody()
      })
      .expect(201);
    const currentVersion = campaignResponse.body.campaign
      .current as CampaignVersionRecord;

    await request(app)
      .post(`/v1/campaigns/${bundle.artifacts.receipt.campaignId}/activate`)
      .send({
        kid: bundle.artifacts.receipt.kid,
        signature: signCampaignTerms(currentVersion)
      })
      .expect(200);
  });
});

function createTestApp(
  options: {
    withAuth?: boolean;
    withCampaignRegistry?: boolean;
    withMerchantRegistry?: boolean;
    payoutFinalityMonitor?: PayoutFinalityMonitor;
    merchantFundingBalanceProvider?: MerchantFundingBalanceProvider;
    webhookEventManagementStore?: WebhookEventManagementStore;
    withPayouts?: boolean;
    withRouteRegistry?: boolean;
    rateLimitWindowMs?: number;
    rateLimitMaxRequests?: number;
    operatorTokens?: string[];
    operatorWellKnownFetch?: typeof fetch;
  } = {}
) {
  const bundle = createSampleProtocolArtifacts();
  const store = new InMemoryReceiptIngestionStore();
  const merchantRegistry =
    options.withMerchantRegistry === true
      ? new InMemoryMerchantRegistry({
          now: () => new Date("2026-06-24T00:02:00Z")
        })
      : undefined;
  const ingestor = new ReceiptIngestor(store, {
    resolveMerchantPublicKey: () => bundle.keys.merchantPublicKey,
    now: () => new Date("2026-06-24T00:02:00Z")
  });

  return {
    app: createControlPlaneApp({
      ingestor,
      ...(merchantRegistry === undefined ? {} : { merchantRegistry }),
      ...(options.withCampaignRegistry === true
        ? {
            campaignRegistry: new InMemoryCampaignRegistry({
              now: () => new Date("2026-06-24T00:02:00Z")
            })
          }
        : {}),
      ...(options.withRouteRegistry === true
        ? {
            routeRegistry: new InMemoryRouteRegistry({
              now: () => new Date("2026-06-24T00:02:00Z"),
              routeIdFactory: () => "rte_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              nonceFactory: () => "route-nonce-http-0001"
            })
          }
        : {}),
      ...(options.withPayouts === true
        ? {
            payoutAccrualStore: store,
            payoutBatchStore: store,
            payoutTransactionStore: store,
            payoutReconciliationStore: store,
            merchantObligationViewStore: store,
            ...(options.merchantFundingBalanceProvider === undefined
              ? {}
              : {
                  merchantFundingBalanceProvider:
                    options.merchantFundingBalanceProvider
                }),
            referrerPayoutViewStore: store,
            payoutLedgerClosureStore: store,
            payoutFinalizedTransferVerifier: {
              verifyFinalizedPayout: () => ({ ok: true, errors: [] })
            },
            ...(options.payoutFinalityMonitor === undefined
              ? {}
              : { payoutFinalityMonitor: options.payoutFinalityMonitor })
          }
        : {}),
      ...(options.withAuth === true
        ? { auth: { authenticator: createAuthenticator() } }
        : {}),
      ...(options.webhookEventManagementStore === undefined
        ? {}
        : { webhookEventManagementStore: options.webhookEventManagementStore }),
      ...(options.rateLimitWindowMs === undefined
        ? {}
        : { rateLimitWindowMs: options.rateLimitWindowMs }),
      ...(options.rateLimitMaxRequests === undefined
        ? {}
        : { rateLimitMaxRequests: options.rateLimitMaxRequests }),
      ...(options.operatorTokens === undefined
        ? {}
        : {
            operator: {
              accessTokens: options.operatorTokens,
              ...(options.operatorWellKnownFetch === undefined
                ? {}
                : { wellKnownFetch: options.operatorWellKnownFetch })
            }
          })
    }),
    merchantRegistry,
    store,
    receipt: bundle.artifacts.receipt
  };
}

async function createMaybeBroadcastPayoutBatchFixture(
  options: {
    payoutFinalityMonitor?: PayoutFinalityMonitor;
  } = {}
) {
  const { app, store, receipt, merchantRegistry } = createTestApp({
    withMerchantRegistry: true,
    withPayouts: true,
    ...(options.payoutFinalityMonitor === undefined
      ? {}
      : { payoutFinalityMonitor: options.payoutFinalityMonitor })
  });
  if (merchantRegistry === undefined) {
    throw new Error("expected merchant registry");
  }
  await request(app)
    .post("/v1/merchants")
    .send({
      id: receipt.merchantId,
      slug: "release-guard-merchant",
      displayName: "Release Guard Merchant",
      ownerWallet: receipt.payerWallet
    })
    .expect(201);
  await request(app).post("/v1/receipts").send({ receipt }).expect(201);
  const snapshot = store.getByReceiptId(receipt.receiptId);
  if (snapshot?.accrual === undefined) {
    throw new Error("expected receipt accrual");
  }
  store.save({
    ...snapshot,
    receipt: {
      ...snapshot.receipt,
      verificationState: "signature_verified"
    },
    accrual: {
      ...snapshot.accrual,
      status: "available",
      availableAt: "2026-06-24T00:04:00.000Z"
    }
  });
  const availableAccrual = store.getByReceiptId(receipt.receiptId)?.accrual;
  if (availableAccrual === undefined) {
    throw new Error("expected available accrual");
  }
  const batch = store.createPayoutBatch({
    merchantId: receipt.merchantId,
    payoutWalletId: "mpw_ffffffffffffffffffffffffffffffff",
    network: receipt.network,
    asset: receipt.asset,
    accruals: [availableAccrual],
    now: "2026-06-24T00:05:00Z"
  });
  const [transaction] = store.saveSignedPayoutTransactions({
    payoutBatchId: batch.id,
    now: "2026-06-24T00:06:00Z",
    transactions: [
      {
        sequence: 0,
        recentBlockhash: "blockhash_0",
        lastValidBlockHeight: 150,
        signedTransactionBase64: "AQID",
        expectedSignature: "expected_sig_0"
      }
    ]
  });
  if (transaction === undefined) {
    throw new Error("expected payout transaction");
  }
  return { app, store, receipt, batch, transaction };
}

class FakeWebhookEventManagementStore implements WebhookEventManagementStore {
  readonly inputs: Parameters<WebhookEventManagementStore["listWebhookEvents"]>[0][] = [];
  readonly events: OutboxEventRecord[];

  constructor(events: readonly OutboxEventRecord[]) {
    this.events = events.map((event) => ({ ...event }));
  }

  listWebhookEvents(
    input: Parameters<WebhookEventManagementStore["listWebhookEvents"]>[0]
  ): OutboxEventRecord[] {
    this.inputs.push(input);
    return this.events
      .filter((event) => event.payload.merchantId === input.merchantId)
      .filter(
        (event) =>
          input.eventTypes === undefined || input.eventTypes.includes(event.eventType)
      )
      .filter((event) => input.status === undefined || event.status === input.status)
      .slice(0, input.limit ?? 50);
  }

  requeueDeadLetterWebhookEvent(
    input: RequeueDeadLetterWebhookEventInput
  ): OutboxEventRecord | undefined {
    const event = this.events.find(
      (candidate) =>
        candidate.id === input.eventId &&
        candidate.payload.merchantId === input.merchantId
    );
    if (event === undefined) {
      return undefined;
    }
    if (event.status !== "dead_letter") {
      throw new WebhookEventRequeueConflictError(
        `webhook event is ${event.status}; only dead_letter events can be requeued`
      );
    }
    event.status = "pending";
    event.attempts = 0;
    delete event.lastError;
    delete event.lockedAt;
    return { ...event };
  }
}

class FakeMerchantFundingBalanceProvider implements MerchantFundingBalanceProvider {
  readonly inputs: Parameters<MerchantFundingBalanceProvider["getMerchantFundingBalances"]>[0][] = [];

  constructor(private readonly balances: readonly PayoutFundingBalance[]) {}

  getMerchantFundingBalances(
    input: Parameters<MerchantFundingBalanceProvider["getMerchantFundingBalances"]>[0]
  ): PayoutFundingBalance[] {
    this.inputs.push(input);
    return [...this.balances];
  }
}

function createWebhookEvent(input: {
  eventType: string;
  id: string;
  merchantId: string;
  status: OutboxEventRecord["status"];
}): OutboxEventRecord {
  return {
    id: input.id,
    eventType: input.eventType,
    aggregateType: "receipt",
    aggregateId: "rcp_00000000000000000000000000000001",
    payload: {
      merchantId: input.merchantId,
      receiptId: "rcp_00000000000000000000000000000001"
    },
    status: input.status,
    attempts: input.status === "delivered" ? 1 : 0,
    availableAt: "2026-06-24T00:02:00Z",
    createdAt: "2026-06-24T00:02:00Z",
    ...(input.status === "dead_letter" ? { lastError: "delivery failed" } : {})
  };
}

class FakePayoutFinalityMonitor implements PayoutFinalityMonitor {
  readonly transactions: string[] = [];

  constructor(
    private readonly results: readonly PayoutReconciliationFinalityResult[]
  ) {}

  monitor(input: {
    transaction: { id: string };
  }): PayoutReconciliationFinalityResult {
    this.transactions.push(input.transaction.id);
    const result = this.results[this.transactions.length - 1];
    if (result === undefined) {
      throw new Error("missing fake payout finality result");
    }
    return {
      ...result,
      transactionId: input.transaction.id
    };
  }
}

function seedMerchantFixture(
  merchantRegistry: InMemoryMerchantRegistry | undefined,
  input: {
    merchantStatus: "pending" | "active";
    originStatus: "pending" | "verified";
  }
): void {
  if (merchantRegistry === undefined) {
    throw new Error("merchant registry is required for merchant fixtures");
  }
  const bundle = createSampleProtocolArtifacts();
  merchantRegistry.createMerchant({
    id: bundle.artifacts.receipt.merchantId,
    slug: "demo-merchant",
    displayName: "Demo Merchant",
    ownerWallet: OWNER_WALLET,
    status: input.merchantStatus
  });
  merchantRegistry.addOrigin({
    merchantId: bundle.artifacts.receipt.merchantId,
    origin: bundle.artifacts.receipt.merchantOrigin,
    verificationMethod: "well_known",
    status: input.originStatus,
    ...(input.originStatus === "verified"
      ? { verifiedAt: "2026-06-24T00:01:00Z" }
      : {})
  });
  merchantRegistry.addKey({
    merchantId: bundle.artifacts.receipt.merchantId,
    kid: bundle.artifacts.receipt.kid,
    publicKey: bundle.keys.merchantPublicKey,
    validFrom: "2026-06-24T00:00:00Z"
  });
}

async function createActiveCampaign(input: {
  app: Express;
  merchantRegistry: InMemoryMerchantRegistry | undefined;
  ownerToken?: string;
}): Promise<void> {
  const { app, merchantRegistry, ownerToken } = input;
  const bundle = createSampleProtocolArtifacts();
  seedMerchantFixture(merchantRegistry, {
    merchantStatus: "active",
    originStatus: "verified"
  });
  const campaignResponse = await request(app)
    .post("/v1/campaigns")
    .set(ownerToken === undefined ? {} : { authorization: `Bearer ${ownerToken}` })
    .send({
      id: bundle.artifacts.receipt.campaignId,
      merchantId: bundle.artifacts.receipt.merchantId,
      ...createCampaignBody()
    })
    .expect(201);
  const signature = signCampaignTerms(
    campaignResponse.body.campaign.current as CampaignVersionRecord
  );
  await request(app)
    .post(`/v1/campaigns/${bundle.artifacts.receipt.campaignId}/activate`)
    .set(ownerToken === undefined ? {} : { authorization: `Bearer ${ownerToken}` })
    .send({
      kid: bundle.artifacts.receipt.kid,
      signature
    })
    .expect(200);
}

function createAuthenticator(): WalletAuthenticator {
  let idSequence = 0;
  return new WalletAuthenticator(new InMemoryWalletAuthStore(), {
    now: () => new Date("2026-06-24T00:02:00Z"),
    challengeIdFactory: () => nextAuthId("chl", ++idSequence),
    sessionIdFactory: () => nextAuthId("ses", ++idSequence),
    refreshTokenIdFactory: () => nextAuthId("rft", ++idSequence),
    nonceFactory: () => `nonce-${idSequence}`,
    accessTokenFactory: () => `http-token-${idSequence}`,
    refreshTokenFactory: () => `http-refresh-token-${idSequence}`
  });
}

async function createAccessToken(
  app: Express,
  seed: Uint8Array,
  wallet: string
): Promise<string> {
  const challengeResponse = await request(app)
    .post("/v1/auth/challenges")
    .send({
      wallet,
      network: NETWORK,
      purpose: "merchant-session"
    })
    .expect(201);
  const signature = signEd25519Message(
    new TextEncoder().encode(challengeResponse.body.challenge.message as string),
    seed
  ).signature;
  const sessionResponse = await request(app)
    .post("/v1/auth/sessions")
    .send({
      challengeId: challengeResponse.body.challenge.challengeId,
      signature,
      publicKey: wallet
    })
    .expect(201);

  return sessionResponse.body.session.accessToken as string;
}

function nextAuthId(prefix: "chl" | "ses" | "rft", sequence: number): string {
  return `${prefix}_${sequence.toString(16).padStart(32, "0")}`;
}

function createCampaignBody(
  overrides: Partial<CampaignTermsInput> = {}
): CampaignTermsInput {
  const bundle = createSampleProtocolArtifacts();
  return {
    resourceOrigin: bundle.artifacts.receipt.merchantOrigin,
    operations: [
      {
        operationId: bundle.artifacts.receipt.operationId,
        method: "POST",
        pathTemplate: "/v1/risk"
      }
    ],
    network: bundle.artifacts.receipt.network,
    asset: bundle.artifacts.receipt.asset,
    requiredAmountAtomic: bundle.artifacts.receipt.requiredAmountAtomic,
    payToWallet: bundle.artifacts.receipt.payToWallet,
    commissionBps: bundle.artifacts.receipt.commissionBps,
    payoutThresholdAtomic: "100000",
    startsAt: "2026-06-24T00:00:00Z",
    endsAt: null,
    ...overrides
  };
}

function signCampaignTerms(version: CampaignVersionRecord): string {
  return signEd25519Message(
    buildCampaignTermsSigningBytes(version.terms),
    MERCHANT_SEED
  ).signature;
}

function signRouteDraft(
  draft: RouteDraft,
  seed: Uint8Array = REFERRER_SEED
): ReferralClaimV1 {
  return signUnsignedClaim(draft.claim, seed);
}

function signUnsignedClaim(
  claim: UnsignedReferralClaim,
  seed: Uint8Array = REFERRER_SEED
): ReferralClaimV1 {
  const signed = signEd25519Message(buildReferralClaimSigningBytes(claim), seed);
  return {
    ...claim,
    signature: {
      type: "solana-ed25519",
      publicKey: signed.publicKey,
      value: signed.signature
    }
  };
}

function mutateSignature(signature: string): string {
  const first = signature[0] ?? "A";
  return `${first === "A" ? "B" : "A"}${signature.slice(1)}`;
}
