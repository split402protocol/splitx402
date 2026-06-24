import { createSampleProtocolArtifacts } from "@split402/protocol";
import { describe, expect, it } from "vitest";

import {
  InMemoryReceiptIngestionStore,
  ReceiptChainVerificationWorker,
  ReceiptIngestor,
  type MarkOutboxEventFailedInput,
  type OutboxEventRecord,
  type OutboxEventStore,
  type ReceiptChainVerificationResult,
  type ReceiptChainVerificationStore,
  type ReceiptIngestionSnapshot
} from "../src/index.js";

const FIXED_NOW = new Date("2026-06-24T00:04:00Z");

describe("ReceiptChainVerificationWorker", () => {
  it("marks confirmed receipts verified, accruals available, and events delivered", async () => {
    const bundle = createSampleProtocolArtifacts();
    const snapshot = await createSnapshot();
    const outboxStore = new FakeOutboxEventStore(
      createReceiptAcceptedEvent(bundle.artifacts.receipt.receiptId)
    );
    const receiptStore = new FakeReceiptChainVerificationStore(snapshot);
    const worker = new ReceiptChainVerificationWorker(
      outboxStore,
      receiptStore,
      {
        verify: () => ({
          status: "confirmed",
          verifiedAt: "2026-06-24T00:04:30Z"
        })
      },
      { now: () => FIXED_NOW }
    );

    const result = await worker.processNext();

    expect(result.status).toBe("verified");
    expect(receiptStore.snapshot?.receipt.verificationState).toBe(
      "signature_verified"
    );
    expect(receiptStore.snapshot?.accrual?.status).toBe("available");
    expect(receiptStore.snapshot?.accrual?.availableAt).toBe(
      "2026-06-24T00:04:30Z"
    );
    expect(outboxStore.event?.status).toBe("delivered");
    expect(outboxStore.event?.attempts).toBe(1);
  });

  it("reschedules retryable verification failures", async () => {
    const bundle = createSampleProtocolArtifacts();
    const snapshot = await createSnapshot();
    const outboxStore = new FakeOutboxEventStore(
      createReceiptAcceptedEvent(bundle.artifacts.receipt.receiptId)
    );
    const worker = new ReceiptChainVerificationWorker(
      outboxStore,
      new FakeReceiptChainVerificationStore(snapshot),
      {
        verify: (): ReceiptChainVerificationResult => ({
          status: "retry",
          error: "rpc unavailable"
        })
      },
      { now: () => FIXED_NOW, retryDelayMs: 120_000 }
    );

    const result = await worker.processNext();

    expect(result).toEqual(
      expect.objectContaining({
        status: "retry_scheduled",
        lastError: "rpc unavailable",
        availableAt: "2026-06-24T00:06:00.000Z"
      })
    );
    expect(outboxStore.event?.status).toBe("pending");
    expect(outboxStore.event?.availableAt).toBe("2026-06-24T00:06:00.000Z");
    expect(outboxStore.event?.lastError).toBe("rpc unavailable");
  });

  it("dead-letters rejected or malformed verification events", async () => {
    const outboxStore = new FakeOutboxEventStore({
      ...createReceiptAcceptedEvent(""),
      payload: {}
    });
    const worker = new ReceiptChainVerificationWorker(
      outboxStore,
      new FakeReceiptChainVerificationStore(undefined),
      {
        verify: () => ({
          status: "rejected",
          error: "should not be called"
        })
      },
      { now: () => FIXED_NOW }
    );

    const result = await worker.processNext();

    expect(result).toEqual(
      expect.objectContaining({
        status: "dead_letter",
        lastError: "receipt.accepted.v1 payload is missing receiptId"
      })
    );
    expect(outboxStore.event?.status).toBe("dead_letter");
  });
});

async function createSnapshot(): Promise<ReceiptIngestionSnapshot> {
  const bundle = createSampleProtocolArtifacts();
  const store = new InMemoryReceiptIngestionStore();
  const ingestor = new ReceiptIngestor(store, {
    resolveMerchantPublicKey: () => bundle.keys.merchantPublicKey,
    now: () => new Date("2026-06-24T00:02:00Z")
  });
  const result = await ingestor.ingest({
    receipt: bundle.artifacts.receipt,
    source: "merchant"
  });
  if (result.status !== "created") {
    throw new Error("expected created receipt");
  }
  return result;
}

function createReceiptAcceptedEvent(receiptId: string): OutboxEventRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    eventType: "receipt.accepted.v1",
    aggregateType: "receipt",
    aggregateId: receiptId,
    payload: { receiptId },
    status: "pending",
    attempts: 0,
    availableAt: "2026-06-24T00:02:00Z",
    createdAt: "2026-06-24T00:02:00Z"
  };
}

class FakeOutboxEventStore implements OutboxEventStore {
  constructor(public event: OutboxEventRecord | undefined) {}

  getEvent(eventId: string): OutboxEventRecord | undefined {
    return this.event?.id === eventId ? this.event : undefined;
  }

  claimNext(input = {}): OutboxEventRecord | undefined {
    const now = readNow(input);
    if (
      this.event === undefined ||
      this.event.status !== "pending" ||
      Date.parse(this.event.availableAt) > Date.parse(now)
    ) {
      return undefined;
    }
    this.event = {
      ...withoutOutboxOptionals(this.event),
      status: "processing",
      attempts: this.event.attempts + 1,
      lockedAt: now
    };
    return this.event;
  }

  markDelivered(): OutboxEventRecord | undefined {
    if (this.event === undefined || this.event.status !== "processing") {
      return undefined;
    }
    this.event = {
      ...withoutOutboxOptionals(this.event),
      status: "delivered"
    };
    return this.event;
  }

  markFailed(input: MarkOutboxEventFailedInput): OutboxEventRecord | undefined {
    if (this.event === undefined || this.event.status !== "processing") {
      return undefined;
    }
    this.event = {
      ...withoutOutboxOptionals(this.event),
      status: input.deadLetter === true ? "dead_letter" : "pending",
      availableAt: input.availableAt,
      lastError: input.lastError
    };
    return this.event;
  }
}

class FakeReceiptChainVerificationStore implements ReceiptChainVerificationStore {
  constructor(public snapshot: ReceiptIngestionSnapshot | undefined) {}

  getReceiptForChainVerification(
    receiptId: string
  ): ReceiptIngestionSnapshot | undefined {
    return this.snapshot?.receipt.id === receiptId ? this.snapshot : undefined;
  }

  markReceiptChainVerified(input: {
    receiptId: string;
    verifiedAt: string;
  }): ReceiptIngestionSnapshot | undefined {
    if (this.snapshot?.receipt.id !== input.receiptId) {
      return undefined;
    }
    this.snapshot = {
      ...this.snapshot,
      receipt: {
        ...this.snapshot.receipt,
        verificationState: "signature_verified"
      },
      ...(this.snapshot.accrual === undefined
        ? {}
        : {
            accrual: {
              ...this.snapshot.accrual,
              status: "available",
              availableAt: input.verifiedAt
            }
          })
    };
    return this.snapshot;
  }
}

function readNow(input: { now?: string }): string {
  return input.now ?? new Date().toISOString();
}

function withoutOutboxOptionals(
  event: OutboxEventRecord
): Omit<OutboxEventRecord, "lockedAt" | "lastError"> {
  const copy: OutboxEventRecord = { ...event };
  delete copy.lockedAt;
  delete copy.lastError;
  return copy;
}
