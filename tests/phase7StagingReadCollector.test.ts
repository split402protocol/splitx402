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
          text: async () => JSON.stringify(createReadArtifact(url)),
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
      '"schema": "split402.merchant_dashboard_summary.v1"',
    );
    expect(writes.get("evidence/funding-balance.json")).toContain(
      '"fundingStatus": "covered"',
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

  it("fails fast when funding balance evidence is unresolved", async () => {
    await expect(
      collectPhase7ReadArtifacts({
        controlPlaneUrl: "https://control.staging.example",
        merchantId: "mrc_001",
        referrerWallet: "referrer",
        outputDir: "evidence",
        fetch: async (url) => ({
          ok: true,
          status: 200,
          text: async () =>
            url.endsWith("/payout-obligations")
              ? JSON.stringify(
                  createFundingSummary({
                    fundingStatus: "unknown",
                    fundingAmountAtomic: "0",
                    fundingDeficitAtomic: "0",
                  }),
                )
              : JSON.stringify(createReadArtifact(url)),
        }),
        writeArtifact: () => undefined,
      }),
    ).rejects.toThrow(
      "funding_balance_evidence usdc-devnet fundingStatus is unknown",
    );
  });

  it("fails fast when route discovery evidence has no active route", async () => {
    await expect(
      collectPhase7ReadArtifacts({
        controlPlaneUrl: "https://control.staging.example",
        merchantId: "mrc_001",
        referrerWallet: "referrer",
        outputDir: "evidence",
        fetch: async (url) => ({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify(
              url.includes("/routes")
                ? { routes: [] }
                : createReadArtifact(url),
            ),
        }),
        writeArtifact: () => undefined,
      }),
    ).rejects.toThrow(
      "agent_discovery_evidence must include at least one route",
    );
  });
});

function createReadArtifact(url: string): Record<string, unknown> {
  const parsed = new URL(url);
  if (parsed.pathname.endsWith("/routes")) {
    return {
      routes: [
        {
          id: "rte_001",
          status: "active",
          campaignId: "cmp_001",
          referrerWallet: "referrer",
          payoutWallet: "payout",
        },
      ],
    };
  }
  if (parsed.pathname.endsWith("/balances")) {
    return {
      summary: {
        referrerWallet: "referrer",
        assets: [
          {
            asset: "usdc-devnet",
            pendingAmountAtomic: "0",
            availableAmountAtomic: "1000",
            heldAmountAtomic: "0",
            inFlightAmountAtomic: "0",
            paidAmountAtomic: "0",
            totalEarnedAmountAtomic: "1000",
          },
        ],
      },
    };
  }
  if (parsed.pathname.endsWith("/dashboard-summary")) {
    return {
      summary: {
        schema: "split402.merchant_dashboard_summary.v1",
        merchant: { id: "mrc_001" },
        campaigns: {
          total: 1,
          activeCampaignIds: ["cmp_001"],
        },
        routes: {
          total: 1,
          activeRouteIds: ["rte_001"],
        },
      },
    };
  }
  if (parsed.pathname.endsWith("/webhook-events")) {
    return {
      events: [
        {
          eventType: "receipt.accepted",
          status: "delivered",
        },
      ],
    };
  }
  if (parsed.pathname.endsWith("/payout-obligations")) {
    return createFundingSummary();
  }
  return { url };
}

function createFundingSummary(
  overrides: Partial<Record<string, string>> = {},
): Record<string, unknown> {
  return {
    summary: {
      schema: "split402.merchant_obligation_summary.v1",
      merchantId: "mrc_001",
      generatedAt: "2026-06-26T00:00:00.000Z",
      assets: [
        {
          asset: "usdc-devnet",
          outstandingAmountAtomic: "1000",
          totalAccruedAmountAtomic: "1000",
          pendingAmountAtomic: "0",
          availableAmountAtomic: "1000",
          heldAmountAtomic: "0",
          inFlightAmountAtomic: "0",
          paidAmountAtomic: "0",
          fundingStatus: "covered",
          fundingAmountAtomic: "1000",
          fundingDeficitAtomic: "0",
          ...overrides,
        },
      ],
    },
  };
}
