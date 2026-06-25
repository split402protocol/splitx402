import {
  Split402ReceiptV1Schema,
  hashProtocolObject,
  type Split402ReceiptV1
} from "@split402/protocol";
import { randomBytes } from "node:crypto";

export type MerchantReceiptOutboxStatus =
  | "pending"
  | "accepted"
  | "dead_letter";

export interface MerchantReceiptOutboxRecord {
  id: string;
  receiptId: string;
  receiptHash: `sha256:${string}`;
  receiptJson: Split402ReceiptV1;
  attempts: number;
  nextAttemptAt: string;
  status: MerchantReceiptOutboxStatus;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
}

export interface EnqueueMerchantReceiptInput {
  id?: string;
  receipt: Split402ReceiptV1;
  now?: string;
  nextAttemptAt?: string;
}

export interface MerchantReceiptOutboxStore {
  enqueueReceipt(
    input: EnqueueMerchantReceiptInput
  ): Promise<MerchantReceiptOutboxRecord> | MerchantReceiptOutboxRecord;
  claimNextPending(
    input: ClaimNextMerchantReceiptInput
  ): Promise<MerchantReceiptOutboxRecord | undefined> | MerchantReceiptOutboxRecord | undefined;
  markAccepted(
    input: MarkMerchantReceiptAcceptedInput
  ): Promise<MerchantReceiptOutboxRecord | undefined> | MerchantReceiptOutboxRecord | undefined;
  markRetry(
    input: MarkMerchantReceiptRetryInput
  ): Promise<MerchantReceiptOutboxRecord | undefined> | MerchantReceiptOutboxRecord | undefined;
  markDeadLetter(
    input: MarkMerchantReceiptDeadLetterInput
  ): Promise<MerchantReceiptOutboxRecord | undefined> | MerchantReceiptOutboxRecord | undefined;
  getByReceiptId(
    receiptId: string
  ): Promise<MerchantReceiptOutboxRecord | undefined> | MerchantReceiptOutboxRecord | undefined;
}

export interface ClaimNextMerchantReceiptInput {
  now: string;
}

export interface MarkMerchantReceiptAcceptedInput {
  id: string;
  attempts: number;
  now: string;
}

export interface MarkMerchantReceiptRetryInput {
  id: string;
  attempts: number;
  lastError: string;
  nextAttemptAt: string;
  now: string;
}

export interface MarkMerchantReceiptDeadLetterInput {
  id: string;
  attempts: number;
  lastError: string;
  now: string;
}

export interface MerchantReceiptSubmitter {
  submitReceipt(
    receipt: Split402ReceiptV1
  ): Promise<MerchantReceiptSubmissionResult> | MerchantReceiptSubmissionResult;
}

export type MerchantReceiptSubmissionResult =
  | {
      status: "accepted";
      statusCode?: number;
      responseStatus?: string;
    }
  | {
      status: "retry";
      error: string;
      statusCode?: number;
    }
  | {
      status: "rejected";
      error: string;
      statusCode?: number;
      responseStatus?: string;
    };

export interface MerchantReceiptOutboxDispatcherOptions {
  maxAttempts?: number;
  now?: () => Date;
  retryDelayMs?: number;
}

export type MerchantReceiptOutboxDispatchResult =
  | { status: "idle" }
  | {
      status: "accepted";
      record: MerchantReceiptOutboxRecord;
      submission: Extract<MerchantReceiptSubmissionResult, { status: "accepted" }>;
    }
  | {
      status: "retry_scheduled";
      record: MerchantReceiptOutboxRecord;
      lastError: string;
      nextAttemptAt: string;
    }
  | {
      status: "dead_letter";
      record: MerchantReceiptOutboxRecord;
      lastError: string;
    };

export class MerchantReceiptOutboxConflictError extends Error {
  readonly code = "merchant_receipt_outbox_conflict";

  constructor(message: string) {
    super(message);
    this.name = "MerchantReceiptOutboxConflictError";
  }
}

