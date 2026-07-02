#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import {
  createControlPlaneRuntimeFromEnv,
  createPayoutFinalityMonitorFromEnv,
  type ControlPlaneRuntime,
  type CreateControlPlaneRuntimeFromEnvOptions,
  type PayoutFinalityMonitor
} from "./index.js";
import {
  PayoutFinalityWorker,
  runPayoutFinalityWorkerLoop,
  type PayoutFinalityWorkerLoopOptions,
  type PayoutFinalityWorkerLoopSummary,
  type PayoutFinalityWorkerResult
} from "./workers.js";

export interface PayoutFinalityWorkerConfig {
  errorDelayMs?: number;
  maxIterations?: number;
  pollIntervalMs?: number;
  stopOnError?: boolean;
  sweepLimit?: number;
}

export interface CreatePayoutFinalityWorkerRuntimeFromEnvOptions {
  env?: NodeJS.ProcessEnv;
  monitor?: PayoutFinalityMonitor;
  poolFactory?: NonNullable<CreateControlPlaneRuntimeFromEnvOptions["poolFactory"]>;
  walletAuth?: CreateControlPlaneRuntimeFromEnvOptions["walletAuth"];
}

export interface PayoutFinalityWorkerRuntime {
  close(): Promise<void>;
  config: PayoutFinalityWorkerConfig;
  monitor: PayoutFinalityMonitor;
  runtime: ControlPlaneRuntime;
  worker: PayoutFinalityWorker;
  run(
    options?: PayoutFinalityWorkerLoopOptions
  ): Promise<PayoutFinalityWorkerLoopSummary>;
}

export function createPayoutFinalityWorkerRuntimeFromEnv(
  options: CreatePayoutFinalityWorkerRuntimeFromEnvOptions = {}
): PayoutFinalityWorkerRuntime {
  const env = options.env ?? process.env;
  const config = readPayoutFinalityWorkerConfig(env);
  const runtime = createControlPlaneRuntimeFromEnv({
    env,
    ...(options.poolFactory === undefined ? {} : { poolFactory: options.poolFactory }),
    ...(options.walletAuth === undefined ? {} : { walletAuth: options.walletAuth })
  });
  const monitor = options.monitor ?? createPayoutFinalityMonitorFromEnv(env);
  const worker = new PayoutFinalityWorker(
    runtime.receiptStore,
    monitor,
    config.sweepLimit === undefined ? {} : { sweepLimit: config.sweepLimit }
  );

  return {
    config,
    monitor,
    runtime,
    worker,
    close: () => runtime.close(),
    run: (loopOptions = {}) =>
      runPayoutFinalityWorkerLoop(worker, {
        ...createLoopOptions(config),
        ...loopOptions
      })
  };
}

export function readPayoutFinalityWorkerConfig(
  env: NodeJS.ProcessEnv = process.env
): PayoutFinalityWorkerConfig {
  const sweepLimit = readOptionalPositiveInteger(
    env.SPLIT402_PAYOUT_FINALITY_WORKER_SWEEP_LIMIT,
    "SPLIT402_PAYOUT_FINALITY_WORKER_SWEEP_LIMIT"
  );
  const pollIntervalMs = readOptionalPositiveInteger(
    env.SPLIT402_PAYOUT_FINALITY_WORKER_POLL_INTERVAL_MS,
    "SPLIT402_PAYOUT_FINALITY_WORKER_POLL_INTERVAL_MS"
  );
  const errorDelayMs = readOptionalPositiveInteger(
    env.SPLIT402_PAYOUT_FINALITY_WORKER_ERROR_DELAY_MS,
    "SPLIT402_PAYOUT_FINALITY_WORKER_ERROR_DELAY_MS"
  );
  const maxIterations = readOptionalPositiveInteger(
    env.SPLIT402_PAYOUT_FINALITY_WORKER_MAX_ITERATIONS,
    "SPLIT402_PAYOUT_FINALITY_WORKER_MAX_ITERATIONS"
  );
  const stopOnError = readOptionalBoolean(
    env.SPLIT402_PAYOUT_FINALITY_WORKER_STOP_ON_ERROR,
    "SPLIT402_PAYOUT_FINALITY_WORKER_STOP_ON_ERROR"
  );

  return {
    ...(sweepLimit === undefined ? {} : { sweepLimit }),
    ...(pollIntervalMs === undefined ? {} : { pollIntervalMs }),
    ...(errorDelayMs === undefined ? {} : { errorDelayMs }),
    ...(maxIterations === undefined ? {} : { maxIterations }),
    ...(stopOnError === undefined ? {} : { stopOnError })
  };
}

