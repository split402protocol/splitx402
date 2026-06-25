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
  type RouteDraft,
  type UnsignedReferralClaim
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
  it("exposes a Phase 4 health endpoint", async () => {
    const { app } = createTestApp();

    const response = await request(app).get("/v1/health").expect(200);

    expect(response.body).toEqual({
      status: "ok",
      service: "split402-control-plane",
      phase: "phase-4"
    });
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
        amountAtomic: "2000"
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
        totalAmountAtomicByAsset: { [receipt.asset]: "2000" }
      })
    );
    expect(response.body.preview.batches).toEqual([
      expect.objectContaining({
        asset: receipt.asset,
        totalAmountAtomic: "2000",
        fundingStatus: "deficit",
        fundingDeficitAtomic: "1000",
        items: [
          expect.objectContaining({
            destinationWallet: receipt.payoutWallet,
            amountAtomic: "2000",
            accrualIds: [snapshot.accrual.id]
          })
        ]
      })
    ]);
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
        ownerWallet: receipt.payerWallet,
        status: "active"
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
        totalAmountAtomic: "2000",
        itemCount: 1,
        accrualCount: 1
      })
    );
    expect(response.body.batch.items).toEqual([
      expect.objectContaining({
        destinationWallet: receipt.payoutWallet,
        amountAtomic: "2000",
        status: "allocated",
        allocations: [
          expect.objectContaining({
            accrualId: snapshot.accrual.id,
            amountAtomic: "2000"
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
        ownerWallet: receipt.payerWallet,
        status: "active"
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
        ownerWallet: receipt.payerWallet,
        status: "active"
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
            paidAmountAtomic: "2000",
            totalEarnedAmountAtomic: "2000"
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
        amountAtomic: "2000",
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

    const merchantResponse = await request(app)
      .post("/v1/merchants")
      .send({
        id: bundle.artifacts.receipt.merchantId,
        slug: "demo-merchant",
        displayName: "Demo Merchant",
        ownerWallet: bundle.keys.payerWallet
      })
      .expect(201);
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
    const revokeResponse = await request(app)
      .post(
        `/v1/merchants/${bundle.artifacts.receipt.merchantId}/keys/${bundle.artifacts.receipt.kid}/revoke`
      )
      .send({
        revokedAt: "2026-06-24T00:02:00Z",
        reason: "rotation complete"
      })
      .expect(200);

    expect(merchantResponse.body.merchant.id).toBe(
      bundle.artifacts.receipt.merchantId
    );
    expect(originResponse.body.origin.origin).toBe(
      bundle.artifacts.receipt.merchantOrigin
    );
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
    expect(profileResponse.body.merchant.keys).toHaveLength(1);
    expect(profileResponse.body.merchant.payoutWallets).toHaveLength(1);
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
        displayName: "Demo Merchant",
        status: "active"
      })
      .expect(201);
    await request(app)
      .post(`/v1/merchants/${bundle.artifacts.receipt.merchantId}/origins`)
      .set("authorization", `Bearer ${ownerToken}`)
      .send({
        origin: bundle.artifacts.receipt.merchantOrigin,
        verificationMethod: "well_known",
        status: "verified",
        verifiedAt: "2026-06-24T00:01:00Z"
      })
      .expect(201);
    await request(app)
      .post(`/v1/merchants/${bundle.artifacts.receipt.merchantId}/keys`)
      .set("authorization", `Bearer ${ownerToken}`)
      .send({
        kid: bundle.artifacts.receipt.kid,
        publicKey: bundle.keys.merchantPublicKey,
        validFrom: "2026-06-24T00:00:00Z"
      })
      .expect(201);
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

  it("creates route drafts and activates signed route claims", async () => {
    const bundle = createSampleProtocolArtifacts();
    const { app } = createTestApp({
      withCampaignRegistry: true,
      withMerchantRegistry: true,
      withRouteRegistry: true
    });
    await createActiveCampaign(app);

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
  });

  it("rotates route payout wallets and exposes immutable route versions", async () => {
    const bundle = createSampleProtocolArtifacts();
    const { app } = createTestApp({
      withCampaignRegistry: true,
      withMerchantRegistry: true,
      withRouteRegistry: true
    });
    await createActiveCampaign(app);

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
    const { app } = createTestApp({
      withCampaignRegistry: true,
      withMerchantRegistry: true,
      withRouteRegistry: true
    });
    await createActiveCampaign(app);

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

  it("suspends active routes with merchant-owner authorization when required", async () => {
    const bundle = createSampleProtocolArtifacts();
    const { app } = createTestApp({
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
    await createActiveCampaign(app, ownerToken);
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
  });
});

function createTestApp(
  options: {
    withAuth?: boolean;
    withCampaignRegistry?: boolean;
    withMerchantRegistry?: boolean;
    withPayouts?: boolean;
    withRouteRegistry?: boolean;
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
            payoutReconciliationStore: store,
            referrerPayoutViewStore: store
          }
        : {}),
      ...(options.withAuth === true
        ? { auth: { authenticator: createAuthenticator() } }
        : {})
    }),
    merchantRegistry,
    store,
    receipt: bundle.artifacts.receipt
  };
}

async function createActiveCampaign(app: Express, ownerToken?: string): Promise<void> {
  const bundle = createSampleProtocolArtifacts();
  const merchantRequest = request(app)
    .post("/v1/merchants")
    .set(ownerToken === undefined ? {} : { authorization: `Bearer ${ownerToken}` })
    .send({
      id: bundle.artifacts.receipt.merchantId,
      slug: "demo-merchant",
      displayName: "Demo Merchant",
      ownerWallet: OWNER_WALLET,
      status: "active"
    })
    .expect(201);
  await merchantRequest;
  await request(app)
    .post(`/v1/merchants/${bundle.artifacts.receipt.merchantId}/origins`)
    .set(ownerToken === undefined ? {} : { authorization: `Bearer ${ownerToken}` })
    .send({
      origin: bundle.artifacts.receipt.merchantOrigin,
      verificationMethod: "well_known",
      status: "verified",
      verifiedAt: "2026-06-24T00:01:00Z"
    })
    .expect(201);
  await request(app)
    .post(`/v1/merchants/${bundle.artifacts.receipt.merchantId}/keys`)
    .set(ownerToken === undefined ? {} : { authorization: `Bearer ${ownerToken}` })
    .send({
      kid: bundle.artifacts.receipt.kid,
      publicKey: bundle.keys.merchantPublicKey,
      validFrom: "2026-06-24T00:00:00Z"
    })
    .expect(201);
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

function signRouteDraft(draft: RouteDraft): ReferralClaimV1 {
  return signUnsignedClaim(draft.claim);
}

function signUnsignedClaim(claim: UnsignedReferralClaim): ReferralClaimV1 {
  const signed = signEd25519Message(
    buildReferralClaimSigningBytes(claim),
    REFERRER_SEED
  );
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
