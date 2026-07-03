import type { Split402ReceiptV1 } from "@split402/protocol";

import type {
  OutboxEventRecord,
  OutboxEventStore,
  PayoutFinalityMonitor,
  PayoutReconciliationFinalityResult,
  ReceiptChainVerificationStore,
  ReceiptIngestionSnapshot
} from "./index.js";
import type {
  PayoutTransactionRecord,
  PayoutTransactionStore
} from "./payouts.js";

export type ReceiptChainVerificationResult =
  | {
      status: "confirmed";
      verifiedAt?: string;
    }
  | {
      status: "retry";
      error: string;
      availableAt?: string;
    }
  | {
      status: "rejected";
      error: string;
    };

export interface ReceiptChainVerifier {
  verify(
    receipt: Split402ReceiptV1
  ): Promise<ReceiptChainVerificationResult> | ReceiptChainVerificationResult;
}

export interface ReceiptChainVerificationProcessor {
  processNext():
    | Promise<ReceiptChainVerificationWorkerResult>
    | ReceiptChainVerificationWorkerResult;
}

export interface ReceiptChainVerificationWorkerOptions {
  now?: () => Date;
  retryDelayMs?: number;
}

export interface WorkerLoopOptions<TResult> {
  errorDelayMs?: number;
  maxIterations?: number;
  onError?: (error: unknown) => Promise<void> | void;
  onResult?: (result: TResult) => Promise<void> | void;
  pollIntervalMs?: number;
  signal?: AbortSignal;
  sleep?: WorkerLoopSleep;
  stopOnError?: boolean;
}

export type WorkerLoopSleep = (
  delayMs: number,
  signal?: AbortSignal
) => Promise<void> | void;

export interface WorkerLoopSummary {
  iterations: number;
  stoppedBy: "aborted" | "max_iterations";
}

export type ReceiptChainVerificationWorkerLoopOptions =
  WorkerLoopOptions<ReceiptChainVerificationWorkerResult>;

export type ReceiptChainVerificationWorkerLoopSleep = WorkerLoopSleep;

export type ReceiptChainVerificationWorkerLoopSummary = WorkerLoopSummary;

export type ReceiptChainVerificationWorkerResult =
  | {
      status: "idle";
    }
  | {
      status: "verified";
      event: OutboxEventRecord;
      snapshot: ReceiptIngestionSnapshot;
    }
  | {
      status: "retry_scheduled";
      event: OutboxEventRecord;
      lastError: string;
      availableAt: string;
    }
  | {
      status: "dead_letter";
      event: OutboxEventRecord;
      lastError: string;
    };

export interface PayoutFinalityWorkerOptions {
  now?: () => Date;
  sweepLimit?: number;
}

export interface PayoutFinalityProcessor {
  processNext(): Promise<PayoutFinalityWorkerResult> | PayoutFinalityWorkerResult;
}

export interface PayoutFinalitySweepError {
  transactionId: string;
  error: string;
}

export type PayoutFinalityWorkerResult =
  | {
      status: "idle";
    }
  | {
      status: "swept";
      checked: number;
      updatedTransactions: PayoutTransactionRecord[];
      pendingTransactionIds: string[];
      errors: PayoutFinalitySweepError[];
    };

export type PayoutFinalityWorkerLoopOptions =
  WorkerLoopOptions<PayoutFinalityWorkerResult>;

export type PayoutFinalityWorkerLoopSummary = WorkerLoopSummary;

const RECEIPT_ACCEPTED_EVENT_TYPE = "receipt.accepted.v1";
const DEFAULT_RETRY_DELAY_MS = 60_000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;

