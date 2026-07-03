import { createSampleProtocolArtifacts } from "@split402/protocol";
import { describe, expect, it } from "vitest";

import {
  InMemoryReceiptIngestionStore,
  PayoutFinalityWorker,
  ReceiptChainVerificationWorker,
  ReceiptIngestor,
  WebhookDispatchWorker,
  isPayoutTransactionPendingFinality,
  runPayoutFinalityWorkerLoop,
  runReceiptChainVerificationWorkerLoop,
  runWebhookDispatchWorkerLoop,
  type ListPayoutTransactionsPendingFinalityInput,
  type MarkOutboxEventFailedInput,
  type MarkPayoutTransactionFinalityInput,
  type OutboxEventRecord,
  type OutboxEventStore,
  type PayoutFinalityProcessor,
  type PayoutFinalityWorkerResult,
  type PayoutReconciliationFinalityResult,
  type PayoutTransactionRecord,
  type PayoutTransactionStore,
  type ReceiptChainVerificationProcessor,
  type ReceiptChainVerificationResult,
  type ReceiptChainVerificationWorkerResult,
  type ReceiptChainVerificationStore,
  type ReceiptIngestionSnapshot,
  type WebhookDeliveryResult,
  type WebhookDispatchProcessor,
  type WebhookDispatchWorkerResult
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

  it("marks conclusively rejected chain verification before dead-lettering", async () => {
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
          status: "rejected",
          error: "settlement transfer did not match receipt"
        })
      },
      { now: () => FIXED_NOW }
    );

    const result = await worker.processNext();

    expect(result).toEqual(
      expect.objectContaining({
        status: "dead_letter",
        lastError: "settlement transfer did not match receipt"
      })
    );
    expect(receiptStore.snapshot?.receipt.verificationState).toBe("chain_rejected");
    expect(receiptStore.snapshot?.receipt.verificationReason).toBe(
      "settlement transfer did not match receipt"
    );
    expect(receiptStore.snapshot?.accrual?.status).toBe("rejected");
    expect(outboxStore.event?.status).toBe("dead_letter");
  });
});

describe("runReceiptChainVerificationWorkerLoop", () => {
  it("polls until maxIterations and sleeps between idle results", async () => {
    const sleeps: number[] = [];
    const results: string[] = [];
    const processor = new FakeLoopProcessor([
      { status: "idle" },
      { status: "idle" },
      { status: "idle" }
    ]);

    const summary = await runReceiptChainVerificationWorkerLoop(processor, {
      maxIterations: 3,
      pollIntervalMs: 250,
      sleep: (delayMs) => {
        sleeps.push(delayMs);
      },
      onResult: (result) => {
        results.push(result.status);
      }
    });

    expect(summary).toEqual({ iterations: 3, stoppedBy: "max_iterations" });
    expect(results).toEqual(["idle", "idle", "idle"]);
    expect(sleeps).toEqual([250, 250]);
  });

  it("stops cleanly when aborted by a result callback", async () => {
    const abort = new AbortController();
    const processor = new FakeLoopProcessor([{ status: "idle" }]);
    const sleeps: number[] = [];

    const summary = await runReceiptChainVerificationWorkerLoop(processor, {
      signal: abort.signal,
      sleep: (delayMs) => {
        sleeps.push(delayMs);
      },
      onResult: () => {
        abort.abort();
      }
    });

    expect(summary).toEqual({ iterations: 1, stoppedBy: "aborted" });
    expect(sleeps).toEqual([]);
  });

  it("reports transient processor errors and keeps polling", async () => {
    const errors: string[] = [];
    const sleeps: number[] = [];
    const processor = new FakeLoopProcessor([
      new Error("database unavailable"),
      { status: "idle" }
    ]);

    const summary = await runReceiptChainVerificationWorkerLoop(processor, {
      errorDelayMs: 500,
      maxIterations: 2,
      sleep: (delayMs) => {
        sleeps.push(delayMs);
      },
      onError: (error) => {
        errors.push(error instanceof Error ? error.message : "unknown");
      }
    });

    expect(summary).toEqual({ iterations: 2, stoppedBy: "max_iterations" });
    expect(errors).toEqual(["database unavailable"]);
    expect(sleeps).toEqual([500]);
  });
});

