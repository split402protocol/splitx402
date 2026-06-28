import { describe, expect, it } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";

import {
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
});

class ThrowingDb implements PostgresQueryExecutor {
  async query<Row extends QueryResultRow = QueryResultRow>(): Promise<QueryResult<Row>> {
    throw new Error("database should not be touched");
  }
}