export class ReceiptChainVerificationWorker
  implements ReceiptChainVerificationProcessor
{
  constructor(
    private readonly outboxStore: OutboxEventStore,
    private readonly receiptStore: ReceiptChainVerificationStore,
    private readonly verifier: ReceiptChainVerifier,
    private readonly options: ReceiptChainVerificationWorkerOptions = {}
  ) {}

  async processNext(): Promise<ReceiptChainVerificationWorkerResult> {
    const now = this.now();
    const event = await this.outboxStore.claimNext({
      now,
      eventTypes: [RECEIPT_ACCEPTED_EVENT_TYPE]
    });
    if (event === undefined) {
      return { status: "idle" };
    }

    if (event.eventType !== RECEIPT_ACCEPTED_EVENT_TYPE) {
      return this.deadLetter(
        event,
        `unsupported outbox event type: ${event.eventType}`
      );
    }

    const receiptId = readReceiptId(event);
    if (receiptId === undefined) {
      return this.deadLetter(event, "receipt.accepted.v1 payload is missing receiptId");
    }

    const snapshot =
      await this.receiptStore.getReceiptForChainVerification(receiptId);
    if (snapshot === undefined) {
      return this.deadLetter(event, `receipt not found: ${receiptId}`);
    }

    const verification = await this.verifier.verify(snapshot.receipt.receipt);
    if (verification.status === "confirmed") {
      const verified =
        await this.receiptStore.markReceiptChainVerified({
          receiptId,
          verifiedAt: verification.verifiedAt ?? now
        });
      if (verified === undefined) {
        return this.deadLetter(
          event,
          `receipt disappeared during chain verification: ${receiptId}`
        );
      }
      await this.outboxStore.markDelivered({ eventId: event.id });
      return { status: "verified", event, snapshot: verified };
    }

    if (verification.status === "retry") {
      const availableAt = verification.availableAt ?? this.nextRetryAt(now);
      await this.outboxStore.markFailed({
        eventId: event.id,
        lastError: verification.error,
        availableAt
      });
      return {
        status: "retry_scheduled",
        event,
        lastError: verification.error,
        availableAt
      };
    }

    const rejected = await this.receiptStore.markReceiptChainRejected({
      receiptId,
      rejectedAt: now,
      reason: verification.error
    });
    if (rejected === undefined) {
      return this.deadLetter(
        event,
        `receipt disappeared during chain rejection: ${receiptId}`
      );
    }
    return this.deadLetter(event, verification.error);
  }

  private async deadLetter(
    event: OutboxEventRecord,
    lastError: string
  ): Promise<ReceiptChainVerificationWorkerResult> {
    await this.outboxStore.markFailed({
      eventId: event.id,
      lastError,
      availableAt: this.now(),
      deadLetter: true
    });
    return { status: "dead_letter", event, lastError };
  }

  private nextRetryAt(now: string): string {
    return new Date(
      Date.parse(now) + (this.options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS)
    ).toISOString();
  }

  private now(): string {
    return (this.options.now?.() ?? new Date()).toISOString();
  }
}

export class PayoutFinalityWorker implements PayoutFinalityProcessor {
  constructor(
    private readonly transactionStore: PayoutTransactionStore,
    private readonly monitor: PayoutFinalityMonitor,
    private readonly options: PayoutFinalityWorkerOptions = {}
  ) {}

  async processNext(): Promise<PayoutFinalityWorkerResult> {
    const observedAt = this.now();
    const candidates =
      await this.transactionStore.listPayoutTransactionsPendingFinality(
        this.options.sweepLimit === undefined
          ? {}
          : { limit: this.options.sweepLimit }
      );
    if (candidates.length === 0) {
      return { status: "idle" };
    }

    const updatedTransactions: PayoutTransactionRecord[] = [];
    const pendingTransactionIds: string[] = [];
    const errors: PayoutFinalitySweepError[] = [];
    for (const transaction of candidates) {
      try {
        const result = await this.monitor.monitor({ transaction });
        if (result.status === "retry" || result.status === transaction.status) {
          // Re-persisting an unchanged status would rewrite observation
          // timestamps and duplicate lifecycle events on every sweep, so
          // unchanged transactions stay pending until the chain moves.
          pendingTransactionIds.push(transaction.id);
          continue;
        }
        const updated =
          await this.transactionStore.markPayoutTransactionFinality({
            id: transaction.id,
            status: result.status,
            observedAt,
            // Compare-and-set against the listed status so a concurrent
            // sweep replica or an operator reconcile decision is never
            // overwritten with a stale chain observation.
            expectedStatus: transaction.status,
            ...(result.error === undefined
              ? {}
              : { error: createPayoutFinalitySweepErrorDetail(result) })
          });
        if (updated === undefined) {
          // The transaction disappeared or its status changed concurrently;
          // leave it for the next sweep instead of forcing a stale write.
          pendingTransactionIds.push(transaction.id);
          continue;
        }
        updatedTransactions.push(updated);
      } catch (error) {
        errors.push({
          transactionId: transaction.id,
          error: error instanceof Error ? error.message : "unknown error"
        });
      }
    }

    return {
      status: "swept",
      checked: candidates.length,
      updatedTransactions,
      pendingTransactionIds,
      errors
    };
  }

