import { createSampleProtocolArtifacts } from "@split402/protocol";
import { describe, expect, it } from "vitest";

import {
  CachedControlPlaneCampaignResolver,
  MerchantCampaignResolverError,
  type MerchantControlPlaneFetch
} from "../src/index.js";

describe("CachedControlPlaneCampaignResolver", () => {
  it("refreshes active control-plane campaigns into a synchronous resolver cache", async () => {
    const receipt = createSampleProtocolArtifacts().artifacts.receipt;
    const requests: unknown[] = [];
    const resolver = new CachedControlPlaneCampaignResolver({
      controlPlaneUrl: "https://control.example/base",
      staleAfterMs: 60_000,
      now: () => new Date("2026-06-24T00:00:00Z"),
      fetch: createFetch([response(200, campaignResponse("active"))], requests)
    });

    const cached = await resolver.refreshCampaign(receipt.campaignId);

    expect(cached).toEqual(
      expect.objectContaining({
        campaignId: receipt.campaignId,
        status: "active",
        fetchedAt: "2026-06-24T00:00:00.000Z",
        staleAt: "2026-06-24T00:01:00.000Z",
        config: {
          campaignId: receipt.campaignId,
          campaignVersion: receipt.campaignVersion,
          campaignTermsHash: receipt.campaignTermsHash,
          commissionBps: receipt.commissionBps,
          attributionRequired: false,
          allowSelfReferral: false
        },
        operations: [
          {
            operationId: receipt.operationId,
            method: "POST",
            pathTemplate: "/v1/risk/:wallet"
          }
        ]
      })
    );
    expect(
      resolver.resolveCampaign({
        campaignId: receipt.campaignId,
        operationId: receipt.operationId
      })
    ).toEqual(cached.config);
    expect(resolver.isCampaignStale(receipt.campaignId)).toBe(false);
    expect(requests).toEqual([
      {
        url: `https://control.example/v1/campaigns/${receipt.campaignId}`,
        method: "GET",
        headers: { accept: "application/json" }
      }
    ]);
  });

  it("keeps serving cached campaigns after their refresh window becomes stale", async () => {
    const receipt = createSampleProtocolArtifacts().artifacts.receipt;
    let now = new Date("2026-06-24T00:00:00Z");
    const resolver = new CachedControlPlaneCampaignResolver({
      controlPlaneUrl: "https://control.example",
      staleAfterMs: 60_000,
      now: () => now,
      fetch: createFetch([response(200, campaignResponse("active"))])
    });
    await resolver.refreshCampaign(receipt.campaignId);

    now = new Date("2026-06-24T00:02:00Z");

    expect(resolver.isCampaignStale(receipt.campaignId)).toBe(true);
    expect(
      resolver.resolveCampaign({
        campaignId: receipt.campaignId,
        operationId: receipt.operationId
      })
    ).toEqual(
      expect.objectContaining({
        campaignId: receipt.campaignId,
        campaignTermsHash: receipt.campaignTermsHash
      })
    );
  });

  it("rejects inactive campaigns, unknown operations, and HTTP failures", async () => {
    const receipt = createSampleProtocolArtifacts().artifacts.receipt;
    const inactiveResolver = new CachedControlPlaneCampaignResolver({
      controlPlaneUrl: "https://control.example",
      fetch: createFetch([response(200, campaignResponse("paused"))])
    });

    await expect(
      inactiveResolver.refreshCampaign(receipt.campaignId)
    ).rejects.toThrow(MerchantCampaignResolverError);

    const resolver = new CachedControlPlaneCampaignResolver({
      controlPlaneUrl: "https://control.example",
      fetch: createFetch([response(200, campaignResponse("active"))])
    });
    await resolver.refreshCampaign(receipt.campaignId);

    expect(() =>
      resolver.resolveCampaign({
        campaignId: receipt.campaignId,
        operationId: "unknown-operation"
      })
    ).toThrow(MerchantCampaignResolverError);

    const failingResolver = new CachedControlPlaneCampaignResolver({
      controlPlaneUrl: "https://control.example",
      fetch: createFetch([response(503, { error: "maintenance" })])
    });

    await expect(
      failingResolver.refreshCampaign(receipt.campaignId)
    ).rejects.toThrow("HTTP 503");
  });
});

function campaignResponse(status: "active" | "paused") {
  const sample = createSampleProtocolArtifacts();
  const receipt = sample.artifacts.receipt;
  return {
    campaign: {
      id: receipt.campaignId,
      merchantId: receipt.merchantId,
      resourceOrigin: receipt.merchantOrigin,
      status,
      currentVersion: receipt.campaignVersion,
      createdAt: "2026-06-24T00:00:00Z",
      updatedAt: "2026-06-24T00:00:00Z",
      current: {
        campaignId: receipt.campaignId,
        version: receipt.campaignVersion,
        termsHash: receipt.campaignTermsHash,
        signingBytesHex: "abcd",
        activatedAt: "2026-06-24T00:00:00Z",
        createdAt: "2026-06-24T00:00:00Z",
        terms: {
          protocolVersion: "0.1",
          campaignId: receipt.campaignId,
          campaignVersion: receipt.campaignVersion,
          merchantId: receipt.merchantId,
          resourceOrigin: receipt.merchantOrigin,
          operations: [
            {
              operationId: receipt.operationId,
              method: "POST",
              pathTemplate: "/v1/risk/:wallet"
            }
          ],
          network: receipt.network,
          asset: receipt.asset,
          requiredAmountAtomic: receipt.requiredAmountAtomic,
          payToWallet: receipt.payToWallet,
          commissionBps: receipt.commissionBps,
          protocolFeeBps: 0,
          commissionBase: "required_amount",
          settlementMode: "accrual",
          attributionRequired: false,
          allowSelfReferral: false,
          payoutThresholdAtomic: "1000",
          startsAt: "2026-06-24T00:00:00Z",
          endsAt: null
        }
      }
    }
  };
}

function createFetch(
  responses: ReturnType<typeof response>[],
  requests: unknown[] = []
): MerchantControlPlaneFetch {
  let index = 0;
  return async (input, init) => {
    const next = responses[index];
    index += 1;
    if (next === undefined) {
      throw new Error("unexpected fetch");
    }
    requests.push({
      url: input,
      method: init.method,
      headers: init.headers
    });
    return next;
  };
}

function response(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    }
  };
}
