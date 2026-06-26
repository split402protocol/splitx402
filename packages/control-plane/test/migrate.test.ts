import { describe, expect, it } from "vitest";

import { readControlPlaneMigrationPoolConfig } from "../src/migrate.js";

describe("control-plane migration CLI", () => {
  it("reads database pool config from runtime environment", () => {
    expect(
      readControlPlaneMigrationPoolConfig({
        SPLIT402_DATABASE_URL: "postgresql://split402:split402@localhost/split402",
        SPLIT402_DATABASE_POOL_MAX: "3",
        SPLIT402_DATABASE_SSL: "true",
        SPLIT402_DATABASE_SSL_REJECT_UNAUTHORIZED: "false"
      })
    ).toMatchObject({
      connectionString: "postgresql://split402:split402@localhost/split402",
      max: 3,
      ssl: {
        rejectUnauthorized: false
      }
    });
  });

  it("falls back to DATABASE_URL and rejects missing database configuration", () => {
    expect(
      readControlPlaneMigrationPoolConfig({
        DATABASE_URL: "postgresql://split402:split402@localhost/split402"
      }).connectionString
    ).toBe("postgresql://split402:split402@localhost/split402");

    expect(() => readControlPlaneMigrationPoolConfig({})).toThrow(
      "SPLIT402_DATABASE_URL or DATABASE_URL is required"
    );
  });

  it("rejects invalid pool options", () => {
    expect(() =>
      readControlPlaneMigrationPoolConfig({
        SPLIT402_DATABASE_URL: "postgresql://split402:split402@localhost/split402",
        SPLIT402_DATABASE_POOL_MAX: "0"
      })
    ).toThrow("SPLIT402_DATABASE_POOL_MAX must be a positive integer");

    expect(() =>
      readControlPlaneMigrationPoolConfig({
        SPLIT402_DATABASE_URL: "postgresql://split402:split402@localhost/split402",
        SPLIT402_DATABASE_SSL: "yes"
      })
    ).toThrow("SPLIT402_DATABASE_SSL must be true or false");
  });
});