  private now(): string {
    return (this.options.now?.() ?? new Date()).toISOString();
  }
}

function createPayoutFinalitySweepErrorDetail(
  result: PayoutReconciliationFinalityResult
): Record<string, unknown> {
  // rpcUrl is intentionally omitted: RPC URLs can embed provider API keys
  // and this detail is persisted and surfaced through merchant-facing
  // reconciliation responses.
  return {
    message: result.error,
    status: result.status,
    ...(result.signature === undefined ? {} : { signature: result.signature })
  };
}

export async function runReceiptChainVerificationWorkerLoop(
  worker: ReceiptChainVerificationProcessor,
  options: ReceiptChainVerificationWorkerLoopOptions = {}
): Promise<ReceiptChainVerificationWorkerLoopSummary> {
  return runWorkerLoop(worker, options);
}

export async function runPayoutFinalityWorkerLoop(
  worker: PayoutFinalityProcessor,
  options: PayoutFinalityWorkerLoopOptions = {}
): Promise<PayoutFinalityWorkerLoopSummary> {
  // The sweep worker re-checks the same pending set each iteration, so it
  // must pace on the poll interval after every sweep — unlike the queue
  // workers, an immediate re-poll after a non-idle result would busy-spin
  // against Solana RPC and PostgreSQL for the whole confirmation window.
  return runWorkerLoop(worker, options, () => true);
}

async function runWorkerLoop<TResult extends { status: string }>(
  worker: {
    processNext(): Promise<TResult> | TResult;
  },
  options: WorkerLoopOptions<TResult>,
  shouldSleepAfter: (result: TResult) => boolean = (result) =>
    result.status === "idle"
): Promise<WorkerLoopSummary> {
  assertValidMaxIterations(options.maxIterations);
  let iterations = 0;

  while (!isAborted(options.signal)) {
    if (hasReachedMaxIterations(iterations, options.maxIterations)) {
      return { iterations, stoppedBy: "max_iterations" };
    }

    try {
      const result = await worker.processNext();
      iterations += 1;
      await options.onResult?.(result);

      if (shouldSleepAfter(result) && !shouldStop(iterations, options)) {
        await sleep(options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS, options);
      }
    } catch (error) {
      iterations += 1;
      await options.onError?.(error);
      if (options.stopOnError === true) {
        throw error;
      }
      if (!shouldStop(iterations, options)) {
        await sleep(options.errorDelayMs ?? options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS, options);
      }
    }
  }

  return { iterations, stoppedBy: "aborted" };
}

function readReceiptId(event: OutboxEventRecord): string | undefined {
  const receiptId = event.payload.receiptId;
  return typeof receiptId === "string" && receiptId.trim().length > 0
    ? receiptId
    : undefined;
}

function assertValidMaxIterations(maxIterations: number | undefined): void {
  if (
    maxIterations !== undefined &&
    (!Number.isInteger(maxIterations) || maxIterations < 1)
  ) {
    throw new Error("maxIterations must be a positive integer");
  }
}

function hasReachedMaxIterations(
  iterations: number,
  maxIterations: number | undefined
): boolean {
  return maxIterations !== undefined && iterations >= maxIterations;
}

function shouldStop<TResult>(
  iterations: number,
  options: WorkerLoopOptions<TResult>
): boolean {
  return (
    isAborted(options.signal) ||
    hasReachedMaxIterations(iterations, options.maxIterations)
  );
}

async function sleep<TResult>(
  delayMs: number,
  options: WorkerLoopOptions<TResult>
): Promise<void> {
  const sleepFn = options.sleep ?? defaultSleep;
  await sleepFn(delayMs, options.signal);
}

async function defaultSleep(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0 || isAborted(signal)) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, delayMs);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );
  });
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted ?? false;
}
