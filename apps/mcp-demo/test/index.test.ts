import { describe, expect, it } from "vitest";

import { createMcpDemoBundle } from "../src/index.js";

describe("createMcpDemoBundle", () => {
  it("describes the Split402 paid MCP tool and economics", () => {
    const bundle = createMcpDemoBundle({
      generatedAt: "2026-06-26T00:00:00.000Z"
    });

    expect(bundle.project).toBe("Split402");
    expect(bundle.schemaVersion).toBe("split402.mcp-demo-bundle.v1");
    expect(bundle.merchant.discoveryUrl).toBe(
      "http://localhost:4021/.well-known/split402.json"
    );
    expect(bundle.mcp.tools[0]).toMatchObject({
      name: "split402.walletRiskScore",
      paidHttpCall: {
        method: "POST",
        url: "http://localhost:4021/v1/risk"
      },
      x402: {
        scheme: "exact",
        amountAtomic: "10000"
      },
      split402: {
        commissionBps: 2000
      }
    });
    expect(bundle.expectedEconomics).toEqual({
      paymentAmountAtomic: "10000",
      referrerCommissionBps: 2000,
      referrerCreditAtomic: "2000",
      merchantRetainsAtomic: "8000"
    });
  });

  it("normalizes origins and accepts custom economics", () => {
    const bundle = createMcpDemoBundle({
      merchantOrigin: "https://merchant.example/",
      requiredAmountAtomic: "250000",
      commissionBps: 1000,
      generatedAt: "2026-06-26T00:00:00.000Z"
    });

    expect(bundle.merchant.origin).toBe("https://merchant.example");
    expect(bundle.mcp.tools[0].paidHttpCall.url).toBe(
      "https://merchant.example/v1/risk"
    );
    expect(bundle.expectedEconomics.referrerCreditAtomic).toBe("25000");
    expect(bundle.expectedEconomics.merchantRetainsAtomic).toBe("225000");
  });
});
