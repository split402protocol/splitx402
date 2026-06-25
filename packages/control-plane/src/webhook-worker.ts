#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import {
  createControlPlaneRuntimeFromEnv,
  type ControlPlaneRuntime,
  type CreateControlPlaneRuntimeFromEnvOptions
} from "./index.js";
import {
  HttpWebhookDispatcher,
  WebhookDispatchWorker,
  runWebhookDispatchWorkerLoop,
  type WebhookDispatchWorkerLoopOptions,
  type WebhookDispatchWorkerLoopSummary,
  type WebhookDispatchWorkerResult,
  type WebhookFetch
} from "./webhooks.js";

export interface WebhookWorkerConfig {
  endpointUrl: string;
  secret: string;
  errorDelayMs?: number;
  maxAttempts?: number;
  maxIterations?: number;
  pollIntervalMs?: number;
  retryDelayMs?: number;
  stopOnError?: boolean;
  timeoutMs?: number;
}

export interface CreateWebhookWorkerRuntimeFromEnvOptions {
  env?: NodeJS.ProcessEnv;
  fetch?: WebhookFetch;
  poolFactory?: NonNullable<CreateControlPlaneRuntimeFromEnvOptions["poolFactory"]>;
  walletAuth?: CreateControlPlaneRuntimeFromEnvOptions["walletAuth"];
}

export interface WebhookWorkerRuntime {
  close(): Promise<void>;
  config: WebhookWorkerConfig;
  dispatcher: HttpWebhookDispatcher;
  runtime: ControlPlaneRuntime;
  worker: WebhookDispatchWorker;
  run(
    options?: WebhookDispatchWorkerLoopOptions
  ): Promise<WebhookDispatchWorkerLoopSummary>;
}

export function createWebhookWorkerRuntimeFromEnv(
  options: CreateWebhookWorkerRuntimeFromEnvOptions = {}
): WebhookWorkerRuntime {
  const env = options.env ?? process.env;
  const config = readWebhookWorkerConfig(env);
  const runtime = createControlPlaneRuntimeFromEnv({
    env,
    ...(options.poolFactory === undefined ? {} : { poolFactory: options.poolFactory }),
    ...(options.walletAuth === undefined ? {} : { walletAuth: options.walletAuth })
  });
  const dispatcher = new HttpWebhookDispatcher({
    endpointUrl: config.endpointUrl,
    secret: config.secret,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs })
  });
  const worker = new WebhookDispatchWorker(runtime.outboxStore, dispatcher, {
    ...(config.retryDelayMs === undefined ? {} : { retryDelayMs: config.retryDelayMs }),
    ...(config.maxAttempts === undefined ? {} : { maxAttempts: config.maxAttempts })
  });

  return {
    config,
    dispatcher,
    runtime,
    worker,
    close: () => runtime.close(),
    run: (loopOptions = {}) =>
      runWebhookDispatchWorkerLoop(worker, {
        ...createLoopOptions(config),
        ...loopOptions
      })
  };
}

export function readWebhookWorkerConfig(
  env: NodeJS.ProcessEnv = process.env
): WebhookWorkerConfig {
  const endpointUrl = readRequiredUrl(
    env.SPLIT402_WEBHOOK_WORKER_URL,
    "SPLIT402_WEBHOOK_WORKER_URL"
  );
  const secret = readRequiredString(
    env.SPLIT402_WEBHOOK_WORKER_SECRET,
    "SPLIT402_WEBHOOK_WORKER_SECRET"
  );
  const retryDelayMs = readOptionalPositiveInteger(
    env.SPLIT402_WEBHOOK_WORKER_RETRY_DELAY_MS,
    "SPLIT402_WEBHOOK_WORKER_RETRY_DELAY_MS"
  );
  const pollIntervalMs = readOptionalPositiveInteger(
    env.SPLIT402_WEBHOOK_WORKER_POLL_INTERVAL_MS,
    "SPLIT402_WEBHOOK_WORKER_POLL_INTERVAL_MS"
  );
  const errorDelayMs = readOptionalPositiveInteger(
    env.SPLIT402_WEBHOOK_WORKER_ERROR_DELAY_MS,
    "SPLIT402_WEBHOOK_WORKER_ERROR_DELAY_MS"
  );
  const maxIterations = readOptionalPositiveInteger(
    env.SPLIT402_WEBHOOK_WORKER_MAX_ITERATIONS,
    "SPLIT402_WEBHOOK_WORKER_MAX_ITERATIONS"
  );
  const maxAttempts = readOptionalPositiveInteger(
    env.SPLIT402_WEBHOOK_WORKER_MAX_ATTEMPTS,
    "SPLIT402_WEBHOOK_WORKER_MAX_ATTEMPTS"
  );
  const timeoutMs = readOptionalPositiveInteger(
    env.SPLIT402_WEBHOOK_WORKER_TIMEOUT_MS,
    "SPLIT402_WEBHOOK_WORKER_TIMEOUT_MS"
  );
  const stopOnError = readOptionalBoolean(
    env.SPLIT402_WEBHOOK_WORKER_STOP_ON_ERROR,
    "SPLIT402_WEBHOOK_WORKER_STOP_ON_ERROR"
  );

  return {
    endpointUrl,
    secret,
    ...(retryDelayMs === undefined ? {} : { retryDelayMs }),
    ...(pollIntervalMs === undefined ? {} : { pollIntervalMs }),
    ...(errorDelayMs === undefined ? {} : { errorDelayMs }),
    ...(maxIterations === undefined ? {} : { maxIterations }),
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(stopOnError === undefined ? {} : { stopOnError })
  };
}

