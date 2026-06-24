import type { PoolConfig, QueryResult, QueryResultRow } from "pg";
import { describe, expect, it, vi } from "vitest";

import {
  createChainVerificationWorkerRuntimeFromEnv,
  main,
  readChainWorkerConfig
} from "../src/chain-worker.js";
import type { PostgresPool, PostgresTransactionClient } from "../src/index.js";

describe("chain-verification worker entrypoint", () => {
  it("reads worker environment and wires the durable runtime", async () => {
    const pool = new ThrowingPostgresPool();
    const createdConfigs: PoolConfig[] = [];

    const workerRuntime = createChainVerificationWorkerRuntimeFromEnv({
      env: {
        SPLIT402_DATABASE_URL: "postgresql://split402.example/worker",
        SPLIT402_DATABASE_POOL_MAX: "3",
        SPLIT402_CHAIN_WORKER_SOLANA_RPC_URL: "https://rpc.example",
        SPLIT402_CHAIN_WORKER_NETWORK: "solana:devnet",
        SPLIT402_CHAIN_WORKER_COMMITMENT: "finalized",
        SPLIT402_CHAIN_WORKER_RETRY_DELAY_MS: "120000",
        SPLIT402_CHAIN_WORKER_POLL_INTERVAL_MS: "250",
        SPLIT402_CHAIN_WORKER_ERROR_DELAY_MS: "500",
        SPLIT402_CHAIN_WORKER_MAX_ITERATIONS: "2",
        SPLIT402_CHAIN_WORKER_STOP_ON_ERROR: "true"
      },
      poolFactory: (config) => {
        createdConfigs.push(config);
        return pool;
      }
    });

    expect(workerRuntime.config).toEqual({
      rpcUrl: "https://rpc.example",
      network: "solana:devnet",
      commitment: "finalized",
      retryDelayMs: 120000,
      pollIntervalMs: 250,
      errorDelayMs: 500,
      maxIterations: 2,
      stopOnError: true
    });
    expect(createdConfigs).toEqual([
      expect.objectContaining({
        connectionString: "postgresql://split402.example/worker",
        max: 3
      })
    ]);
    expect(workerRuntime.runtime.outboxStore).toBeDefined();
    expect(workerRuntime.runtime.receiptStore).toBeDefined();
    expect(workerRuntime.worker).toBeDefined();
    expect(workerRuntime.verifier).toBeDefined();

    await workerRuntime.close();

    expect(pool.closed).toBe(true);
  });

  it("uses the shared Solana RPC URL fallback", () => {
    expect(
      readChainWorkerConfig({
        SPLIT402_SOLANA_RPC_URL: "https://api.devnet.solana.com",
        SPLIT402_CHAIN_WORKER_NETWORK: "solana:devnet",
        SPLIT402_CHAIN_WORKER_MAX_ITERATIONS: "",
        SPLIT402_CHAIN_WORKER_STOP_ON_ERROR: ""
      })
    ).toEqual({
      rpcUrl: "https://api.devnet.solana.com",
      network: "solana:devnet",
      commitment: "confirmed"
    });
  });

  it("rejects invalid worker environment configuration", () => {
    expect(() => readChainWorkerConfig({})).toThrow(
      "SPLIT402_CHAIN_WORKER_SOLANA_RPC_URL or SPLIT402_SOLANA_RPC_URL is required"
    );
    expect(() =>
      readChainWorkerConfig({
        SPLIT402_CHAIN_WORKER_SOLANA_RPC_URL: "https://rpc.example",
        SPLIT402_CHAIN_WORKER_NETWORK: "eip155:8453"
      })
    ).toThrow("SPLIT402_CHAIN_WORKER_NETWORK must start with solana:");
    expect(() =>
      readChainWorkerConfig({
        SPLIT402_CHAIN_WORKER_SOLANA_RPC_URL: "https://rpc.example",
        SPLIT402_CHAIN_WORKER_NETWORK: "solana:devnet",
        SPLIT402_CHAIN_WORKER_COMMITMENT: "processed"
      })
    ).toThrow(
      "SPLIT402_CHAIN_WORKER_COMMITMENT must be confirmed or finalized"
    );
    expect(() =>
      readChainWorkerConfig({
        SPLIT402_CHAIN_WORKER_SOLANA_RPC_URL: "https://rpc.example",
        SPLIT402_CHAIN_WORKER_NETWORK: "solana:devnet",
        SPLIT402_CHAIN_WORKER_POLL_INTERVAL_MS: "0"
      })
    ).toThrow("SPLIT402_CHAIN_WORKER_POLL_INTERVAL_MS must be a positive integer");
    expect(() =>
      readChainWorkerConfig({
        SPLIT402_CHAIN_WORKER_SOLANA_RPC_URL: "https://rpc.example",
        SPLIT402_CHAIN_WORKER_NETWORK: "solana:devnet",
        SPLIT402_CHAIN_WORKER_STOP_ON_ERROR: "yes"
      })
    ).toThrow("SPLIT402_CHAIN_WORKER_STOP_ON_ERROR must be true or false");
  });

  it("prints help without constructing a runtime", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(main(["--help"], {})).resolves.toBe(0);

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("Usage: split402-chain-worker")
    );
    log.mockRestore();
  });
});

class ThrowingPostgresPool implements PostgresPool {
  closed = false;

  async query<Row extends QueryResultRow = QueryResultRow>(): Promise<QueryResult<Row>> {
    throw new Error("unexpected database query");
  }

  async connect(): Promise<PostgresTransactionClient> {
    return {
      query: async <Row extends QueryResultRow = QueryResultRow>(): Promise<
        QueryResult<Row>
      > => {
        throw new Error("unexpected database query");
      },
      release: () => {}
    };
  }

  async end(): Promise<void> {
    this.closed = true;
  }
}