export class InMemoryMerchantReceiptOutboxStore
  implements MerchantReceiptOutboxStore
{
  private readonly recordsById = new Map<string, MerchantReceiptOutboxRecord>();
  private readonly recordIdByReceiptId = new Map<string, string>();

  enqueueReceipt(input: EnqueueMerchantReceiptInput): MerchantReceiptOutboxRecord {
    const receipt = parseReceipt(input.receipt);
    const receiptHash = hashProtocolObject(receipt);
    const existingId = this.recordIdByReceiptId.get(receipt.receiptId);
    if (existingId !== undefined) {
      const existing = this.recordsById.get(existingId);
      if (existing !== undefined && existing.receiptHash === receiptHash) {
        return cloneRecord(existing);
      }
      throw new MerchantReceiptOutboxConflictError(
        `receipt already enqueued with different hash: ${receipt.receiptId}`
      );
    }

    const now = assertUtc(input.now ?? new Date().toISOString(), "now");
    const record: MerchantReceiptOutboxRecord = {
      id: input.id ?? createMerchantReceiptOutboxId(),
      receiptId: receipt.receiptId,
      receiptHash,
      receiptJson: receipt,
      attempts: 0,
      nextAttemptAt: assertUtc(input.nextAttemptAt ?? now, "nextAttemptAt"),
      status: "pending",
      createdAt: now,
      updatedAt: now
    };
    this.recordsById.set(record.id, record);
    this.recordIdByReceiptId.set(record.receiptId, record.id);
    return cloneRecord(record);
  }

  claimNextPending(
    input: ClaimNextMerchantReceiptInput
  ): MerchantReceiptOutboxRecord | undefined {
    const now = Date.parse(assertUtc(input.now, "now"));
    const record = Array.from(this.recordsById.values())
      .filter(
        (candidate) =>
          candidate.status === "pending" &&
          Date.parse(candidate.nextAttemptAt) <= now
      )
      .sort(comparePendingRecords)[0];
    return record === undefined ? undefined : cloneRecord(record);
  }

  markAccepted(
    input: MarkMerchantReceiptAcceptedInput
  ): MerchantReceiptOutboxRecord | undefined {
    const record = this.recordsById.get(input.id);
    if (record === undefined) {
      return undefined;
    }
    const updated = {
      ...record,
      attempts: input.attempts,
      status: "accepted" as const,
      updatedAt: assertUtc(input.now, "now")
    };
    delete updated.lastError;
    this.recordsById.set(updated.id, updated);
    return cloneRecord(updated);
  }

  markRetry(
    input: MarkMerchantReceiptRetryInput
  ): MerchantReceiptOutboxRecord | undefined {
    const record = this.recordsById.get(input.id);
    if (record === undefined) {
      return undefined;
    }
    const updated: MerchantReceiptOutboxRecord = {
      ...record,
      attempts: input.attempts,
      nextAttemptAt: assertUtc(input.nextAttemptAt, "nextAttemptAt"),
      status: "pending",
      updatedAt: assertUtc(input.now, "now"),
      lastError: input.lastError
    };
    this.recordsById.set(updated.id, updated);
    return cloneRecord(updated);
  }

  markDeadLetter(
    input: MarkMerchantReceiptDeadLetterInput
  ): MerchantReceiptOutboxRecord | undefined {
    const record = this.recordsById.get(input.id);
    if (record === undefined) {
      return undefined;
    }
    const updated: MerchantReceiptOutboxRecord = {
      ...record,
      attempts: input.attempts,
      status: "dead_letter",
      updatedAt: assertUtc(input.now, "now"),
      lastError: input.lastError
    };
    this.recordsById.set(updated.id, updated);
    return cloneRecord(updated);
  }

  getByReceiptId(receiptId: string): MerchantReceiptOutboxRecord | undefined {
    const id = this.recordIdByReceiptId.get(receiptId);
    if (id === undefined) {
      return undefined;
    }
    const record = this.recordsById.get(id);
    return record === undefined ? undefined : cloneRecord(record);
  }
}

export class MerchantReceiptOutboxDispatcher {
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;

  constructor(
    private readonly store: MerchantReceiptOutboxStore,
    private readonly submitter: MerchantReceiptSubmitter,
    options: MerchantReceiptOutboxDispatcherOptions = {}
  ) {
    this.maxAttempts = options.maxAttempts ?? 10;
    this.retryDelayMs = options.retryDelayMs ?? 60_000;
    if (!Number.isInteger(this.maxAttempts) || this.maxAttempts <= 0) {
      throw new Error("maxAttempts must be a positive integer");
    }
    if (!Number.isInteger(this.retryDelayMs) || this.retryDelayMs <= 0) {
      throw new Error("retryDelayMs must be a positive integer");
    }
    this.now = options.now ?? (() => new Date());
  }

  private readonly now: () => Date;

  async dispatchNext(): Promise<MerchantReceiptOutboxDispatchResult> {
    const now = this.now().toISOString();
    const record = await this.store.claimNextPending({ now });
    if (record === undefined) {
      return { status: "idle" };
    }

    const attempts = record.attempts + 1;
    const submission = await this.submitter.submitReceipt(record.receiptJson);
    if (submission.status === "accepted") {
      const accepted = await this.store.markAccepted({
        id: record.id,
        attempts,
        now
      });
      return {
        status: "accepted",
        record: accepted ?? record,
        submission
      };
    }

    const lastError = submission.error;
    if (submission.status === "rejected" || attempts >= this.maxAttempts) {
      const deadLetter = await this.store.markDeadLetter({
        id: record.id,
        attempts,
        lastError,
        now
      });
      return {
        status: "dead_letter",
        record: deadLetter ?? record,
        lastError
      };
    }

    const nextAttemptAt = new Date(
      Date.parse(now) + this.retryDelayMs
    ).toISOString();
    const retry = await this.store.markRetry({
      id: record.id,
      attempts,
      lastError,
      nextAttemptAt,
      now
    });
    return {
      status: "retry_scheduled",
      record: retry ?? record,
      lastError,
      nextAttemptAt
    };
  }
}

