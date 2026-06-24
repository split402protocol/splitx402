import {
  base58Encode,
  buildReceiptSigningBytes,
  createSampleProtocolArtifacts,
  hexToBytes,
  signEd25519Message,
  type Split402ReceiptV1
} from "@split402/protocol";
import { describe, expect, it } from "vitest";

import {
  InMemoryReceiptIngestionStore,
  ReceiptIngestionPersistenceConflictError,
  ReceiptIngestor,
  assertLedgerBalances,
  type ReceiptIngestionSnapshot,
  type ReceiptIngestionStore
} from "../src/index.js";

const MERCHANT_SEED = hexToBytes(
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
);
const FIXED_NOW = new Date("2026-06-24T00:02:00Z");

describe("receipt ingestion", () => {
  it("ingests a valid receipt into one accrual and a balanced ledger transaction", async () => {
    const bundle = createSampleProtocolArtifacts();
    const store = new InMemoryReceiptIngestionStore();
    const ingestor = new ReceiptIngestor(store, {
      resolveMerchantPublicKey: () => bundle.keys.merchantPublicKey,
      now: () => FIXED_NOW
    });

    const result = await ingestor.ingest({
      receipt: bundle.artifacts.receipt,
      source: "buyer"
    });

    expect(result.status).toBe("created");
    if (result.status !== "created") {
      throw new Error("expected receipt creation");
    }

    expect(result.statusCode).toBe(201);
    expect(result.receipt.id).toBe(bundle.artifacts.receipt.receiptId);
    expect(result.receipt.receiptHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(result.receipt.verificationState).toBe("pending_chain_verification");
    expect(result.receipt.source).toBe("buyer");
    expect(result.receipt.createdAt).toBe(FIXED_NOW.toISOString());
    expect(result.accrual).toEqual(
      expect.objectContaining({
        receiptId: bundle.artifacts.receipt.receiptId,
        merchantId: bundle.artifacts.receipt.merchantId,
        campaignId: bundle.artifacts.receipt.campaignId,
        routeId: bundle.artifacts.receipt.routeId,
        referrerWallet: bundle.keys.referrerPublicKey,
        payoutWallet: bundle.keys.payoutWallet,
        amountAtomic: "2000",
        status: "pending_chain_verification"
      })
    );
    expect(result.ledgerTransaction?.sourceId).toBe(result.accrual?.id);
    expect(result.ledgerTransaction?.entries).toHaveLength(3);
    assertLedgerBalances(result.ledgerTransaction?.entries ?? []);
    expect(store.listAccruals()).toHaveLength(1);
  });

  it("returns the existing snapshot for an identical duplicate receipt", async () => {
    const bundle = createSampleProtocolArtifacts();
    const store = new InMemoryReceiptIngestionStore();
    const ingestor = new ReceiptIngestor(store, {
      resolveMerchantPublicKey: () => bundle.keys.merchantPublicKey,
      now: () => FIXED_NOW
    });

    const first = await ingestor.ingest({ receipt: bundle.artifacts.receipt });
    const second = await ingestor.ingest({ receipt: bundle.artifacts.receipt });

    expect(first.status).toBe("created");
    expect(second.status).toBe("duplicate");
    if (first.status !== "created" || second.status !== "duplicate") {
      throw new Error("expected create then duplicate");
    }
    expect(second.statusCode).toBe(200);
    expect(second.receipt.id).toBe(first.receipt.id);
    expect(second.accrual?.id).toBe(first.accrual?.id);
    expect(store.listAccruals()).toHaveLength(1);
  });

  it("recovers an identical duplicate after a persistence conflict", async () => {
    const bundle = createSampleProtocolArtifacts();
    const backingStore = new InMemoryReceiptIngestionStore();
    const store = new RacingReceiptStore(backingStore);
    const ingestor = new ReceiptIngestor(store, {
      resolveMerchantPublicKey: () => bundle.keys.merchantPublicKey,
      now: () => FIXED_NOW
    });

    const result = await ingestor.ingest({ receipt: bundle.artifacts.receipt });

    expect(result.status).toBe("duplicate");
    if (result.status !== "duplicate") {
      throw new Error("expected duplicate recovery");
    }
    expect(result.receipt.id).toBe(bundle.artifacts.receipt.receiptId);
    expect(result.statusCode).toBe(200);
    expect(backingStore.listAccruals()).toHaveLength(1);
  });

  it("rejects conflicting receipt identifiers before signature verification", async () => {
    const bundle = createSampleProtocolArtifacts();
    const store = new InMemoryReceiptIngestionStore();
    const ingestor = new ReceiptIngestor(store, {
      resolveMerchantPublicKey: () => bundle.keys.merchantPublicKey
    });
    await ingestor.ingest({ receipt: bundle.artifacts.receipt });

    const conflicting = structuredClone(bundle.artifacts.receipt);
    conflicting.issuedAt = "2026-06-24T00:01:47Z";

    const result = await ingestor.ingest({ receipt: conflicting });

    expect(result).toEqual(
      expect.objectContaining({
        status: "conflict",
        statusCode: 409,
        conflictField: "receiptId",
        existingReceiptId: bundle.artifacts.receipt.receiptId
      })
    );
  });

  it("rejects a new receipt with an invalid merchant signature", async () => {
    const bundle = createSampleProtocolArtifacts();
    const store = new InMemoryReceiptIngestionStore();
    const ingestor = new ReceiptIngestor(store, {
      resolveMerchantPublicKey: () => bundle.keys.merchantPublicKey
    });

    const invalid = structuredClone(bundle.artifacts.receipt);
    invalid.receiptId = "rcp_00000000000000000000000000000006";
    invalid.paymentId = "pay_00000000000000000000000000000006";
    invalid.settlementTxSignature = base58Encode(hexToBytes("bb".repeat(64)));

    const result = await ingestor.ingest({ receipt: invalid });

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") {
      throw new Error("expected rejected receipt");
    }
    expect(result.statusCode).toBe(400);
    expect(result.errors).toContain("invalid receipt signature");
    expect(store.listAccruals()).toHaveLength(0);
  });

  it("records a valid unattributed zero-credit receipt without an accrual", async () => {
    const bundle = createSampleProtocolArtifacts();
    const store = new InMemoryReceiptIngestionStore();
    const ingestor = new ReceiptIngestor(store, {
      resolveMerchantPublicKey: () => bundle.keys.merchantPublicKey
    });
    const receipt = createZeroCreditReceipt(bundle.artifacts.receipt);

    const result = await ingestor.ingest({ receipt, source: "merchant" });

    expect(result.status).toBe("created");
    if (result.status !== "created") {
      throw new Error("expected zero-credit receipt creation");
    }
    expect(result.receipt.source).toBe("merchant");
    expect(result.accrual).toBeUndefined();
    expect(result.ledgerTransaction).toBeUndefined();
    expect(store.listAccruals()).toHaveLength(0);
  });
});