export async function runPayoutFinalityWorkerFromEnv(
  options: CreatePayoutFinalityWorkerRuntimeFromEnvOptions = {}
): Promise<PayoutFinalityWorkerLoopSummary> {
  const workerRuntime = createPayoutFinalityWorkerRuntimeFromEnv(options);
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

  let workerRuntime: PayoutFinalityWorkerRuntime | undefined;
  const abort = new AbortController();
  const shutdown = (): void => {
    abort.abort();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  try {
    workerRuntime = createPayoutFinalityWorkerRuntimeFromEnv({ env });
    const summary = await workerRuntime.run({
      signal: abort.signal,
      onResult: (result) => {
        console.log(
          JSON.stringify({
            service: "split402-payout-finality-worker",
            result: summarizeWorkerResult(result)
          })
        );
      },
      onError: (error) => {
        console.error(
          JSON.stringify({
            service: "split402-payout-finality-worker",
            error: readErrorMessage(error)
          })
        );
      }
    });
    console.log(
      JSON.stringify({ service: "split402-payout-finality-worker", summary })
    );
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
  result: PayoutFinalityWorkerResult
): Record<string, unknown> {
  if (result.status === "idle") {
    return { status: result.status };
  }
  return {
    status: result.status,
    checked: result.checked,
    updatedTransactionIds: result.updatedTransactions.map(
      (transaction) => transaction.id
    ),
    updatedStatuses: result.updatedTransactions.map(
      (transaction) => transaction.status
    ),
    pendingTransactionIds: result.pendingTransactionIds,
    errors: result.errors
  };
}

function createLoopOptions(
  config: PayoutFinalityWorkerConfig
): PayoutFinalityWorkerLoopOptions {
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
  console.log(`Usage: split402-payout-finality-worker

Runs the Split402 payout finality worker loop. The worker sweeps
submitted and confirmed payout transactions that carry an expected
signature, observes them against Solana RPC, and persists chain-observed
finality outcomes with a compare-and-set guard so concurrent sweeps or
operator reconcile decisions are never overwritten. It never signs,
broadcasts, or replaces transaction bytes, and it leaves outcome-unknown
reconciliation to the operator reconcile flow.

The loop runs one sweep per poll interval (default 5000ms) and each
sweep checks at most the sweep limit of transactions (default 25,
clamped to 100).

Required environment:
  SPLIT402_DATABASE_URL

Optional environment:
  SPLIT402_PAYOUT_FINALITY_SOLANA_RPC_URL or SPLIT402_PAYOUT_FINALITY_SOLANA_RPC_URLS
  SPLIT402_PAYOUT_FINALITY_NETWORK
  SPLIT402_PAYOUT_FINALITY_RETRY_DELAY_MS
  SPLIT402_PAYOUT_FINALITY_UNKNOWN_OUTCOME_AFTER_MS
  SPLIT402_PAYOUT_FINALITY_WORKER_SWEEP_LIMIT
  SPLIT402_PAYOUT_FINALITY_WORKER_POLL_INTERVAL_MS
  SPLIT402_PAYOUT_FINALITY_WORKER_ERROR_DELAY_MS
  SPLIT402_PAYOUT_FINALITY_WORKER_MAX_ITERATIONS
  SPLIT402_PAYOUT_FINALITY_WORKER_STOP_ON_ERROR=true|false

Falls back to SPLIT402_CHAIN_WORKER_SOLANA_RPC_URL(S) and
SPLIT402_CHAIN_WORKER_NETWORK when payout finality RPC values are unset
or empty.`);
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
  return error instanceof Error ? error.message : "unknown error";
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  process.exitCode = await main();
}
