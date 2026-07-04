import { describe, expect, it } from "vitest";

import { createMcpDemoBundle } from "../apps/mcp-demo/src/index.js";
import { createSampleProtocolArtifacts } from "../packages/protocol/src/index.js";
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
      proofReady: false,
      blockers: [
        "mcp_gateway_evidence requires split402.execute; set SPLIT402_PHASE7_MCP_GATEWAY_EXECUTE=1 for hosted mode",
        "mcp_gateway_evidence did not capture successful split402.quote",
        "mcp_gateway_evidence did not capture successful split402.execute",
        "mcp_gateway_evidence did not capture successful split402.getReceipt",
      ],
      quoteCaptured: false,
      executionCaptured: false,
      receiptLookupCaptured: false,
      maxAmountAtomic: "50000",
      requestCount: 3,
      responseCount: 3,
    });
    expect(calls).toEqual([
      "https://control.example/v1/routes/search?status=active",
      "https://control.example/v1/routes/rte_discovered/bazaar-resources",
      "https://control.example/v1/campaigns/cmp_00000000000000000000000000000002",
      "https://control.example/v1/merchants/mrc_00000000000000000000000000000001",
      "https://control.example/v1/routes/rte_discovered",
    ]);
    const transcript = writes.get("evidence/mcp-gateway.jsonl");
    expect(transcript).toContain('"direction":"request"');
    expect(transcript).toContain('"method":"tools/list"');
    expect(transcript).toContain('"split402.searchCapabilities"');
    expect(transcript).toContain('"budget":{"maxAmountAtomic":"50000"}');
    expect(transcript).toContain('"providerId":"rte_discovered:wallet-risk-score"');
    expect(transcript).toContain('"source":"control_plane"');
    expect(transcript).not.toContain('"id":"execute"');
  });

  it("captures demo execution and receipt lookup when no live control plane is configured", async () => {
    const bundle = createMcpDemoBundle();
    const sample = createSampleProtocolArtifacts();
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

    expect(report).toMatchObject({
      schema: "split402.phase7_mcp_gateway_evidence.v1",
      outputDir: "evidence",
      artifactPath: "evidence/mcp-gateway.jsonl",
      executionMode: "router-demo-mock",
      capability: "solana.wallet-risk",
      proofReady: false,
      blockers: [
        "mcp_gateway_evidence requires router-live-agent-sdk execution mode for Phase 7 hosted proof",
      ],
      quoteCaptured: true,
      executionCaptured: true,
      receiptLookupCaptured: true,
      providerId: "split402-demo-merchant",
      maxAmountAtomic: "50000",
      quoteProviderId: "split402-demo-merchant",
      quotedAmountAtomic: "10000",
      quoteExecutionMode: "router-demo-mock",
      quoteMaxAttempts: 1,
      quoteProviderNetwork: bundle.mcp.tools[0].x402.network,
      quoteProviderAsset: bundle.mcp.tools[0].x402.asset,
      quoteProviderMerchantOrigin: bundle.merchant.origin,
      quoteProviderOperationId: bundle.mcp.tools[0].split402.operationId,
      quoteProviderCampaignId: bundle.mcp.tools[0].split402.campaignId,
      quoteProviderAmountAtomic: "10000",
      quoteProviderPayToWallet: bundle.mcp.tools[0].x402.payToWallet,
      quoteProviderRouteId: "rte_00000000000000000000000000000003",
      quoteProviderReferrerWallet: sample.artifacts.receipt.referrerWallet,
      quoteProviderPayoutWallet: sample.artifacts.receipt.payoutWallet,
      quoteProviderSource: "static",
      providerNetwork: bundle.mcp.tools[0].x402.network,
      providerAsset: bundle.mcp.tools[0].x402.asset,
      providerMerchantOrigin: bundle.merchant.origin,
      providerOperationId: bundle.mcp.tools[0].split402.operationId,
      providerCampaignId: bundle.mcp.tools[0].split402.campaignId,
      providerAmountAtomic: "10000",
      providerPayToWallet: bundle.mcp.tools[0].x402.payToWallet,
      providerRouteId: "rte_00000000000000000000000000000003",
      providerReferrerWallet: sample.artifacts.receipt.referrerWallet,
      providerPayoutWallet: sample.artifacts.receipt.payoutWallet,
      providerSource: "static",
      executeProviderNetwork: bundle.mcp.tools[0].x402.network,
      executeProviderAsset: bundle.mcp.tools[0].x402.asset,
      executeProviderMerchantOrigin: bundle.merchant.origin,
      executeProviderOperationId: bundle.mcp.tools[0].split402.operationId,
      executeProviderCampaignId: bundle.mcp.tools[0].split402.campaignId,
      executeProviderAmountAtomic: "10000",
      executeProviderPayToWallet: bundle.mcp.tools[0].x402.payToWallet,
      executeProviderRouteId: "rte_00000000000000000000000000000003",
      executeProviderReferrerWallet: sample.artifacts.receipt.referrerWallet,
      executeProviderPayoutWallet: sample.artifacts.receipt.payoutWallet,
      executeProviderSource: "static",
      amountPaidAtomic: "10000",
      receiptVerificationStatus: "verified",
      executeExecutionMode: "router-demo-mock",
      referrerCreditAtomic: "1800",
      routeId: "rte_00000000000000000000000000000003",
      network: bundle.mcp.tools[0].x402.network,
      asset: bundle.mcp.tools[0].x402.asset,
      merchantOrigin: bundle.merchant.origin,
      operationId: bundle.mcp.tools[0].split402.operationId,
      campaignId: bundle.mcp.tools[0].split402.campaignId,
      requiredAmountAtomic: "10000",
      payToWallet: bundle.mcp.tools[0].x402.payToWallet,
      receiptReferrerCreditAtomic: "1800",
      receiptReferrerWallet: sample.artifacts.receipt.referrerWallet,
      receiptPayoutWallet: sample.artifacts.receipt.payoutWallet,
      commissionBps: 2000,
      protocolFeeBpsOfCommission: 1000,
      commissionAmountAtomic: "2000",
      protocolFeeAtomic: "200",
      requestCount: 6,
      responseCount: 6,
    });
    expect(report.receiptId).toMatch(/^rcp_[0-9a-f]{32}$/u);
    const transcript = writes.get("evidence/mcp-gateway.jsonl");
    expect(transcript).toContain('"split402.quote"');
    expect(transcript).toContain('"split402.execute"');
    expect(transcript).toContain('"split402.getReceipt"');
    expect(transcript).toContain('"budget":{"maxAmountAtomic":"50000"}');
    expect(transcript).toContain('"providerId":"split402-demo-merchant"');
    expect(transcript).toContain('"provider":{"providerId":"split402-demo-merchant"');
    expect(transcript).toContain('"source":"static"');
    expect(transcript).toContain('"amountPaidAtomic":"10000"');
    expect(transcript).toContain(`"receiptId":"${report.receiptId}"`);
    expect(transcript).toContain('"receiptVerificationStatus":"verified"');
    expect(transcript).toContain('"referrerCreditAtomic":"1800"');
    expect(transcript).toContain('"routeId":"rte_00000000000000000000000000000003"');
    expect(transcript).toContain(`"network":"${report.network}"`);
    expect(transcript).toContain(`"asset":"${report.asset}"`);
    expect(transcript).toContain('"requiredAmountAtomic":"10000"');
    expect(transcript).toContain(`"payToWallet":"${report.payToWallet}"`);
    expect(transcript).toContain('"commissionBps":2000');
    expect(transcript).toContain('"protocolFeeBpsOfCommission":1000');
    expect(transcript).toContain('"commissionAmountAtomic":"2000"');
    expect(transcript).toContain('"protocolFeeAtomic":"200"');
  });

  it("requires a signer before hosted live execution collection", async () => {
    const bundle = createMcpDemoBundle({
      merchantOrigin: "https://merchant.example",
      generatedAt: "2026-06-26T00:00:00.000Z",
    });

    await expect(
      collectPhase7McpGatewayEvidence({
        outputDir: "evidence",
        env: {
          SPLIT402_MCP_CONTROL_PLANE_URL: "https://control.example",
          SPLIT402_MCP_CONTROL_PLANE_TOKEN: "control-token",
          SPLIT402_MCP_CAPABILITY: "solana.wallet-risk",
          SPLIT402_PHASE7_MCP_GATEWAY_EXECUTE: "1",
        },
        fetch: gatewayFetch([], bundle),
        writeArtifact: () => undefined,
      }),
    ).rejects.toThrow(
      "SPLIT402_MCP_SVM_PRIVATE_KEY, SVM_PRIVATE_KEY, SPLIT402_MCP_EVM_PRIVATE_KEY, or EVM_PRIVATE_KEY is required for live MCP gateway execution",
    );
  });

  it("requires a control-plane token before hosted discovery collection", async () => {
    const bundle = createMcpDemoBundle({
      merchantOrigin: "https://merchant.example",
      generatedAt: "2026-06-26T00:00:00.000Z",
    });
    const calls: string[] = [];

    await expect(
      collectPhase7McpGatewayEvidence({
        outputDir: "evidence",
        env: {
          SPLIT402_MCP_CONTROL_PLANE_URL: "https://control.example",
          SPLIT402_MCP_CAPABILITY: "solana.wallet-risk",
        },
        fetch: gatewayFetch(calls, bundle),
        writeArtifact: () => undefined,
      }),
    ).rejects.toThrow(
      "SPLIT402_MCP_CONTROL_PLANE_TOKEN is required for live MCP gateway discovery",
    );
    expect(calls).toEqual([]);
  });

  it("rejects malformed MCP max budget before discovery or execution", async () => {
    const bundle = createMcpDemoBundle({
      merchantOrigin: "https://merchant.example",
      generatedAt: "2026-06-26T00:00:00.000Z",
    });
    const calls: string[] = [];

    await expect(
      collectPhase7McpGatewayEvidence({
        outputDir: "evidence",
        env: {
          SPLIT402_MCP_CONTROL_PLANE_URL: "https://control.example",
          SPLIT402_MCP_CONTROL_PLANE_TOKEN: "control-token",
          SPLIT402_MCP_CAPABILITY: "solana.wallet-risk",
          SPLIT402_MCP_MAX_AMOUNT_ATOMIC: "01",
        },
        fetch: gatewayFetch(calls, bundle),
        writeArtifact: () => undefined,
      }),
    ).rejects.toThrow(
      "SPLIT402_MCP_MAX_AMOUNT_ATOMIC must be a non-negative atomic amount string",
    );
    expect(calls).toEqual([]);
  });
});

function gatewayFetch(
  calls: string[],
  bundle: ReturnType<typeof createMcpDemoBundle>,
): Split402DiscoveryFetch {
  const sample = createSampleProtocolArtifacts();
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
                payTo: bundle.mcp.tools[0].x402.payToWallet,
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
    if (parsed.pathname === "/v1/routes/rte_discovered") {
      return jsonResponse({
        route: {
          id: "rte_discovered",
          claim: sample.artifacts.referralClaim,
        },
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