function createZeroCreditReceipt(receipt: Split402ReceiptV1): Split402ReceiptV1 {
  const zeroCreditReceipt = structuredClone(receipt);
  zeroCreditReceipt.receiptId = "rcp_00000000000000000000000000000007";
  zeroCreditReceipt.paymentId = "pay_00000000000000000000000000000007";
  zeroCreditReceipt.settlementTxSignature = base58Encode(hexToBytes("cc".repeat(64)));
  zeroCreditReceipt.commissionBps = 0;
  zeroCreditReceipt.commissionAmountAtomic = "0";
  zeroCreditReceipt.protocolFeeAtomic = "0";
  zeroCreditReceipt.referrerCreditAtomic = "0";
  delete zeroCreditReceipt.routeId;
  delete zeroCreditReceipt.referralClaimHash;
  delete zeroCreditReceipt.referrerWallet;
  delete zeroCreditReceipt.payoutWallet;

  return signReceipt(zeroCreditReceipt);
}

function signReceipt(receipt: Split402ReceiptV1): Split402ReceiptV1 {
  const unsignedReceipt = Object.fromEntries(
    Object.entries(receipt).filter(([key]) => key !== "signature")
  ) as Omit<Split402ReceiptV1, "signature">;
  const signed = signEd25519Message(
    buildReceiptSigningBytes(unsignedReceipt),
    MERCHANT_SEED
  );
  return {
    ...unsignedReceipt,
    signature: signed.signature
  };
}

class RacingReceiptStore implements ReceiptIngestionStore {
  constructor(private readonly backingStore: InMemoryReceiptIngestionStore) {}

  getByReceiptId(receiptId: string): ReceiptIngestionSnapshot | undefined {
    return this.backingStore.getByReceiptId(receiptId);
  }

  getByReceiptHash(
    receiptHash: `sha256:${string}`
  ): ReceiptIngestionSnapshot | undefined {
    return this.backingStore.getByReceiptHash(receiptHash);
  }

  getByPaymentId(paymentId: string): ReceiptIngestionSnapshot | undefined {
    return this.backingStore.getByPaymentId(paymentId);
  }

  getBySettlementTxSignature(
    signature: string
  ): ReceiptIngestionSnapshot | undefined {
    return this.backingStore.getBySettlementTxSignature(signature);
  }

  save(snapshot: ReceiptIngestionSnapshot): void {
    this.backingStore.save(snapshot);
    throw new ReceiptIngestionPersistenceConflictError();
  }
}
