import { describe, expect, it } from "vitest";

import {
  createMcpGatewayContext,
  createWalletRiskToolResult,
  handleMcpGatewayLine,
  handleMcpGatewayLineAsync
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
        commissionBps: 2000,
        protocolFeeBpsOfCommission: 1000
      }
    });
    expect(bundle.expectedEconomics).toEqual({
      paymentAmountAtomic: "10000",
      referrerCommissionBps: 2000,
      protocolFeeBpsOfCommission: 1000,
      commissionAmountAtomic: "2000",
      protocolFeeAtomic: "200",
      referrerCreditAtomic: "1800",
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
    expect(bundle.expectedEconomics.protocolFeeAtomic).toBe("2500");
    expect(bundle.expectedEconomics.referrerCreditAtomic).toBe("22500");
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

    expect(response?.jsonrpc).toBe("2.0");
    expect(response?.id).toBe(1);
    const result = response?.result as {
      tools: { name: string; inputSchema?: { required?: string[] } }[];
    };
    expect(result.tools.map((tool) => tool.name)).toEqual([
      "split402.walletRiskScore",
      "split402.searchCapabilities",
      "split402.execute",
      "split402.getReceipt"
    ]);
    expect(result.tools[0]?.inputSchema?.required).toEqual(["wallet"]);
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
            referrerCreditAtomic: "1800"
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

  it("searches router capabilities through MCP tools/call", async () => {
    const response = await handleMcpGatewayLineAsync(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "search-1",
        method: "tools/call",
        params: {
          name: "split402.searchCapabilities",
          arguments: {
            capability: "solana.wallet-risk"
          }
        }
      }),
      createMcpGatewayContext(
        createMcpDemoBundle({
          generatedAt: "2026-06-26T00:00:00.000Z"
        })
      )
    );

    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: "search-1",
      result: {
        structuredContent: {
          capabilities: [
            expect.objectContaining({
              providerId: "split402-demo-merchant",
              capability: "solana.wallet-risk",
              amountAtomic: "10000"
            })
          ]
        },
        isError: false
      }
    });
  });

  it("executes through the router gateway and stores receipts for lookup", async () => {
    const context = createMcpGatewayContext(
      createMcpDemoBundle({
        generatedAt: "2026-06-26T00:00:00.000Z"
      })
    );
    const executeResponse = await handleMcpGatewayLineAsync(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "execute-1",
        method: "tools/call",
        params: {
          name: "split402.execute",
          arguments: {
            capability: "solana.wallet-risk",
            input: {
              wallet: "wallet-123"
            },
            budget: {
              network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
              asset: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
              maxAmountAtomic: "10000"
            }
          }
        }
      }),
      context
    );

    expect(executeResponse).toMatchObject({
      jsonrpc: "2.0",
      id: "execute-1",
      result: {
        structuredContent: {
          status: "executed",
          executionMode: "router-demo-mock",
          providerId: "split402-demo-merchant",
          amountPaidAtomic: "10000",
          receiptId: "rcp_00000000000000000000000000000005",
          receiptVerificationStatus: "verified",
          referrerCreditAtomic: "1800",
          data: {
            wallet: "wallet-123",
            risk: "low"
          }
        },
        isError: false
      }
    });

    const receiptResponse = await handleMcpGatewayLineAsync(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "receipt-1",
        method: "tools/call",
        params: {
          name: "split402.getReceipt",
          arguments: {
            receiptId: "rcp_00000000000000000000000000000005"
          }
        }
      }),
      context
    );

    expect(receiptResponse).toMatchObject({
      jsonrpc: "2.0",
      id: "receipt-1",
      result: {
        structuredContent: {
          receiptId: "rcp_00000000000000000000000000000005",
          receipt: expect.objectContaining({
            referrerCreditAtomic: "1800"
          })
        },
        isError: false
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
          protocolFeeBpsOfCommission: 0,
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
        protocolFeeAtomic: "0",
        merchantRetainsAtomic: "4500"
      }
    });
  });
});
