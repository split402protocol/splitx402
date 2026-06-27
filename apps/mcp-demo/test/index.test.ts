import { describe, expect, it } from "vitest";
import type { Split402DiscoveryFetch, Split402DiscoveryFetchResponse } from "@split402/router";

import {
  createMcpGatewayContext,
  createMcpGatewayContextFromEnv,
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
    expect(result.tools[2]?.inputSchema).toMatchObject({
      properties: {
        budget: {
          required: ["maxAmountAtomic"]
        }
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

  it("can build the gateway router from control-plane discovery", async () => {
    const calls: string[] = [];
    const bundle = createMcpDemoBundle({
      merchantOrigin: "https://merchant.example",
      generatedAt: "2026-06-26T00:00:00.000Z"
    });
    const context = await createMcpGatewayContextFromEnv({
      bundle,
      env: {
        SPLIT402_MCP_CONTROL_PLANE_URL: "https://control.example",
        SPLIT402_MCP_CONTROL_PLANE_TOKEN: "control-token",
        SPLIT402_MCP_CAPABILITY: "solana.wallet-risk",
        SPLIT402_MCP_DISCOVERY_LIMIT: "10"
      },
      fetch: mcpControlPlaneFetch(calls, bundle)
    });

    const response = await handleMcpGatewayLineAsync(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "search-discovered",
        method: "tools/call",
        params: {
          name: "split402.searchCapabilities",
          arguments: {
            capability: "solana.wallet-risk"
          }
        }
      }),
      context
    );

    expect(context.executionMode).toBe("router-live-agent-sdk");
    expect(response).toMatchObject({
      result: {
        structuredContent: {
          capabilities: [
            expect.objectContaining({
              providerId: "rte_discovered:wallet-risk-score",
              capability: "solana.wallet-risk",
              merchantOrigin: "https://merchant.example",
              amountAtomic: "10000"
            })
          ]
        },
        isError: false
      }
    });
    expect(calls).toEqual([
      "https://control.example/v1/routes/search?status=active&limit=10",
      "https://control.example/v1/routes/rte_discovered/bazaar-resources",
      "https://control.example/v1/campaigns/cmp_00000000000000000000000000000002",
      "https://control.example/v1/merchants/mrc_00000000000000000000000000000001"
    ]);
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

  it("rejects router execution when an optional budget asset override is unsupported", async () => {
    const context = createMcpGatewayContext(
      createMcpDemoBundle({
        generatedAt: "2026-06-26T00:00:00.000Z"
      })
    );

    const response = await handleMcpGatewayLineAsync(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "execute-wrong-asset",
        method: "tools/call",
        params: {
          name: "split402.execute",
          arguments: {
            capability: "solana.wallet-risk",
            input: {
              wallet: "wallet-123"
            },
            budget: {
              asset: "wrong-asset",
              maxAmountAtomic: "10000"
            }
          }
        }
      }),
      context
    );

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: "execute-wrong-asset",
      error: {
        code: -32000,
        message:
          "no providers support solana.wallet-risk on solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1/wrong-asset"
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

function mcpControlPlaneFetch(
  calls: string[],
  bundle: ReturnType<typeof createMcpDemoBundle>
): Split402DiscoveryFetch {
  return async (url, init) => {
    expect(init?.headers?.authorization).toBe("Bearer control-token");
    calls.push(url);
    const parsed = new URL(url);
    if (parsed.pathname === "/v1/routes/search") {
      return mcpJsonResponse({
        routes: [{ id: "rte_discovered", campaignId: bundle.mcp.tools[0].split402.campaignId }]
      });
    }
    if (parsed.pathname === "/v1/routes/rte_discovered/bazaar-resources") {
      return mcpJsonResponse({
        resources: [
          {
            schema: "split402.bazaar_resource.v1",
            resource: `${bundle.merchant.origin}/v1/risk`,
            type: "http",
            x402Version: 2,
            accepts: [
              {
                scheme: "exact",
                network: bundle.mcp.tools[0].x402.network,
                amount: bundle.mcp.tools[0].x402.amountAtomic,
                asset: bundle.mcp.tools[0].x402.asset,
                payTo: "merchant-pay-to-wallet"
              }
            ],
            metadata: {
              method: "POST",
              operationId: bundle.mcp.tools[0].split402.operationId,
              split402: {
                routeId: "rte_discovered",
                campaignId: bundle.mcp.tools[0].split402.campaignId,
                referrerWallet: "referrer-wallet",
                payoutWallet: "payout-wallet"
              }
            }
          }
        ]
      });
    }
    if (parsed.pathname === `/v1/campaigns/${bundle.mcp.tools[0].split402.campaignId}`) {
      return mcpJsonResponse({
        campaign: {
          merchantId: bundle.merchant.merchantId,
          current: { merchantKid: "kid_mcp_demo_1" }
        }
      });
    }
    if (parsed.pathname === `/v1/merchants/${bundle.merchant.merchantId}`) {
      return mcpJsonResponse({
        merchant: {
          keys: [
            {
              kid: "kid_mcp_demo_1",
              publicKey: bundle.merchant.servicePublicKey,
              purpose: "offer_receipt",
              validFrom: "2026-06-24T00:00:00.000Z"
            }
          ]
        }
      });
    }
    return mcpJsonResponse({}, 404);
  };
}

function mcpJsonResponse(
  body: unknown,
  status = 200
): Split402DiscoveryFetchResponse {
  return {
    status,
    text: async () => JSON.stringify(body)
  };
}
