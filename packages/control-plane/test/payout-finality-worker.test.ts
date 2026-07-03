import type { PoolConfig, QueryResult, QueryResultRow } from "pg";
import { describe, expect, it, vi } from "vitest";

import {
  createPayoutFinalityWorkerRuntimeFromEnv,
  main,
  readPayoutFinalityWorkerConfig
} from "../src/payout-finality-worker.js";
import type { PostgresPool, PostgresTransactionClient } from "../src/index.js";

describe("payout finality worker entrypoint", () => {
  it("reads worker environment and wires the durable runtime", async () => {
    const pool = new ThrowingPostgresPool();
    const createdConfigs: PoolConfig[] = [];

    const workerRuntime = createPayoutFinalityWorkerRuntimeFromEnv({
      env: {
        SPLIT402_DATABASE_URL: "postgresql://split402.example/worker",
        SPLIT402_DATABASE_POOL_MAX: "3",
        SPLIT402_PAYOUT_FINALITY_SOLANA_RPC_URL: "https://rpc.example",
        SPLIT402_PAYOUT_FINALITY_NETWORK: "solana:devnet",
        SPLIT402_PAYOUT_FINALITY_WORKER_SWEEP_LIMIT: "10",
        SPLIT402_PAYOUT_FINALITY_WORKER_POLL_INTERVAL_MS: "250",
        SPLIT402_PAYOUT_FINALITY_WORKER_ERROR_DELAY_MS: "500",
        SPLIT402_PAYOUT_FINALITY_WORKER_MAX_ITERATIONS: "2",
        SPLIT402_PAYOUT_FINALITY_WORKER_STOP_ON_ERROR: "true"
      },
      poolFactory: (config) => {
        createdConfigs.push(config);
        return pool;
      }
    });

    expect(workerRuntime.config).toEqual({
      sweepLimit: 10,
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
    expect(workerRuntime.runtime.receiptStore).toBeDefined();
    expect(workerRuntime.monitor).toBeDefined();
    expect(workerRuntime.worker).toBeDefined();

    await workerRuntime.close();

    expect(pool.closed).toBe(true);
  });

  it("reads an empty worker configuration with defaults left to the loop", () => {
    expect(
      readPayoutFinalityWorkerConfig({
        SPLIT402_PAYOUT_FINALITY_WORKER_SWEEP_LIMIT: "",
        SPLIT402_PAYOUT_FINALITY_WORKER_STOP_ON_ERROR: ""
      })
    ).toEqual({});
  });

  it("rejects invalid worker environment configuration", () => {
    expect(() =>
      readPayoutFinalityWorkerConfig({
        SPLIT402_PAYOUT_FINALITY_WORKER_SWEEP_LIMIT: "0"
      })
    ).toThrow(
      "SPLIT402_PAYOUT_FINALITY_WORKER_SWEEP_LIMIT must be a positive integer"
    );
    expect(() =>
      readPayoutFinalityWorkerConfig({
        SPLIT402_PAYOUT_FINALITY_WORKER_POLL_INTERVAL_MS: "-1"
      })
    ).toThrow(
      "SPLIT402_PAYOUT_FINALITY_WORKER_POLL_INTERVAL_MS must be a positive integer"
    );
    expect(() =>
      readPayoutFinalityWorkerConfig({
        SPLIT402_PAYOUT_FINALITY_WORKER_STOP_ON_ERROR: "yes"
      })
    ).toThrow(
      "SPLIT402_PAYOUT_FINALITY_WORKER_STOP_ON_ERROR must be true or false"
    );
  });

  it("runs a sweep loop against an injected monitor and store", async () => {
    const pool = new ThrowingPostgresPool();
    const workerRuntime = createPayoutFinalityWorkerRuntimeFromEnv({
      env: {
        SPLIT402_DATABASE_URL: "postgresql://split402.example/worker",
        SPLIT402_PAYOUT_FINALITY_WORKER_MAX_ITERATIONS: "1"
      },
      monitor: {
        monitor: () => {
          throw new Error("monitor should not run without pending transactions");
        }
      },
      poolFactory: () => pool
    });

    // The throwing pool rejects the pending-finality query, so the loop
    // surfaces the error through onError without stopping.
    const errors: unknown[] = [];
    const summary = await workerRuntime.run({
      onError: (error) => {
        errors.push(error);
      },
      sleep: () => undefined
    });

    expect(summary).toEqual({ iterations: 1, stoppedBy: "max_iterations" });
    expect(errors).toHaveLength(1);

    await workerRuntime.close();
  });

  it("prints help without constructing a runtime", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(main(["--help"], {})).resolves.toBe(0);

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("Usage: split402-payout-finality-worker")
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