export async function runWebhookWorkerFromEnv(
  options: CreateWebhookWorkerRuntimeFromEnvOptions = {}
): Promise<WebhookDispatchWorkerLoopSummary> {
  const workerRuntime = createWebhookWorkerRuntimeFromEnv(options);
  try {
    return await workerRuntime.run();
  } finally {
    await workerRuntime.close();
  }
}

export async function main(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return 0;
  }

  let workerRuntime: WebhookWorkerRuntime | undefined;
  const abort = new AbortController();
  const shutdown = (): void => {
    abort.abort();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  try {
    workerRuntime = createWebhookWorkerRuntimeFromEnv({ env });
    const summary = await workerRuntime.run({
      signal: abort.signal,
      onResult: (result) => {
        console.log(
          JSON.stringify({
            service: "split402-webhook-worker",
            result: summarizeWorkerResult(result)
          })
        );
      },
      onError: (error) => {
        console.error(
          JSON.stringify({
            service: "split402-webhook-worker",
            error: readErrorMessage(error)
          })
        );
      }
    });
    console.log(JSON.stringify({ service: "split402-webhook-worker", summary }));
    return 0;
  } catch (error) {
    console.error(readErrorMessage(error));
    return 1;
  } finally {
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
    await workerRuntime?.close();
  }
}

function summarizeWorkerResult(
  result: WebhookDispatchWorkerResult
): Record<string, unknown> {
  if (result.status === "idle") {
    return { status: result.status };
  }
  if (result.status === "delivered") {
    return {
      status: result.status,
      eventId: result.event.id,
      statusCode: result.statusCode
    };
  }
  if (result.status === "retry_scheduled") {
    return {
      status: result.status,
      eventId: result.event.id,
      availableAt: result.availableAt,
      lastError: result.lastError,
      statusCode: result.statusCode
    };
  }
  return {
    status: result.status,
    eventId: result.event.id,
    lastError: result.lastError,
    statusCode: result.statusCode
  };
}

function createLoopOptions(
  config: WebhookWorkerConfig
): WebhookDispatchWorkerLoopOptions {
  return {
    ...(config.pollIntervalMs === undefined
      ? {}
      : { pollIntervalMs: config.pollIntervalMs }),
    ...(config.errorDelayMs === undefined
      ? {}
      : { errorDelayMs: config.errorDelayMs }),
    ...(config.maxIterations === undefined
      ? {}
      : { maxIterations: config.maxIterations }),
    ...(config.stopOnError === undefined
      ? {}
      : { stopOnError: config.stopOnError })
  };
}

function printHelp(): void {
  console.log(`Usage: split402-webhook-worker

Runs the Split402 webhook dispatch worker loop.

Required environment:
  SPLIT402_DATABASE_URL
  SPLIT402_WEBHOOK_WORKER_URL
  SPLIT402_WEBHOOK_WORKER_SECRET

Optional environment:
  SPLIT402_WEBHOOK_WORKER_RETRY_DELAY_MS
  SPLIT402_WEBHOOK_WORKER_POLL_INTERVAL_MS
  SPLIT402_WEBHOOK_WORKER_ERROR_DELAY_MS
  SPLIT402_WEBHOOK_WORKER_MAX_ITERATIONS
  SPLIT402_WEBHOOK_WORKER_MAX_ATTEMPTS
  SPLIT402_WEBHOOK_WORKER_TIMEOUT_MS
  SPLIT402_WEBHOOK_WORKER_STOP_ON_ERROR=true|false`);
}

function readRequiredUrl(value: string | undefined, label: string): string {
  const raw = readRequiredString(value, label);
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("invalid protocol");
    }
    return url.toString();
  } catch {
    throw new Error(`${label} must be an http(s) URL`);
  }
}

function readRequiredString(
  value: string | undefined,
  label: string
): string {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return value;
}

function readOptionalPositiveInteger(
  value: string | undefined,
  label: string
): number | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new Error(`${label} must be a positive integer`);
  }
  return Number.parseInt(value, 10);
}

function readOptionalBoolean(
  value: string | undefined,
  label: string
): boolean | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`${label} must be true or false`);
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (process.argv[1] !== undefined) {
  const invokedPath = resolve(process.argv[1]);
  const modulePath = fileURLToPath(import.meta.url);
  if (invokedPath === modulePath) {
    main().then((code) => {
      process.exitCode = code;
    });
  }
}
