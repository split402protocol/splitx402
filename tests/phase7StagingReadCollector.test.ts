import { describe, expect, it } from "vitest";

import { collectPhase7ReadArtifacts } from "../src/phase7StagingReadCollector.js";

describe("Phase 7 staging read collector", () => {
  it("captures control-plane read artifacts for the staging proof", async () => {
    const calls: Array<{ url: string; authorization?: string }> = [];
    const writes = new Map<string, string>();

    const report = await collectPhase7ReadArtifacts({
      controlPlaneUrl: "https://control.staging.example/",
      merchantId: "mrc_001",
      referrerWallet: "ref wallet",
      outputDir: "evidence",
      bearerToken: "token-123",
      webhookStatus: "delivered",
      fetch: async (url, init) => {
        calls.push({ url, authorization: init?.headers?.authorization });
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ url }),
        };
      },
      writeArtifact: (path, text) => writes.set(path, text),
    });

    expect(report).toMatchObject({
      schema: "split402.phase7_read_collector.v1",
      controlPlaneUrl: "https://control.staging.example",
      merchantId: "mrc_001",
      referrerWallet: "ref wallet",
      outputDir: "evidence",
    });
    expect(calls).toEqual([
      {
        url: "https://control.staging.example/v1/referrers/ref%20wallet/routes",
        authorization: "Bearer token-123",
      },
      {
        url: "https://control.staging.example/v1/referrers/ref%20wallet/balances",
        authorization: "Bearer token-123",
      },
      {
        url: "https://control.staging.example/v1/merchants/mrc_001/dashboard-summary",
        authorization: "Bearer token-123",
      },
      {
        url: "https://control.staging.example/v1/merchants/mrc_001/webhook-events?status=delivered",
        authorization: "Bearer token-123",
      },
      {
        url: "https://control.staging.example/v1/merchants/mrc_001/payout-obligations",
        authorization: "Bearer token-123",
      },
      {
        url: "https://control.staging.example/v1/merchants/mrc_001/payout-obligations",
        authorization: "Bearer token-123",
      },
    ]);
    expect([...writes.keys()]).toEqual([
      "evidence/agent-discovery.json",
      "evidence/referrer-balances.json",
      "evidence/dashboard-summary.json",
      "evidence/webhook-events.json",
      "evidence/payout-obligations.json",
      "evidence/funding-balance.json",
    ]);
    expect(writes.get("evidence/dashboard-summary.json")).toContain(
      '"url": "https://control.staging.example/v1/merchants/mrc_001/dashboard-summary"',
    );
  });

  it("fails fast when a read artifact request fails", async () => {
    await expect(
      collectPhase7ReadArtifacts({
        controlPlaneUrl: "https://control.staging.example",
        merchantId: "mrc_001",
        referrerWallet: "referrer",
        outputDir: "evidence",
        fetch: async () => ({
          ok: false,
          status: 503,
          text: async () => "service unavailable",
        }),
        writeArtifact: () => undefined,
      }),
    ).rejects.toThrow(
      "agent_discovery_evidence capture failed with HTTP 503: service unavailable",
    );
  });
});