export interface ControlPlaneReceiptSubmitterOptions {
  controlPlaneUrl: string;
  fetch?: MerchantReceiptFetch;
}

export type MerchantReceiptFetch = (
  input: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
  }
) => Promise<MerchantReceiptFetchResponse>;

export interface MerchantReceiptFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export class ControlPlaneReceiptSubmitter implements MerchantReceiptSubmitter {
  constructor(private readonly options: ControlPlaneReceiptSubmitterOptions) {}

  async submitReceipt(
    receipt: Split402ReceiptV1
  ): Promise<MerchantReceiptSubmissionResult> {
    let response: MerchantReceiptFetchResponse;
    try {
      response = await this.fetch()(this.receiptsUrl(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ receipt, source: "merchant" })
      });
    } catch (error) {
      return {
        status: "retry",
        error: `receipt submission failed: ${readErrorMessage(error)}`
      };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      return {
        status: response.ok ? "retry" : classifyHttpFailure(response.status),
        statusCode: response.status,
        error: `receipt submission response was invalid JSON: ${readErrorMessage(error)}`
      };
    }

    if (response.ok) {
      const responseStatus = readOptionalStatus(body);
      if (
        responseStatus === undefined ||
        responseStatus === "created" ||
        responseStatus === "duplicate" ||
        responseStatus === "accepted"
      ) {
        return {
          status: "accepted",
          statusCode: response.status,
          ...(responseStatus === undefined ? {} : { responseStatus })
        };
      }
      return {
        status: "rejected",
        statusCode: response.status,
        responseStatus,
        error: `control plane returned unexpected receipt status: ${responseStatus}`
      };
    }

    const error = readSubmissionError(body) ?? `HTTP ${response.status}`;
    const failureStatus = classifyHttpFailure(response.status);
    if (failureStatus === "retry") {
      return {
        status: "retry",
        statusCode: response.status,
        error
      };
    }
    const responseStatus = readOptionalStatus(body);
    return {
      status: "rejected",
      statusCode: response.status,
      ...(responseStatus === undefined ? {} : { responseStatus }),
      error
    };
  }

  private receiptsUrl(): string {
    return new URL("/v1/receipts", this.options.controlPlaneUrl).toString();
  }

  private fetch(): MerchantReceiptFetch {
    return this.options.fetch ?? fetch;
  }
}

function parseReceipt(receipt: Split402ReceiptV1): Split402ReceiptV1 {
  return Split402ReceiptV1Schema.parse(receipt);
}

function createMerchantReceiptOutboxId(): string {
  return `mro_${randomBytes(16).toString("hex")}`;
}

function cloneRecord(
  record: MerchantReceiptOutboxRecord
): MerchantReceiptOutboxRecord {
  return {
    ...record,
    receiptJson: {
      ...record.receiptJson,
      ...(record.receiptJson.routeId === undefined
        ? {}
        : { routeId: record.receiptJson.routeId })
    }
  };
}

function comparePendingRecords(
  left: MerchantReceiptOutboxRecord,
  right: MerchantReceiptOutboxRecord
): number {
  const nextAttemptComparison =
    Date.parse(left.nextAttemptAt) - Date.parse(right.nextAttemptAt);
  if (nextAttemptComparison !== 0) {
    return nextAttemptComparison;
  }
  const createdAtComparison =
    Date.parse(left.createdAt) - Date.parse(right.createdAt);
  if (createdAtComparison !== 0) {
    return createdAtComparison;
  }
  return left.id.localeCompare(right.id);
}

function assertUtc(value: string, label: string): string {
  if (!value.endsWith("Z") || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be a UTC timestamp`);
  }
  return value;
}

function classifyHttpFailure(status: number): "retry" | "rejected" {
  return status === 408 ||
    status === 425 ||
    status === 429 ||
    status >= 500
    ? "retry"
    : "rejected";
}

function readOptionalStatus(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }
  const status = (body as Record<string, unknown>).status;
  return typeof status === "string" ? status : undefined;
}

function readSubmissionError(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }
  const record = body as Record<string, unknown>;
  if (typeof record.error === "string") {
    return record.error;
  }
  if (
    Array.isArray(record.errors) &&
    record.errors.every((item) => typeof item === "string")
  ) {
    return record.errors.join("; ");
  }
  return undefined;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
