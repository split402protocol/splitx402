#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import {
  createControlPlaneRuntimeFromEnv,
  type ControlPlaneRuntime,
  type CreateControlPlaneRuntimeFromEnvOptions
} from "./index.js";
import {
  SolanaRpcReceiptVerifier,
  type SolanaRpcCommitment,
  type SolanaRpcFetch
} from "./solana.js";
import {
  ReceiptChainVerificationWorker,
  runReceiptChainVerificationWorkerLoop,
  type ReceiptChainVerificationWorkerLoopOptions,
  type ReceiptChainVerificationWorkerLoopSummary,
  type ReceiptChainVerificationWorkerResult
} from "./workers.js";

export interface ChainVerificationWorkerConfig {
  commitment: SolanaRpcCommitment;
  network: string;
  rpcUrl: string;
  rpcUrls: string[];
  errorDelayMs?: number;
  maxIterations?: number;
  pollIntervalMs?: number;
  retryDelayMs?: number;
  stopOnError?: boolean;
}

export interface CreateChainVerificationWorkerRuntimeFromEnvOptions {
  env?: NodeJS.ProcessEnv;
  fetch?: SolanaRpcFetch;
  poolFactory?: NonNullable<CreateControlPlaneRuntimeFromEnvOptions["poolFactory"]>;
  walletAuth?: CreateControlPlaneRuntimeFromEnvOptions["walletAuth"];
}

export interface ChainVerificationWorkerRuntime {
  close(): Promise<void>;
  config: ChainVerificationWorkerConfig;
  runtime: ControlPlaneRuntime;
  verifier: SolanaRpcReceiptVerifier;
  worker: ReceiptChainVerificationWorker;
  run(
    options?: ReceiptChainVerificationWorkerLoopOptions
  ): Promise<ReceiptChainVerificationWorkerLoopSummary>;
}

export function createChainVerificationWorkerRuntimeFromEnv(
  options: CreateChainVerificationWorkerRuntimeFromEnvOptions = {}
): ChainVerificationWorkerRuntime {
  const env = options.env ?? process.env;
  const config = readChainWorkerConfig(env);
  const runtime = createControlPlaneRuntimeFromEnv({
    env,
    ...(options.poolFactory === undefined ? {} : { poolFactory: options.poolFactory }),
    ...(options.walletAuth === undefined ? {} : { walletAuth: options.walletAuth })
  });
  const verifier = new SolanaRpcReceiptVerifier({
    rpcUrls: config.rpcUrls,
    network: config.network,
    commitment: config.commitment,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch })
  });
  const worker = new ReceiptChainVerificationWorker(
    runtime.outboxStore,
    runtime.receiptStore,
    verifier,
    config.retryDelayMs === undefined ? {} : { retryDelayMs: config.retryDelayMs }
  );

  return {
    config,
    runtime,
    verifier,
    worker,
    close: () => runtime.close(),
    run: (loopOptions = {}) =>
      runReceiptChainVerificationWorkerLoop(worker, {
        ...createLoopOptions(config),
        ...loopOptions
      })
  };
}

export function readChainWorkerConfig(
  env: NodeJS.ProcessEnv = process.env
): ChainVerificationWorkerConfig {
  const rpcUrls = readRpcUrls(
    env.SPLIT402_CHAIN_WORKER_SOLANA_RPC_URLS ??
      env.SPLIT402_CHAIN_WORKER_SOLANA_RPC_URL ??
      env.SPLIT402_SOLANA_RPC_URL,
    "SPLIT402_CHAIN_WORKER_SOLANA_RPC_URLS or SPLIT402_CHAIN_WORKER_SOLANA_RPC_URL or SPLIT402_SOLANA_RPC_URL"
  );
  const rpcUrl = rpcUrls[0];
  if (rpcUrl === undefined) {
    throw new Error("at least one Solana RPC URL is required");
  }
  const network = readSolanaNetwork(
    env.SPLIT402_CHAIN_WORKER_NETWORK,
    "SPLIT402_CHAIN_WORKER_NETWORK"
  );
  const commitment = readCommitment(
    env.SPLIT402_CHAIN_WORKER_COMMITMENT ?? "confirmed"
  );
  const retryDelayMs = readOptionalPositiveInteger(
    env.SPLIT402_CHAIN_WORKER_RETRY_DELAY_MS,
    "SPLIT402_CHAIN_WORKER_RETRY_DELAY_MS"
  );
  const pollIntervalMs = readOptionalPositiveInteger(
    env.SPLIT402_CHAIN_WORKER_POLL_INTERVAL_MS,
    "SPLIT402_CHAIN_WORKER_POLL_INTERVAL_MS"
  );
  const errorDelayMs = readOptionalPositiveInteger(
    env.SPLIT402_CHAIN_WORKER_ERROR_DELAY_MS,
    "SPLIT402_CHAIN_WORKER_ERROR_DELAY_MS"
  );
  const maxIterations = readOptionalPositiveInteger(
    env.SPLIT402_CHAIN_WORKER_MAX_ITERATIONS,
    "SPLIT402_CHAIN_WORKER_MAX_ITERATIONS"
  );
  const stopOnError = readOptionalBoolean(
    env.SPLIT402_CHAIN_WORKER_STOP_ON_ERROR,
    "SPLIT402_CHAIN_WORKER_STOP_ON_ERROR"
  );

  return {
    rpcUrl,
    rpcUrls,
    network,
    commitment,
    ...(retryDelayMs === undefined ? {} : { retryDelayMs }),
    ...(pollIntervalMs === undefined ? {} : { pollIntervalMs }),
    ...(errorDelayMs === undefined ? {} : { errorDelayMs }),
    ...(maxIterations === undefined ? {} : { maxIterations }),
    ...(stopOnError === undefined ? {} : { stopOnError })
  };
}

