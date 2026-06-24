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

export interface ReceiptChainVerificationWorkerOptions {
  now?: () => Date;
  retryDelayMs?: number;
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

export class ReceiptChainVerificationWorker {
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

function readReceiptId(event: OutboxEventRecord): string | undefined {
  const receiptId = event.payload.receiptId;
  return typeof receiptId === "string" && receiptId.trim().length > 0
    ? receiptId
    : undefined;
}
