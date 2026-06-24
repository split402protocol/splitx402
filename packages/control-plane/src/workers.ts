import type { Split402ReceiptV1 } from "@split402/protocol";

import type {
  OutboxEventRecord,
  OutboxEventStore,
  ReceiptChainVerificationStore,
  ReceiptIngestionSnapshot
} from "./index.js";

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

export interface ReceiptChainVerificationWorkerLoopOptions {
  errorDelayMs?: number;
  maxIterations?: number;
  onError?: (error: unknown) => Promise<void> | void;
  onResult?: (
    result: ReceiptChainVerificationWorkerResult
  ) => Promise<void> | void;
  pollIntervalMs?: number;
  signal?: AbortSignal;
  sleep?: ReceiptChainVerificationWorkerLoopSleep;
  stopOnError?: boolean;
}

export type ReceiptChainVerificationWorkerLoopSleep = (
  delayMs: number,
  signal?: AbortSignal
) => Promise<void> | void;

export interface ReceiptChainVerificationWorkerLoopSummary {
  iterations: number;
  stoppedBy: "aborted" | "max_iterations";
}

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
    const event = await this.outboxStore.claimNext({ now });
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

export async function runReceiptChainVerificationWorkerLoop(
  worker: ReceiptChainVerificationProcessor,
  options: ReceiptChainVerificationWorkerLoopOptions = {}
): Promise<ReceiptChainVerificationWorkerLoopSummary> {
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

      if (result.status === "idle" && !shouldStop(iterations, options)) {
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

function shouldStop(
  iterations: number,
  options: ReceiptChainVerificationWorkerLoopOptions
): boolean {
  return (
    isAborted(options.signal) ||
    hasReachedMaxIterations(iterations, options.maxIterations)
  );
}

async function sleep(
  delayMs: number,
  options: ReceiptChainVerificationWorkerLoopOptions
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
