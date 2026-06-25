import { createHmac } from "node:crypto";

import type { OutboxEventRecord, OutboxEventStore } from "./index.js";

export const WEBHOOK_RECEIPT_ACCEPTED_EVENT_TYPE =
  "webhook.receipt.accepted.v1";

export type WebhookDeliveryResult =
  | {
      status: "delivered";
      statusCode?: number;
    }
  | {
      status: "retry";
      error: string;
      availableAt?: string;
      statusCode?: number;
    }
  | {
      status: "rejected";
      error: string;
      statusCode?: number;
    };

export interface WebhookDispatcher {
  dispatch(
    event: OutboxEventRecord
  ): Promise<WebhookDeliveryResult> | WebhookDeliveryResult;
}

export interface WebhookDispatchProcessor {
  processNext():
    | Promise<WebhookDispatchWorkerResult>
    | WebhookDispatchWorkerResult;
}

export interface WebhookDispatchWorkerOptions {
  eventTypes?: string[];
  maxAttempts?: number;
  now?: () => Date;
  retryDelayMs?: number;
}

export interface WebhookDispatchWorkerLoopOptions {
  errorDelayMs?: number;
  maxIterations?: number;
  onError?: (error: unknown) => Promise<void> | void;
  onResult?: (result: WebhookDispatchWorkerResult) => Promise<void> | void;
  pollIntervalMs?: number;
  signal?: AbortSignal;
  sleep?: WebhookDispatchWorkerLoopSleep;
  stopOnError?: boolean;
}

export type WebhookDispatchWorkerLoopSleep = (
  delayMs: number,
  signal?: AbortSignal
) => Promise<void> | void;

export interface WebhookDispatchWorkerLoopSummary {
  iterations: number;
  stoppedBy: "aborted" | "max_iterations";
}

export type WebhookDispatchWorkerResult =
  | {
      status: "idle";
    }
  | {
      status: "delivered";
      event: OutboxEventRecord;
      statusCode?: number;
    }
  | {
      status: "retry_scheduled";
      event: OutboxEventRecord;
      lastError: string;
      availableAt: string;
      statusCode?: number;
    }
  | {
      status: "dead_letter";
      event: OutboxEventRecord;
      lastError: string;
      statusCode?: number;
    };

export interface WebhookEnvelope {
  id: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface HttpWebhookDispatcherOptions {
  endpointUrl: string;
  secret: string;
  fetch?: WebhookFetch;
  now?: () => Date;
  timeoutMs?: number;
}

export type WebhookFetch = (
  input: string,
  init: {
    body: string;
    headers: Record<string, string>;
    method: "POST";
    signal?: AbortSignal;
  }
) => Promise<WebhookFetchResponse>;

export interface WebhookFetchResponse {
  status: number;
  text?: () => Promise<string>;
}

const DEFAULT_RETRY_DELAY_MS = 60_000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_ATTEMPTS = 10;
const DEFAULT_WEBHOOK_EVENT_TYPES = [WEBHOOK_RECEIPT_ACCEPTED_EVENT_TYPE];

export class WebhookDispatchWorker implements WebhookDispatchProcessor {
  constructor(
    private readonly outboxStore: OutboxEventStore,
    private readonly dispatcher: WebhookDispatcher,
    private readonly options: WebhookDispatchWorkerOptions = {}
  ) {}

  async processNext(): Promise<WebhookDispatchWorkerResult> {
    const now = this.now();
    const event = await this.outboxStore.claimNext({
      now,
      eventTypes: this.eventTypes()
    });
    if (event === undefined) {
      return { status: "idle" };
    }

    let delivery: WebhookDeliveryResult;
    try {
      delivery = await this.dispatcher.dispatch(event);
    } catch (error) {
      delivery = {
        status: "retry",
        error: readErrorMessage(error)
      };
    }

    if (delivery.status === "delivered") {
      await this.outboxStore.markDelivered({ eventId: event.id });
      return {
        status: "delivered",
        event,
        ...(delivery.statusCode === undefined
          ? {}
          : { statusCode: delivery.statusCode })
      };
    }

    if (delivery.status === "retry" && !this.hasExhaustedAttempts(event)) {
      const availableAt = delivery.availableAt ?? this.nextRetryAt(now);
      await this.outboxStore.markFailed({
        eventId: event.id,
        lastError: delivery.error,
        availableAt
      });
      return {
        status: "retry_scheduled",
        event,
        lastError: delivery.error,
        availableAt,
        ...(delivery.statusCode === undefined
          ? {}
          : { statusCode: delivery.statusCode })
      };
    }

    const lastError =
      delivery.status === "retry"
        ? `webhook delivery attempts exhausted: ${delivery.error}`
        : delivery.error;
    await this.outboxStore.markFailed({
      eventId: event.id,
      lastError,
      availableAt: now,
      deadLetter: true
    });
    return {
      status: "dead_letter",
      event,
      lastError,
      ...(delivery.statusCode === undefined
        ? {}
        : { statusCode: delivery.statusCode })
    };
  }

