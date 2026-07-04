import { describe, expect, it } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createPhase7StagingSeedProofEnv,
  loadPhase7StagingSeedEnvFiles,
  readPhase7StagingSeedConfig,
  runPhase7StagingSeed,
  type Phase7StagingSeedConfig
} from "../src/phase7-staging-seed.js";
import type { PostgresQueryExecutor } from "../src/postgres.js";

describe("Phase 7 staging seed config", () => {
  it("requires an explicit operator confirmation before mutating staging state", async () => {
    const config = readPhase7StagingSeedConfig({}, new Date("2026-06-28T12:00:00Z"));

    await expect(runPhase7StagingSeed(new ThrowingDb(), config)).rejects.toThrow(
      "SPLIT402_PHASE7_SEED_CONFIRM must be seed-hosted-staging"
    );
  });

  it("builds the default demo merchant, campaign, and route identifiers", () => {
    const config = readPhase7StagingSeedConfig(
      {
        SPLIT402_PHASE7_SEED_CONFIRM: "seed-hosted-staging"
      },
      new Date("2026-06-28T12:00:00Z")
    );

    expect(config).toMatchObject<Partial<Phase7StagingSeedConfig>>({
      confirmed: true,
      merchantId: "mrc_00000000000000000000000000000001",
      campaignId: "cmp_00000000000000000000000000000002",
      routeId: "rte_00000000000000000000000000000003",
      merchantOrigin: "http://localhost:4023",
      network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
      requiredAmountAtomic: "10000",
      commissionBps: 1000,
      protocolFeeBpsOfCommission: 1000,
      now: "2026-06-28T12:00:00.000Z"
    });
    expect(config.servicePublicKey).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/u);
    expect(config.ownerSeed).toBeInstanceOf(Uint8Array);
    expect(config.referrerWallet).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/u);
    expect(config.payoutWallet).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/u);
  });

  it("uses hosted staging environment overrides for money and routing settings", () => {
    const config = readPhase7StagingSeedConfig(
      {
        SPLIT402_PHASE7_SEED_CONFIRM: "seed-hosted-staging",
        SPLIT402_PHASE7_MERCHANT_ORIGIN: "https://merchant.staging.example",
        SPLIT402_NETWORK: "solana:test-network",
        SPLIT402_ASSET: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
        SPLIT402_REQUIRED_AMOUNT_ATOMIC: "50000",
        SPLIT402_COMMISSION_BPS: "2000",
        SPLIT402_PROTOCOL_FEE_BPS_OF_COMMISSION: "750"
      },
      new Date("2026-06-28T12:00:00Z")
    );

    expect(config.merchantOrigin).toBe("https://merchant.staging.example");
    expect(config.network).toBe("solana:test-network");
    expect(config.requiredAmountAtomic).toBe("50000");
    expect(config.commissionBps).toBe(2000);
    expect(config.protocolFeeBpsOfCommission).toBe(750);
  });

  it("loads seed settings from env files without overriding explicit env", () => {
    const directory = mkdtempSync(join(tmpdir(), "split402-seed-env-"));
    const envFile = join(directory, "phase7.env");
    writeFileSync(
      envFile,
      [
        "SPLIT402_PHASE7_SEED_CONFIRM=seed-hosted-staging",
        "SPLIT402_SERVICE_SEED_HEX=1111111111111111111111111111111111111111111111111111111111111111",
        "SPLIT402_REQUIRED_AMOUNT_ATOMIC=50000",
        "SPLIT402_COMMISSION_BPS=2500",
        "",
      ].join("\n")
    );
    const env: NodeJS.ProcessEnv = {
      SPLIT402_REQUIRED_AMOUNT_ATOMIC: "70000"
    };

    const result = loadPhase7StagingSeedEnvFiles(["--env-file", envFile], env);

    expect(result.loadedFiles).toContain(envFile);
    expect(env.SPLIT402_PHASE7_SEED_CONFIRM).toBe("seed-hosted-staging");
    expect(env.SPLIT402_SERVICE_SEED_HEX).toBe(
      "1111111111111111111111111111111111111111111111111111111111111111"
    );
    expect(env.SPLIT402_REQUIRED_AMOUNT_ATOMIC).toBe("70000");
    expect(readPhase7StagingSeedConfig(env).commissionBps).toBe(2500);
  });

  it("allows an explicit owner wallet without a local seed for manual auth token setup", () => {
    const config = readPhase7StagingSeedConfig(
      {
        SPLIT402_PHASE7_SEED_CONFIRM: "seed-hosted-staging",
        SPLIT402_PHASE7_OWNER_WALLET: "11111111111111111111111111111111"
      },
      new Date("2026-06-28T12:00:00Z")
    );

    expect(config.ownerWallet).toBe("11111111111111111111111111111111");
    expect(config.ownerSeed).toBeUndefined();
  });

  it("rejects an owner wallet that does not match the configured owner seed", () => {
    expect(() =>
      readPhase7StagingSeedConfig({
        SPLIT402_PHASE7_OWNER_WALLET: "11111111111111111111111111111111",
        SPLIT402_PHASE7_OWNER_SEED_HEX:
          "a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf"
      })
    ).toThrow("SPLIT402_PHASE7_OWNER_WALLET must match SPLIT402_PHASE7_OWNER_SEED_HEX");
  });

  it("rejects malformed seed and basis-point overrides", () => {
    expect(() =>
      readPhase7StagingSeedConfig({
        SPLIT402_SERVICE_SEED_HEX: "bad-seed"
      })
    ).toThrow("SPLIT402_SERVICE_SEED_HEX must be 32 seed bytes");

    expect(() =>
      readPhase7StagingSeedConfig({
        SPLIT402_COMMISSION_BPS: "10001"
      })
    ).toThrow("SPLIT402_COMMISSION_BPS must be an integer from 0 to 10000");
  });

  it("prints copyable proof env values for Docker, hosted proof, and MCP setup", () => {
    const config = readPhase7StagingSeedConfig(
      {
        SPLIT402_PHASE7_SEED_CONFIRM: "seed-hosted-staging"
      },
      new Date("2026-06-28T12:00:00Z")
    );
    const proofEnv = createPhase7StagingSeedProofEnv(config, {
      accessToken: "merchant-session-token"
    });

    expect(proofEnv).toMatchObject({
      SPLIT402_PHASE7_MERCHANT_ID: config.merchantId,
      SPLIT402_PHASE7_REFERRER_WALLET: config.referrerWallet,
      SPLIT402_PHASE7_CONTROL_PLANE_TOKEN: "merchant-session-token",
      SPLIT402_DASHBOARD_CONTROL_PLANE_TOKEN: "merchant-session-token",
      SPLIT402_MCP_CONTROL_PLANE_TOKEN: "merchant-session-token",
      SPLIT402_MERCHANT_PAY_TO: config.payToWallet,
      SPLIT402_MERCHANT_PUBLIC_KEY: config.servicePublicKey
    });
  });
});

class ThrowingDb implements PostgresQueryExecutor {
  async query<Row extends QueryResultRow = QueryResultRow>(): Promise<QueryResult<Row>> {
    throw new Error("database should not be touched");
  }
}