export async function runChainVerificationWorkerFromEnv(
  options: CreateChainVerificationWorkerRuntimeFromEnvOptions = {}
): Promise<ReceiptChainVerificationWorkerLoopSummary> {
  const workerRuntime = createChainVerificationWorkerRuntimeFromEnv(options);
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

  let workerRuntime: ChainVerificationWorkerRuntime | undefined;
  const abort = new AbortController();
  const shutdown = (): void => {
    abort.abort();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  try {
    workerRuntime = createChainVerificationWorkerRuntimeFromEnv({ env });
    const summary = await workerRuntime.run({
      signal: abort.signal,
      onResult: (result) => {
        console.log(
          JSON.stringify({
            service: "split402-chain-worker",
            result: summarizeWorkerResult(result)
          })
        );
      },
      onError: (error) => {
        console.error(
          JSON.stringify({
            service: "split402-chain-worker",
            error: readErrorMessage(error)
          })
        );
      }
    });
    console.log(JSON.stringify({ service: "split402-chain-worker", summary }));
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
  result: ReceiptChainVerificationWorkerResult
): Record<string, unknown> {
  if (result.status === "idle") {
    return { status: result.status };
  }
  if (result.status === "verified") {
    return {
      status: result.status,
      eventId: result.event.id,
      receiptId: result.snapshot.receipt.id
    };
  }
  if (result.status === "retry_scheduled") {
    return {
      status: result.status,
      eventId: result.event.id,
      availableAt: result.availableAt,
      lastError: result.lastError
    };
  }
  return {
    status: result.status,
    eventId: result.event.id,
    lastError: result.lastError
  };
}

function createLoopOptions(
  config: ChainVerificationWorkerConfig
): ReceiptChainVerificationWorkerLoopOptions {
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
  console.log(`Usage: split402-chain-worker

Runs the Split402 receipt chain-verification worker loop.

Required environment:
  SPLIT402_DATABASE_URL
  SPLIT402_CHAIN_WORKER_NETWORK
  SPLIT402_CHAIN_WORKER_SOLANA_RPC_URL or SPLIT402_CHAIN_WORKER_SOLANA_RPC_URLS

Optional environment:
  SPLIT402_CHAIN_WORKER_COMMITMENT=confirmed|finalized
  SPLIT402_CHAIN_WORKER_RETRY_DELAY_MS
  SPLIT402_CHAIN_WORKER_POLL_INTERVAL_MS
  SPLIT402_CHAIN_WORKER_ERROR_DELAY_MS
  SPLIT402_CHAIN_WORKER_MAX_ITERATIONS
  SPLIT402_CHAIN_WORKER_STOP_ON_ERROR=true|false`);
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

function readRpcUrls(value: string | undefined, label: string): string[] {
  const raw = readRequiredString(value, label);
  const urls = Array.from(
    new Set(
      raw
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
    )
  );
  if (urls.length === 0) {
    throw new Error(`${label} is required`);
  }
  return urls;
}

function readSolanaNetwork(value: string | undefined, label: string): string {
  const network = readRequiredString(value, label);
  if (!network.startsWith("solana:")) {
    throw new Error(`${label} must start with solana:`);
  }
  return network;
}

function readCommitment(value: string): SolanaRpcCommitment {
  if (value === "confirmed" || value === "finalized") {
    return value;
  }
  throw new Error("SPLIT402_CHAIN_WORKER_COMMITMENT must be confirmed or finalized");
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