  private eventTypes(): string[] {
    return this.options.eventTypes ?? DEFAULT_WEBHOOK_EVENT_TYPES;
  }

  private hasExhaustedAttempts(event: OutboxEventRecord): boolean {
    return event.attempts >= (this.options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
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

export class HttpWebhookDispatcher implements WebhookDispatcher {
  constructor(private readonly options: HttpWebhookDispatcherOptions) {}

  async dispatch(event: OutboxEventRecord): Promise<WebhookDeliveryResult> {
    const body = JSON.stringify(createWebhookEnvelope(event));
    const timestamp = (this.options.now?.() ?? new Date()).toISOString();
    const abort = new AbortController();
    const timeout =
      this.options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => abort.abort(), this.options.timeoutMs);
    try {
      const response = await (this.options.fetch ?? fetch)(this.options.endpointUrl, {
        method: "POST",
        headers: createWebhookHeaders(event, timestamp, body, this.options.secret),
        body,
        ...(this.options.timeoutMs === undefined ? {} : { signal: abort.signal })
      });
      if (response.status >= 200 && response.status < 300) {
        return { status: "delivered", statusCode: response.status };
      }
      const error = await readWebhookResponseError(response);
      if (isRetryableWebhookStatus(response.status)) {
        return {
          status: "retry",
          statusCode: response.status,
          error
        };
      }
      return {
        status: "rejected",
        statusCode: response.status,
        error
      };
    } catch (error) {
      return {
        status: "retry",
        error: readErrorMessage(error)
      };
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  }
}

export async function runWebhookDispatchWorkerLoop(
  worker: WebhookDispatchProcessor,
  options: WebhookDispatchWorkerLoopOptions = {}
): Promise<WebhookDispatchWorkerLoopSummary> {
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
        await sleep(
          options.errorDelayMs ?? options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
          options
        );
      }
    }
  }

  return { iterations, stoppedBy: "aborted" };
}

export function createWebhookEnvelope(event: OutboxEventRecord): WebhookEnvelope {
  return {
    id: event.id,
    type: event.eventType,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    createdAt: event.createdAt,
    payload: event.payload
  };
}

export function createWebhookSignature(
  secret: string,
  timestamp: string,
  body: string
): string {
  const digest = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return `sha256=${digest}`;
}

function createWebhookHeaders(
  event: OutboxEventRecord,
  timestamp: string,
  body: string,
  secret: string
): Record<string, string> {
  return {
    "content-type": "application/json",
    "split402-event-id": event.id,
    "split402-event-type": event.eventType,
    "split402-event-timestamp": timestamp,
    "split402-webhook-signature": createWebhookSignature(secret, timestamp, body)
  };
}

async function readWebhookResponseError(
  response: WebhookFetchResponse
): Promise<string> {
  const text = await response.text?.();
  if (text !== undefined && text.trim().length > 0) {
    return `webhook returned ${response.status}: ${text.slice(0, 200)}`;
  }
  return `webhook returned ${response.status}`;
}

function isRetryableWebhookStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
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
  options: WebhookDispatchWorkerLoopOptions
): boolean {
  return (
    isAborted(options.signal) ||
    hasReachedMaxIterations(iterations, options.maxIterations)
  );
}

async function sleep(
  delayMs: number,
  options: WebhookDispatchWorkerLoopOptions
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

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
