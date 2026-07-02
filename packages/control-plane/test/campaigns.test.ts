import {
  createSampleProtocolArtifacts,
  hexToBytes,
  signEd25519Message
} from "@split402/protocol";
import { describe, expect, it } from "vitest";

import {
  buildCampaignTermsSigningBytes,
  CampaignRegistryConflictError,
  InMemoryCampaignRegistry,
  type CampaignTermsInput
} from "../src/index.js";

const FIXED_NOW = new Date("2026-06-24T00:00:00Z");
const MERCHANT_SEED = hexToBytes(
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
);

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
    expect(campaign.current.terms.protocolFeeBpsOfCommission).toBe(
      bundle.artifacts.receipt.protocolFeeBpsOfCommission
    );
  });

  it("normalizes deprecated protocolFeeBps and rejects conflicting fee fields", () => {
    const bundle = createSampleProtocolArtifacts();
    const registry = createRegistry();
    const legacy = registry.createCampaign({
      id: bundle.artifacts.receipt.campaignId,
      merchantId: bundle.artifacts.receipt.merchantId,
      ...createCampaignTerms({
        protocolFeeBps: 1000
      })
    });

    expect(legacy.current.terms.protocolFeeBpsOfCommission).toBe(1000);
    expect(() =>
      registry.createCampaign({
        id: "cmp_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        merchantId: bundle.artifacts.receipt.merchantId,
        ...createCampaignTerms({
          protocolFeeBpsOfCommission: 1000,
          protocolFeeBps: 999
        })
      })
    ).toThrow(
      "protocolFeeBps and protocolFeeBpsOfCommission must match when both are provided"
    );
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

  it("lists merchant campaigns with status filtering and newest-first order", () => {
    const bundle = createSampleProtocolArtifacts();
    const registry = createRegistry();
    const first = registry.createCampaign({
      id: bundle.artifacts.receipt.campaignId,
      merchantId: bundle.artifacts.receipt.merchantId,
      ...createCampaignTerms()
    });
    registry.activateCampaignVersion({
      campaignId: first.id,
      merchantKid: bundle.artifacts.receipt.kid,
      merchantPublicKey: bundle.keys.merchantPublicKey,
      merchantSignature: signCampaignTerms(first.current)
    });
    const second = registry.createCampaign({
      id: "cmp_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      merchantId: bundle.artifacts.receipt.merchantId,
      ...createCampaignTerms({ commissionBps: 2500 })
    });

    expect(
      registry
        .listMerchantCampaigns({ merchantId: bundle.artifacts.receipt.merchantId })
        .map((campaign) => campaign.id)
    ).toEqual([second.id, first.id]);
    expect(
      registry
        .listMerchantCampaigns({
          merchantId: bundle.artifacts.receipt.merchantId,
          status: "active"
        })
        .map((campaign) => campaign.id)
    ).toEqual([first.id]);
  });

  it("activates the current campaign version with a merchant service-key signature", () => {
    const bundle = createSampleProtocolArtifacts();
    const registry = createRegistry();
    const campaign = registry.createCampaign({
      id: bundle.artifacts.receipt.campaignId,
      merchantId: bundle.artifacts.receipt.merchantId,
      ...createCampaignTerms()
    });
    const merchantSignature = signCampaignTerms(campaign.current);

    const activated = registry.activateCampaignVersion({
      campaignId: campaign.id,
      merchantKid: bundle.artifacts.receipt.kid,
      merchantPublicKey: bundle.keys.merchantPublicKey,
      merchantSignature
    });

    expect(activated.status).toBe("active");
    expect(activated.current.merchantKid).toBe(bundle.artifacts.receipt.kid);
    expect(activated.current.merchantSignature).toBe(merchantSignature);
    expect(activated.current.activatedAt).toBe(FIXED_NOW.toISOString());
  });

  it("pauses, resumes, and closes activated campaigns with guarded transitions", () => {
    const bundle = createSampleProtocolArtifacts();
    const registry = createRegistry();
    const campaign = registry.createCampaign({
      id: bundle.artifacts.receipt.campaignId,
      merchantId: bundle.artifacts.receipt.merchantId,
      ...createCampaignTerms()
    });

    expect(() =>
      registry.updateCampaignStatus({ campaignId: campaign.id, status: "paused" })
    ).toThrow("only active campaigns can be paused");
    expect(() =>
      registry.updateCampaignStatus({ campaignId: campaign.id, status: "active" })
    ).toThrow(/only paused campaigns can be resumed/u);

    registry.activateCampaignVersion({
      campaignId: campaign.id,
      merchantKid: bundle.artifacts.receipt.kid,
      merchantPublicKey: bundle.keys.merchantPublicKey,
      merchantSignature: signCampaignTerms(campaign.current)
    });

    const paused = registry.updateCampaignStatus({
      campaignId: campaign.id,
      status: "paused"
    });
    expect(paused?.status).toBe("paused");

    const resumed = registry.updateCampaignStatus({
      campaignId: campaign.id,
      status: "active"
    });
    expect(resumed?.status).toBe("active");

    const closed = registry.updateCampaignStatus({
      campaignId: campaign.id,
      status: "closed"
    });
    expect(closed?.status).toBe("closed");
    expect(() =>
      registry.updateCampaignStatus({ campaignId: campaign.id, status: "active" })
    ).toThrow(/only paused campaigns can be resumed/u);
    expect(
      registry.updateCampaignStatus({
        campaignId: "cmp_00000000000000000000000000000099",
        status: "closed"
      })
    ).toBeUndefined();
  });

  it("rejects campaign activation when the merchant signature is invalid", () => {
    const bundle = createSampleProtocolArtifacts();
    const registry = createRegistry();
    const campaign = registry.createCampaign({
      id: bundle.artifacts.receipt.campaignId,
      merchantId: bundle.artifacts.receipt.merchantId,
      ...createCampaignTerms()
    });

    expect(() =>
      registry.activateCampaignVersion({
        campaignId: campaign.id,
        merchantKid: bundle.artifacts.receipt.kid,
        merchantPublicKey: bundle.keys.merchantPublicKey,
        merchantSignature: mutateSignature(signCampaignTerms(campaign.current))
      })
    ).toThrow("invalid campaign terms signature");
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
    protocolFeeBpsOfCommission:
      bundle.artifacts.receipt.protocolFeeBpsOfCommission,
    payoutThresholdAtomic: "100000",
    startsAt: "2026-06-24T00:00:00Z",
    endsAt: null,
    ...overrides
  };
}

function signCampaignTerms(
  version: ReturnType<InMemoryCampaignRegistry["createCampaign"]>["current"]
): string {
  return signEd25519Message(
    buildCampaignTermsSigningBytes(version.terms),
    MERCHANT_SEED
  ).signature;
}

function mutateSignature(signature: string): string {
  return `${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;
}
