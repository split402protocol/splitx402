import { createSampleProtocolArtifacts } from "@split402/protocol";
import { describe, expect, it } from "vitest";

import {
  CampaignRegistryConflictError,
  InMemoryCampaignRegistry,
  type CampaignTermsInput
} from "../src/index.js";

const FIXED_NOW = new Date("2026-06-24T00:00:00Z");

describe("campaign registry", () => {
  it("creates immutable campaign terms and signing bytes", () => {
    const bundle = createSampleProtocolArtifacts();
    const registry = createRegistry();

    const campaign = registry.createCampaign({
      id: bundle.artifacts.receipt.campaignId,
      merchantId: bundle.artifacts.receipt.merchantId,
      ...createCampaignTerms()
    });
    const version = registry.getCampaignVersion(campaign.id, 1);

    expect(campaign.status).toBe("draft");
    expect(campaign.currentVersion).toBe(1);
    expect(campaign.current.termsHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(campaign.current.signingBytesHex).toMatch(/^[0-9a-f]+$/u);
    expect(version?.terms).toEqual(campaign.current.terms);
  });

  it("creates the next immutable version without changing the old version", () => {
    const bundle = createSampleProtocolArtifacts();
    const registry = createRegistry();
    const campaign = registry.createCampaign({
      id: bundle.artifacts.receipt.campaignId,
      merchantId: bundle.artifacts.receipt.merchantId,
      ...createCampaignTerms()
    });
    const firstVersion = registry.getCampaignVersion(campaign.id, 1);

    const secondVersion = registry.createCampaignVersion({
      campaignId: campaign.id,
      ...createCampaignTerms({ commissionBps: 2500 })
    });
    const current = registry.getCampaign(campaign.id);

    expect(firstVersion?.version).toBe(1);
    expect(firstVersion?.terms.commissionBps).toBe(2000);
    expect(secondVersion.version).toBe(2);
    expect(secondVersion.terms.commissionBps).toBe(2500);
    expect(current?.currentVersion).toBe(2);
    expect(current?.current.termsHash).toBe(secondVersion.termsHash);
  });

  it("rejects duplicate campaign ids", () => {
    const bundle = createSampleProtocolArtifacts();
    const registry = createRegistry();
    registry.createCampaign({
      id: bundle.artifacts.receipt.campaignId,
      merchantId: bundle.artifacts.receipt.merchantId,
      ...createCampaignTerms()
    });

    expect(() =>
      registry.createCampaignVersion({
        campaignId: bundle.artifacts.receipt.campaignId,
        ...createCampaignTerms()
      })
    ).not.toThrow(CampaignRegistryConflictError);
    expect(() =>
      registry.createCampaign({
        id: bundle.artifacts.receipt.campaignId,
        merchantId: bundle.artifacts.receipt.merchantId,
        ...createCampaignTerms({ commissionBps: 2500 })
      })
    ).toThrow(CampaignRegistryConflictError);
  });
});

function createRegistry(): InMemoryCampaignRegistry {
  return new InMemoryCampaignRegistry({
    now: () => FIXED_NOW,
    campaignIdFactory: () => "cmp_ffffffffffffffffffffffffffffffff"
  });
}

function createCampaignTerms(
  overrides: Partial<CampaignTermsInput> = {}
): CampaignTermsInput {
  const bundle = createSampleProtocolArtifacts();
  return {
    resourceOrigin: bundle.artifacts.receipt.merchantOrigin,
    operations: [
      {
        operationId: bundle.artifacts.receipt.operationId,
        method: "POST",
        pathTemplate: "/v1/risk"
      }
    ],
    network: bundle.artifacts.receipt.network,
    asset: bundle.artifacts.receipt.asset,
    requiredAmountAtomic: bundle.artifacts.receipt.requiredAmountAtomic,
    payToWallet: bundle.artifacts.receipt.payToWallet,
    commissionBps: bundle.artifacts.receipt.commissionBps,
    payoutThresholdAtomic: "100000",
    startsAt: "2026-06-24T00:00:00Z",
    endsAt: null,
    ...overrides
  };
}
