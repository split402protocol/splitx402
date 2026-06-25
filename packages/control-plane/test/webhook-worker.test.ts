import type { PoolConfig, QueryResult, QueryResultRow } from "pg";
import { describe, expect, it, vi } from "vitest";

import type { PostgresPool, PostgresTransactionClient, WebhookFetch } from "../src/index.js";
import {
  createWebhookWorkerRuntimeFromEnv,
  main,
  readWebhookWorkerConfig
} from "../src/webhook-worker.js";

describe("webhook worker entrypoint", () => {
  it("reads worker environment and wires the durable runtime", async () => {
    const pool = new ThrowingPostgresPool();
    const createdConfigs: PoolConfig[] = [];
    const fetch: WebhookFetch = async () => ({ status: 202 });

    const workerRuntime = createWebhookWorkerRuntimeFromEnv({
      env: {
        SPLIT402_DATABASE_URL: "postgresql://split402.example/webhooks",
        SPLIT402_DATABASE_POOL_MAX: "4",
        SPLIT402_WEBHOOK_WORKER_URL: "https://merchant.example/webhooks/split402",
        SPLIT402_WEBHOOK_WORKER_SECRET: "webhook-secret",
        SPLIT402_WEBHOOK_WORKER_RETRY_DELAY_MS: "120000",
        SPLIT402_WEBHOOK_WORKER_POLL_INTERVAL_MS: "250",
        SPLIT402_WEBHOOK_WORKER_ERROR_DELAY_MS: "500",
        SPLIT402_WEBHOOK_WORKER_MAX_ITERATIONS: "2",
        SPLIT402_WEBHOOK_WORKER_MAX_ATTEMPTS: "5",
        SPLIT402_WEBHOOK_WORKER_TIMEOUT_MS: "1500",
        SPLIT402_WEBHOOK_WORKER_STOP_ON_ERROR: "true"
      },
      fetch,
      poolFactory: (config) => {
        createdConfigs.push(config);
        return pool;
      }
    });

    expect(workerRuntime.config).toEqual({
      endpointUrl: "https://merchant.example/webhooks/split402",
      secret: "webhook-secret",
      retryDelayMs: 120000,
      pollIntervalMs: 250,
      errorDelayMs: 500,
      maxIterations: 2,
      maxAttempts: 5,
      timeoutMs: 1500,
      stopOnError: true
    });
    expect(createdConfigs).toEqual([
      expect.objectContaining({
        connectionString: "postgresql://split402.example/webhooks",
        max: 4
      })
    ]);
    expect(workerRuntime.runtime.outboxStore).toBeDefined();
    expect(workerRuntime.dispatcher).toBeDefined();
    expect(workerRuntime.worker).toBeDefined();

    await workerRuntime.close();

    expect(pool.closed).toBe(true);
  });

  it("rejects invalid worker environment configuration", () => {
    expect(() => readWebhookWorkerConfig({})).toThrow(
      "SPLIT402_WEBHOOK_WORKER_URL is required"
    );
    expect(() =>
      readWebhookWorkerConfig({
        SPLIT402_WEBHOOK_WORKER_URL: "ftp://merchant.example/webhooks",
        SPLIT402_WEBHOOK_WORKER_SECRET: "webhook-secret"
      })
    ).toThrow("SPLIT402_WEBHOOK_WORKER_URL must be an http(s) URL");
    expect(() =>
      readWebhookWorkerConfig({
        SPLIT402_WEBHOOK_WORKER_URL: "https://merchant.example/webhooks",
        SPLIT402_WEBHOOK_WORKER_SECRET: "webhook-secret",
        SPLIT402_WEBHOOK_WORKER_MAX_ATTEMPTS: "0"
      })
    ).toThrow("SPLIT402_WEBHOOK_WORKER_MAX_ATTEMPTS must be a positive integer");
    expect(() =>
      readWebhookWorkerConfig({
        SPLIT402_WEBHOOK_WORKER_URL: "https://merchant.example/webhooks",
        SPLIT402_WEBHOOK_WORKER_SECRET: "webhook-secret",
        SPLIT402_WEBHOOK_WORKER_STOP_ON_ERROR: "yes"
      })
    ).toThrow("SPLIT402_WEBHOOK_WORKER_STOP_ON_ERROR must be true or false");
  });

  it("prints help without constructing a runtime", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(main(["--help"], {})).resolves.toBe(0);

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("Usage: split402-webhook-worker")
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