describe("WebhookDispatchWorker", () => {
  it("marks delivered webhook events delivered", async () => {
    const outboxStore = new FakeOutboxEventStore(createWebhookEvent());
    const dispatcher = new FakeWebhookDispatcher([
      { status: "delivered", statusCode: 202 }
    ]);
    const worker = new WebhookDispatchWorker(outboxStore, dispatcher, {
      now: () => FIXED_NOW
    });

    const result = await worker.processNext();

    expect(result).toEqual(
      expect.objectContaining({ status: "delivered", statusCode: 202 })
    );
    expect(dispatcher.events.map((event) => event.eventType)).toEqual([
      "webhook.receipt.accepted.v1"
    ]);
    expect(outboxStore.event?.status).toBe("delivered");
    expect(outboxStore.event?.attempts).toBe(1);
  });

  it("claims payout lifecycle webhook events by default", async () => {
    for (const eventType of [
      "webhook.payout.submitted.v1",
      "webhook.payout.confirmed.v1",
      "webhook.payout.finalized.v1",
      "webhook.payout.failed.v1",
      "webhook.payout.outcome_unknown.v1"
    ]) {
      const outboxStore = new FakeOutboxEventStore(
        createPayoutLifecycleWebhookEvent(eventType)
      );
      const dispatcher = new FakeWebhookDispatcher([
        { status: "delivered", statusCode: 202 }
      ]);
      const worker = new WebhookDispatchWorker(outboxStore, dispatcher, {
        now: () => FIXED_NOW
      });

      await worker.processNext();

      expect(dispatcher.events.map((event) => event.eventType)).toEqual([
        eventType
      ]);
      expect(outboxStore.event?.status).toBe("delivered");
    }
  });

  it("reschedules retryable webhook failures", async () => {
    const outboxStore = new FakeOutboxEventStore(createWebhookEvent());
    const worker = new WebhookDispatchWorker(
      outboxStore,
      new FakeWebhookDispatcher([{ status: "retry", error: "503 unavailable" }]),
      { now: () => FIXED_NOW, retryDelayMs: 120_000 }
    );

    const result = await worker.processNext();

    expect(result).toEqual(
      expect.objectContaining({
        status: "retry_scheduled",
        lastError: "503 unavailable",
        availableAt: "2026-06-24T00:06:00.000Z"
      })
    );
    expect(outboxStore.event?.status).toBe("pending");
    expect(outboxStore.event?.availableAt).toBe("2026-06-24T00:06:00.000Z");
  });

  it("dead-letters rejected or exhausted webhook failures", async () => {
    const rejectedStore = new FakeOutboxEventStore(createWebhookEvent());
    const rejectedWorker = new WebhookDispatchWorker(
      rejectedStore,
      new FakeWebhookDispatcher([{ status: "rejected", error: "400 bad request" }]),
      { now: () => FIXED_NOW }
    );
    const exhaustedStore = new FakeOutboxEventStore({
      ...createWebhookEvent(),
      attempts: 1
    });
    const exhaustedWorker = new WebhookDispatchWorker(
      exhaustedStore,
      new FakeWebhookDispatcher([{ status: "retry", error: "timeout" }]),
      { now: () => FIXED_NOW, maxAttempts: 2 }
    );

    await expect(rejectedWorker.processNext()).resolves.toEqual(
      expect.objectContaining({
        status: "dead_letter",
        lastError: "400 bad request"
      })
    );
    await expect(exhaustedWorker.processNext()).resolves.toEqual(
      expect.objectContaining({
        status: "dead_letter",
        lastError: "webhook delivery attempts exhausted: timeout"
      })
    );
    expect(rejectedStore.event?.status).toBe("dead_letter");
    expect(exhaustedStore.event?.status).toBe("dead_letter");
  });
});

