import { describe, expect, it } from "vitest";

import {
  createWalletRiskToolResult,
  handleMcpGatewayLine
} from "../src/gateway.js";
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

describe("MCP demo gateway", () => {
  it("exposes the Split402 paid tool through MCP tools/list", () => {
    const response = handleMcpGatewayLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list"
      }),
      createMcpDemoBundle({
        generatedAt: "2026-06-26T00:00:00.000Z"
      })
    );

    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        tools: [
          {
            name: "split402.walletRiskScore",
            inputSchema: {
              required: ["wallet"]
            }
          }
        ]
      }
    });
  });

  it("returns x402 and Split402 payment context for tool calls", () => {
    const response = handleMcpGatewayLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "call-1",
        method: "tools/call",
        params: {
          name: "split402.walletRiskScore",
          arguments: {
            wallet: "referrer-wallet"
          }
        }
      }),
      createMcpDemoBundle({
        generatedAt: "2026-06-26T00:00:00.000Z"
      })
    );

    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: "call-1",
      result: {
        structuredContent: {
          status: "payment_required",
          wallet: "referrer-wallet",
          paidHttpCall: {
            method: "POST",
            url: "http://localhost:4021/v1/risk",
            bodyTemplate: {
              wallet: "referrer-wallet"
            }
          },
          x402: {
            scheme: "exact",
            amountAtomic: "10000"
          },
          split402: {
            campaignId: "cmp_00000000000000000000000000000002",
            commissionBps: 2000
          },
          expectedEconomics: {
            referrerCreditAtomic: "2000"
          }
        },
        isError: false
      }
    });
  });

  it("validates required MCP tool arguments", () => {
    const response = handleMcpGatewayLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "split402.walletRiskScore",
          arguments: {}
        }
      })
    );

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 2,
      error: {
        code: -32602,
        message: "wallet argument is required"
      }
    });
  });

  it("builds a wallet risk tool result from the bundle", () => {
    expect(
      createWalletRiskToolResult(
        "wallet-123",
        createMcpDemoBundle({
          merchantOrigin: "https://merchant.staging.example",
          commissionBps: 1000,
          requiredAmountAtomic: "5000",
          generatedAt: "2026-06-26T00:00:00.000Z"
        })
      )
    ).toMatchObject({
      status: "payment_required",
      wallet: "wallet-123",
      paidHttpCall: {
        url: "https://merchant.staging.example/v1/risk",
        bodyTemplate: {
          wallet: "wallet-123"
        }
      },
      expectedEconomics: {
        referrerCreditAtomic: "500",
        merchantRetainsAtomic: "4500"
      }
    });
  });
});
