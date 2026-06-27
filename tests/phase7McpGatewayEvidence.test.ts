import { describe, expect, it } from "vitest";

import { createMcpDemoBundle } from "../apps/mcp-demo/src/index.js";
import { collectPhase7McpGatewayEvidence } from "../src/phase7McpGatewayEvidence.js";
import type {
  Split402DiscoveryFetch,
  Split402DiscoveryFetchResponse,
} from "../packages/router/src/index.js";

describe("Phase 7 MCP gateway evidence collector", () => {
  it("captures a gateway transcript using control-plane discovery mode", async () => {
    const bundle = createMcpDemoBundle({
      merchantOrigin: "https://merchant.example",
      generatedAt: "2026-06-26T00:00:00.000Z",
    });
    const writes = new Map<string, string>();
    const calls: string[] = [];

    const report = await collectPhase7McpGatewayEvidence({
      outputDir: "evidence",
      env: {
        SPLIT402_MCP_CONTROL_PLANE_URL: "https://control.example",
        SPLIT402_MCP_CONTROL_PLANE_TOKEN: "control-token",
        SPLIT402_MCP_CAPABILITY: "solana.wallet-risk",
      },
      fetch: gatewayFetch(calls, bundle),
      writeArtifact: (path, text) => writes.set(path, text),
    });

    expect(report).toEqual({
      schema: "split402.phase7_mcp_gateway_evidence.v1",
      outputDir: "evidence",
      artifactPath: "evidence/mcp-gateway.jsonl",
      executionMode: "router-live-agent-sdk",
      capability: "solana.wallet-risk",
      executionCaptured: false,
      receiptLookupCaptured: false,
      requestCount: 3,
      responseCount: 3,
    });
    expect(calls).toEqual([
      "https://control.example/v1/routes/search?status=active",
      "https://control.example/v1/routes/rte_discovered/bazaar-resources",
      "https://control.example/v1/campaigns/cmp_00000000000000000000000000000002",
      "https://control.example/v1/merchants/mrc_00000000000000000000000000000001",
    ]);
    const transcript = writes.get("evidence/mcp-gateway.jsonl");
    expect(transcript).toContain('"direction":"request"');
    expect(transcript).toContain('"method":"tools/list"');
    expect(transcript).toContain('"split402.searchCapabilities"');
    expect(transcript).toContain('"providerId":"rte_discovered:wallet-risk-score"');
    expect(transcript).not.toContain('"id":"execute"');
  });

  it("captures demo execution and receipt lookup when no live control plane is configured", async () => {
    const writes = new Map<string, string>();

    const report = await collectPhase7McpGatewayEvidence({
      outputDir: "evidence",
      env: {
        SPLIT402_MCP_CAPABILITY: "solana.wallet-risk",
        SPLIT402_MCP_WALLET: "wallet-demo-1",
        SPLIT402_MCP_MAX_AMOUNT_ATOMIC: "50000",
      },
      writeArtifact: (path, text) => writes.set(path, text),
    });

    expect(report).toEqual({
      schema: "split402.phase7_mcp_gateway_evidence.v1",
      outputDir: "evidence",
      artifactPath: "evidence/mcp-gateway.jsonl",
      executionMode: "router-demo-mock",
      capability: "solana.wallet-risk",
      executionCaptured: true,
      receiptLookupCaptured: true,
      requestCount: 5,
      responseCount: 5,
    });
    const transcript = writes.get("evidence/mcp-gateway.jsonl");
    expect(transcript).toContain('"split402.execute"');
    expect(transcript).toContain('"split402.getReceipt"');
    expect(transcript).toContain('"providerId":"split402-demo-merchant"');
    expect(transcript).toContain('"amountPaidAtomic":"10000"');
    expect(transcript).toContain('"receiptId":"rcp_00000000000000000000000000000005"');
    expect(transcript).toContain('"receiptVerificationStatus":"verified"');
    expect(transcript).toContain('"referrerCreditAtomic":"1800"');
  });
});

function gatewayFetch(
  calls: string[],
  bundle: ReturnType<typeof createMcpDemoBundle>,
): Split402DiscoveryFetch {
  return async (url, init) => {
    expect(init?.headers?.authorization).toBe("Bearer control-token");
    calls.push(url);
    const parsed = new URL(url);
    if (parsed.pathname === "/v1/routes/search") {
      return jsonResponse({
        routes: [
          {
            id: "rte_discovered",
            campaignId: bundle.mcp.tools[0].split402.campaignId,
          },
        ],
      });
    }
    if (parsed.pathname === "/v1/routes/rte_discovered/bazaar-resources") {
      return jsonResponse({
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
                payTo: "merchant-pay-to-wallet",
              },
            ],
            metadata: {
              method: "POST",
              operationId: bundle.mcp.tools[0].split402.operationId,
              split402: {
                routeId: "rte_discovered",
                campaignId: bundle.mcp.tools[0].split402.campaignId,
              },
            },
          },
        ],
      });
    }
    if (parsed.pathname === `/v1/campaigns/${bundle.mcp.tools[0].split402.campaignId}`) {
      return jsonResponse({
        campaign: {
          merchantId: bundle.merchant.merchantId,
          current: { merchantKid: "kid_mcp_demo_1" },
        },
      });
    }
    if (parsed.pathname === `/v1/merchants/${bundle.merchant.merchantId}`) {
      return jsonResponse({
        merchant: {
          keys: [
            {
              kid: "kid_mcp_demo_1",
              publicKey: bundle.merchant.servicePublicKey,
              purpose: "offer_receipt",
              validFrom: "2026-06-24T00:00:00.000Z",
            },
          ],
        },
      });
    }
    return jsonResponse({}, 404);
  };
}

function jsonResponse(
  body: unknown,
  status = 200,
): Split402DiscoveryFetchResponse {
  return {
    status,
    text: async () => JSON.stringify(body),
  };
}
