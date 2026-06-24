import type { PoolConfig, QueryResult, QueryResultRow } from "pg";
import request from "supertest";
import { describe, expect, it } from "vitest";

import {
  createControlPlaneRuntime,
  createControlPlaneRuntimeFromEnv,
  type PostgresPool,
  type PostgresTransactionClient
} from "../src/index.js";

describe("control-plane runtime", () => {
  it("wires durable stores and requires merchant auth by default", async () => {
    const runtime = createControlPlaneRuntime({
      db: new ThrowingPostgresPool()
    });

    expect(runtime.authPolicy).toBe("required");
    expect(runtime.authenticator).toBeDefined();

    await request(runtime.app).get("/v1/health").expect(200);
    const response = await request(runtime.app)
      .post("/v1/merchants")
      .send({
        slug: "demo",
        displayName: "Demo",
        ownerWallet: "11111111111111111111111111111111"
      })
      .expect(401);

    expect(response.body).toEqual({
      error: "unauthorized",
      message: "bearer access token required"
    });
  });

  it("can disable runtime auth routes for local embeddings", async () => {
    const runtime = createControlPlaneRuntime({
      db: new ThrowingPostgresPool(),
      authPolicy: "disabled"
    });

    expect(runtime.authPolicy).toBe("disabled");
    expect(runtime.authenticator).toBeUndefined();

    await request(runtime.app)
      .post("/v1/auth/challenges")
      .send({
        wallet: "11111111111111111111111111111111",
        network: "solana:devnet"
      })
      .expect(404);
  });

  it("builds a closeable runtime from environment configuration", async () => {
    const createdConfigs: PoolConfig[] = [];
    const pool = new ThrowingPostgresPool();
    const runtime = createControlPlaneRuntimeFromEnv({
      env: {
        SPLIT402_DATABASE_URL: "postgresql://split402.example/db",
        SPLIT402_DATABASE_POOL_MAX: "7",
        SPLIT402_DATABASE_SSL: "true",
        SPLIT402_DATABASE_SSL_REJECT_UNAUTHORIZED: "false",
        SPLIT402_CONTROL_PLANE_AUTH_POLICY: "optional",
        SPLIT402_CONTROL_PLANE_JSON_LIMIT: "256kb",
        SPLIT402_WALLET_AUTH_CHALLENGE_TTL_MS: "60000",
        SPLIT402_WALLET_AUTH_SESSION_TTL_MS: "120000"
      },
      poolFactory: (config) => {
        createdConfigs.push(config);
        return pool;
      }
    });

    expect(runtime.authPolicy).toBe("optional");
    expect(createdConfigs).toEqual([
      expect.objectContaining({
        connectionString: "postgresql://split402.example/db",
        max: 7,
        ssl: { rejectUnauthorized: false }
      })
    ]);

    await runtime.close();

    expect(pool.closed).toBe(true);
  });

  it("rejects invalid runtime environment configuration", () => {
    expect(() => createControlPlaneRuntimeFromEnv({ env: {} })).toThrow(
      "SPLIT402_DATABASE_URL or DATABASE_URL is required"
    );
    expect(() =>
      createControlPlaneRuntimeFromEnv({
        env: {
          SPLIT402_DATABASE_URL: "postgresql://split402.example/db",
          SPLIT402_CONTROL_PLANE_AUTH_POLICY: "open"
        },
        poolFactory: () => new ThrowingPostgresPool()
      })
    ).toThrow(
      "SPLIT402_CONTROL_PLANE_AUTH_POLICY must be disabled, optional, or required"
    );
    expect(() =>
      createControlPlaneRuntimeFromEnv({
        env: {
          SPLIT402_DATABASE_URL: "postgresql://split402.example/db",
          SPLIT402_DATABASE_POOL_MAX: "0"
        },
        poolFactory: () => new ThrowingPostgresPool()
      })
    ).toThrow("SPLIT402_DATABASE_POOL_MAX must be a positive integer");
  });
});

class ThrowingPostgresPool implements PostgresPool {
  closed = false;

  async query<Row extends QueryResultRow = QueryResultRow>(): Promise<QueryResult<Row>> {
    throw new Error("unexpected database query");
  }

  async connect(): Promise<PostgresTransactionClient> {
    return {
      query: async <Row extends QueryResultRow = QueryResultRow>(): Promise<QueryResult<Row>> => {
        throw new Error("unexpected database query");
      },
      release: () => {}
    };
  }

  async end(): Promise<void> {
    this.closed = true;
  }
}