describe("runWebhookDispatchWorkerLoop", () => {
  it("polls webhook workers with idle sleeps and transient errors", async () => {
    const sleeps: number[] = [];
    const errors: string[] = [];
    const processor = new FakeWebhookLoopProcessor([
      { status: "idle" },
      new Error("database unavailable"),
      { status: "idle" }
    ]);

    const summary = await runWebhookDispatchWorkerLoop(processor, {
      maxIterations: 3,
      pollIntervalMs: 250,
      errorDelayMs: 500,
      sleep: (delayMs) => {
        sleeps.push(delayMs);
      },
      onError: (error) => {
        errors.push(error instanceof Error ? error.message : "unknown");
      }
    });

    expect(summary).toEqual({ iterations: 3, stoppedBy: "max_iterations" });
    expect(sleeps).toEqual([250, 500]);
    expect(errors).toEqual(["database unavailable"]);
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

function createWebhookEvent(): OutboxEventRecord {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    eventType: "webhook.receipt.accepted.v1",
    aggregateType: "receipt",
    aggregateId: "rcp_00000000000000000000000000000001",
    payload: {
      receiptId: "rcp_00000000000000000000000000000001",
      merchantId: "mrc_00000000000000000000000000000001"
    },
    status: "pending",
    attempts: 0,
    availableAt: "2026-06-24T00:02:00Z",
    createdAt: "2026-06-24T00:02:00Z"
  };
}

function createPayoutLifecycleWebhookEvent(eventType: string): OutboxEventRecord {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    eventType,
    aggregateType: "payout_batch",
    aggregateId: "pbt_00000000000000000000000000000001",
    payload: {
      payoutBatchId: "pbt_00000000000000000000000000000001",
      merchantId: "mrc_00000000000000000000000000000001",
      totalAmountAtomic: "2000"
    },
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
    const eventTypes = readEventTypes(input);
    if (
      this.event === undefined ||
      this.event.status !== "pending" ||
      Date.parse(this.event.availableAt) > Date.parse(now) ||
      (eventTypes !== undefined && !eventTypes.includes(this.event.eventType))
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

  markReceiptChainRejected(input: {
    receiptId: string;
    rejectedAt: string;
    reason: string;
  }): ReceiptIngestionSnapshot | undefined {
    if (this.snapshot?.receipt.id !== input.receiptId) {
      return undefined;
    }
    this.snapshot = {
      ...this.snapshot,
      receipt: {
        ...this.snapshot.receipt,
        verificationState: "chain_rejected",
        verificationReason: input.reason
      },
      ...(this.snapshot.accrual === undefined
        ? {}
        : {
            accrual: {
              ...this.snapshot.accrual,
              status: "rejected"
            }
          })
    };
    return this.snapshot;
  }
}

class FakeLoopProcessor implements ReceiptChainVerificationProcessor {
  private index = 0;

  constructor(
    private readonly results: Array<ReceiptChainVerificationWorkerResult | Error>
  ) {}

  processNext(): ReceiptChainVerificationWorkerResult {
    const result = this.results[this.index];
    this.index += 1;
    if (result instanceof Error) {
      throw result;
    }
    return result ?? { status: "idle" };
  }
}

describe("PayoutFinalityWorker", () => {
  it("is idle when no payout transactions are pending finality", async () => {
    const store = new FakePayoutTransactionStore([]);
    const monitor = new FakePayoutFinalityMonitor({});
    const worker = new PayoutFinalityWorker(store, monitor, {
      now: () => FIXED_NOW
    });

    const result = await worker.processNext();

    expect(result).toEqual({ status: "idle" });
    expect(store.markedInputs).toEqual([]);
  });

  it("persists chain-observed finality transitions", async () => {
    const submitted = createPendingPayoutTransaction({
      id: "ptx_finalize",
      expectedSignature: "sig_finalize"
    });
    const store = new FakePayoutTransactionStore([submitted]);
    const monitor = new FakePayoutFinalityMonitor({
      ptx_finalize: {
        transactionId: "ptx_finalize",
        status: "finalized",
        signature: "sig_finalize",
        rpcUrl: "https://rpc.example"
      }
    });
    const worker = new PayoutFinalityWorker(store, monitor, {
      now: () => FIXED_NOW
    });

    const result = await worker.processNext();

    expect(result.status).toBe("swept");
    if (result.status !== "swept") {
      throw new Error("expected swept result");
    }
    expect(result.checked).toBe(1);
    expect(result.pendingTransactionIds).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.updatedTransactions.map((transaction) => transaction.status)).toEqual([
      "finalized"
    ]);
    expect(store.markedInputs).toEqual([
      {
        id: "ptx_finalize",
        status: "finalized",
        observedAt: FIXED_NOW.toISOString(),
        expectedStatus: "submitted"
      }
    ]);
  });

  it("keeps retry and unchanged transactions pending without re-persisting", async () => {
    const submitted = createPendingPayoutTransaction({
      id: "ptx_retry",
      expectedSignature: "sig_retry"
    });
    const confirmed = createPendingPayoutTransaction({
      id: "ptx_confirmed",
      expectedSignature: "sig_confirmed",
      status: "confirmed"
    });
    const store = new FakePayoutTransactionStore([submitted, confirmed]);
    const monitor = new FakePayoutFinalityMonitor({
      ptx_retry: {
        transactionId: "ptx_retry",
        status: "retry",
        error: "rpc timeout"
      },
      ptx_confirmed: {
        transactionId: "ptx_confirmed",
        status: "confirmed"
      }
    });
    const worker = new PayoutFinalityWorker(store, monitor, {
      now: () => FIXED_NOW
    });

    const result = await worker.processNext();

    expect(result.status).toBe("swept");
    if (result.status !== "swept") {
      throw new Error("expected swept result");
    }
    expect(result.pendingTransactionIds).toEqual(["ptx_retry", "ptx_confirmed"]);
    expect(result.updatedTransactions).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(store.markedInputs).toEqual([]);
  });

  it("records failed finality outcomes with observed error details", async () => {
    const submitted = createPendingPayoutTransaction({
      id: "ptx_failed",
      expectedSignature: "sig_failed"
    });
    const store = new FakePayoutTransactionStore([submitted]);
    const monitor = new FakePayoutFinalityMonitor({
      ptx_failed: {
        transactionId: "ptx_failed",
        status: "failed",
        signature: "sig_failed",
        rpcUrl: "https://rpc.example",
        error: "custom program error"
      }
    });
    const worker = new PayoutFinalityWorker(store, monitor, {
      now: () => FIXED_NOW
    });

    const result = await worker.processNext();

    expect(result.status).toBe("swept");
    expect(store.markedInputs).toEqual([
      {
        id: "ptx_failed",
        status: "failed",
        observedAt: FIXED_NOW.toISOString(),
        expectedStatus: "submitted",
        error: {
          message: "custom program error",
          status: "failed",
          signature: "sig_failed"
        }
      }
    ]);
  });

  it("records per-transaction sweep errors and continues the sweep", async () => {
    const throwing = createPendingPayoutTransaction({
      id: "ptx_throws",
      expectedSignature: "sig_throws"
    });
    const healthy = createPendingPayoutTransaction({
      id: "ptx_healthy",
      expectedSignature: "sig_healthy"
    });
    const store = new FakePayoutTransactionStore([throwing, healthy]);
    const monitor = new FakePayoutFinalityMonitor({
      ptx_throws: new Error("monitor exploded"),
      ptx_healthy: {
        transactionId: "ptx_healthy",
        status: "finalized"
      }
    });
    const worker = new PayoutFinalityWorker(store, monitor, {
      now: () => FIXED_NOW
    });

    const result = await worker.processNext();

    expect(result.status).toBe("swept");
    if (result.status !== "swept") {
      throw new Error("expected swept result");
    }
    expect(result.errors).toEqual([
      { transactionId: "ptx_throws", error: "monitor exploded" }
    ]);
    expect(result.updatedTransactions.map((transaction) => transaction.id)).toEqual([
      "ptx_healthy"
    ]);
  });

  it("leaves raced or vanished transactions pending instead of forcing writes", async () => {
    const vanishing = createPendingPayoutTransaction({
      id: "ptx_vanishes",
      expectedSignature: "sig_vanishes"
    });
    const store = new FakePayoutTransactionStore([vanishing], {
      vanishOnMark: true
    });
    const monitor = new FakePayoutFinalityMonitor({
      ptx_vanishes: {
        transactionId: "ptx_vanishes",
        status: "finalized"
      }
    });
    const worker = new PayoutFinalityWorker(store, monitor, {
      now: () => FIXED_NOW
    });

    const result = await worker.processNext();

    expect(result.status).toBe("swept");
    if (result.status !== "swept") {
      throw new Error("expected swept result");
    }
    expect(result.errors).toEqual([]);
    expect(result.updatedTransactions).toEqual([]);
    expect(result.pendingTransactionIds).toEqual(["ptx_vanishes"]);
  });

  it("does not overwrite a status that changed concurrently after listing", async () => {
    const submitted = createPendingPayoutTransaction({
      id: "ptx_raced",
      expectedSignature: "sig_raced"
    });
    const store = new FakePayoutTransactionStore([submitted]);
    const monitor = new FakePayoutFinalityMonitor({
      ptx_raced: () => {
        // Simulate an operator reconcile or a concurrent sweep replica
        // finishing between listing and persisting.
        store.forceStatus("ptx_raced", "failed");
        return {
          transactionId: "ptx_raced",
          status: "confirmed"
        };
      }
    });
    const worker = new PayoutFinalityWorker(store, monitor, {
      now: () => FIXED_NOW
    });

    const result = await worker.processNext();

    expect(result.status).toBe("swept");
    if (result.status !== "swept") {
      throw new Error("expected swept result");
    }
    expect(result.updatedTransactions).toEqual([]);
    expect(result.pendingTransactionIds).toEqual(["ptx_raced"]);
    expect(store.statusOf("ptx_raced")).toBe("failed");
  });

  it("excludes signature-less transactions from the sweep", async () => {
    const unsigned = createPendingPayoutTransaction({ id: "ptx_unsigned" });
    delete unsigned.expectedSignature;
    const store = new FakePayoutTransactionStore([unsigned]);
    const monitor = new FakePayoutFinalityMonitor({});
    const worker = new PayoutFinalityWorker(store, monitor, {
      now: () => FIXED_NOW
    });

    const result = await worker.processNext();

    expect(result).toEqual({ status: "idle" });
  });

  it("passes the sweep limit to the transaction store", async () => {
    const store = new FakePayoutTransactionStore([]);
    const monitor = new FakePayoutFinalityMonitor({});
    const worker = new PayoutFinalityWorker(store, monitor, {
      now: () => FIXED_NOW,
      sweepLimit: 7
    });

    await worker.processNext();

    expect(store.listLimits).toEqual([7]);
  });

  it("runs the payout finality worker loop until max iterations", async () => {
    const processor = new FakePayoutFinalityLoopProcessor([
      {
        status: "swept",
        checked: 1,
        updatedTransactions: [],
        pendingTransactionIds: ["ptx_pending"],
        errors: []
      },
      { status: "idle" }
    ]);
    const results: PayoutFinalityWorkerResult[] = [];
    const sleeps: number[] = [];

    const summary = await runPayoutFinalityWorkerLoop(processor, {
      maxIterations: 2,
      pollIntervalMs: 250,
      onResult: (result) => {
        results.push(result);
      },
      sleep: (delayMs) => {
        sleeps.push(delayMs);
      }
    });

    expect(summary).toEqual({ iterations: 2, stoppedBy: "max_iterations" });
    expect(results.map((result) => result.status)).toEqual(["swept", "idle"]);
    // The sweep loop paces on the poll interval after every sweep, including
    // non-idle sweeps, so a stable pending set cannot busy-spin against RPC.
    expect(sleeps).toEqual([250]);
  });
});

class FakePayoutTransactionStore implements PayoutTransactionStore {
  readonly listLimits: Array<number | undefined> = [];
  readonly markedInputs: MarkPayoutTransactionFinalityInput[] = [];
  private transactions: PayoutTransactionRecord[];

  constructor(
    transactions: PayoutTransactionRecord[],
    private readonly options: { vanishOnMark?: boolean } = {}
  ) {
    this.transactions = transactions;
  }

  saveSignedPayoutTransactions(): never {
    throw new Error("not implemented");
  }

  listPayoutTransactions(): never {
    throw new Error("not implemented");
  }

  listPayoutTransactionsPendingFinality(
    input: ListPayoutTransactionsPendingFinalityInput = {}
  ): PayoutTransactionRecord[] {
    this.listLimits.push(input.limit);
    return this.transactions.filter(isPayoutTransactionPendingFinality);
  }

  markPayoutTransactionSubmitted(): never {
    throw new Error("not implemented");
  }

  forceStatus(id: string, status: PayoutTransactionRecord["status"]): void {
    this.transactions = this.transactions.map((transaction) =>
      transaction.id === id ? { ...transaction, status } : transaction
    );
  }

  statusOf(id: string): PayoutTransactionRecord["status"] | undefined {
    return this.transactions.find((transaction) => transaction.id === id)
      ?.status;
  }

  markPayoutTransactionFinality(
    input: MarkPayoutTransactionFinalityInput
  ): PayoutTransactionRecord | undefined {
    this.markedInputs.push(input);
    if (this.options.vanishOnMark === true) {
      return undefined;
    }
    const existing = this.transactions.find(
      (transaction) => transaction.id === input.id
    );
    if (existing === undefined) {
      return undefined;
    }
    if (
      input.expectedStatus !== undefined &&
      existing.status !== input.expectedStatus
    ) {
      return undefined;
    }
    const updated: PayoutTransactionRecord = {
      ...existing,
      status: input.status,
      ...(input.error === undefined ? {} : { error: input.error })
    };
    this.transactions = this.transactions.map((transaction) =>
      transaction.id === input.id ? updated : transaction
    );
    return updated;
  }
}

class FakePayoutFinalityMonitor {
  constructor(
    private readonly results: Record<
      string,
      | PayoutReconciliationFinalityResult
      | Error
      | (() => PayoutReconciliationFinalityResult)
    >
  ) {}

  monitor(input: {
    transaction: PayoutTransactionRecord;
  }): PayoutReconciliationFinalityResult {
    const result = this.results[input.transaction.id];
    if (result === undefined) {
      throw new Error(`unexpected transaction: ${input.transaction.id}`);
    }
    if (result instanceof Error) {
      throw result;
    }
    if (typeof result === "function") {
      return result();
    }
    return result;
  }
}

class FakePayoutFinalityLoopProcessor implements PayoutFinalityProcessor {
  private index = 0;

  constructor(
    private readonly results: Array<PayoutFinalityWorkerResult | Error>
  ) {}

  processNext(): PayoutFinalityWorkerResult {
    const result = this.results[this.index];
    this.index += 1;
    if (result instanceof Error) {
      throw result;
    }
    return result ?? { status: "idle" };
  }
}

function createPendingPayoutTransaction(
  overrides: Partial<PayoutTransactionRecord> = {}
): PayoutTransactionRecord {
  return {
    id: "ptx_default",
    payoutBatchId: "pb_default",
    sequence: 0,
    attempt: 1,
    signedTransactionBase64: "AQID",
    expectedSignature: "sig_default",
    status: "submitted",
    submittedAt: "2026-06-24T00:03:00.000Z",
    createdAt: "2026-06-24T00:02:00.000Z",
    items: [],
    ...overrides
  };
}

class FakeWebhookDispatcher {
  readonly events: OutboxEventRecord[] = [];

  constructor(private readonly results: WebhookDeliveryResult[]) {}

  dispatch(event: OutboxEventRecord): WebhookDeliveryResult {
    this.events.push(event);
    return this.results.shift() ?? { status: "delivered" };
  }
}

class FakeWebhookLoopProcessor implements WebhookDispatchProcessor {
  private index = 0;

  constructor(
    private readonly results: Array<WebhookDispatchWorkerResult | Error>
  ) {}

  processNext(): WebhookDispatchWorkerResult {
    const result = this.results[this.index];
    this.index += 1;
    if (result instanceof Error) {
      throw result;
    }
    return result ?? { status: "idle" };
  }
}

function readNow(input: { now?: string }): string {
  return input.now ?? new Date().toISOString();
}

function readEventTypes(input: { eventTypes?: string[] }): string[] | undefined {
  return input.eventTypes;
}

function withoutOutboxOptionals(
  event: OutboxEventRecord
): Omit<OutboxEventRecord, "lockedAt" | "lastError"> {
  const copy: OutboxEventRecord = { ...event };
  delete copy.lockedAt;
  delete copy.lastError;
  return copy;
}
