import { describe, expect, it } from "vitest";

import {
  createMerchantDashboardSummary,
  createMerchantReliabilityProfile,
  createSplit402BazaarResources,
  type CampaignProfile,
  type CampaignVersionRecord,
  type RouteRecord,
  type MerchantProfile
} from "../src/index.js";

const MERCHANT: MerchantProfile = {
  id: "mrc_ffffffffffffffffffffffffffffffff",
  slug: "demo-merchant",
  displayName: "Demo Merchant",
  ownerWallet: "owner-wallet",
  status: "active",
  createdAt: "2026-06-24T00:00:00.000Z",
  updatedAt: "2026-06-24T00:00:00.000Z",
  origins: [
    {
      merchantId: "mrc_ffffffffffffffffffffffffffffffff",
      origin: "https://merchant.example",
      verificationMethod: "well_known",
      status: "verified",
      verifiedAt: "2026-06-24T00:01:00.000Z",
      createdAt: "2026-06-24T00:00:00.000Z",
    },
  ],
  keys: [
    {
      merchantId: "mrc_ffffffffffffffffffffffffffffffff",
      kid: "offer-key",
      algorithm: "Ed25519",
      publicKey: "offer-public-key",
      purpose: "offer_receipt",
      validFrom: "2026-06-24T00:00:00.000Z",
      createdAt: "2026-06-24T00:00:00.000Z",
    },
    {
      merchantId: "mrc_ffffffffffffffffffffffffffffffff",
      kid: "webhook-key",
      algorithm: "Ed25519",
      publicKey: "webhook-public-key",
      purpose: "webhook",
      validFrom: "2026-06-24T00:00:00.000Z",
      createdAt: "2026-06-24T00:00:00.000Z",
    },
  ],
  payoutWallets: [
    {
      id: "mpw_ffffffffffffffffffffffffffffffff",
      merchantId: "mrc_ffffffffffffffffffffffffffffffff",
      network: "solana:devnet",
      wallet: "payout-wallet",
      asset: "USDC",
      signerReference: "kms:split402-devnet-payout",
      status: "active",
      createdAt: "2026-06-24T00:00:00.000Z",
    },
  ],
};

const CAMPAIGN_VERSION: CampaignVersionRecord = {
  campaignId: "cmp_ffffffffffffffffffffffffffffffff",
  version: 1,
  terms: {
    protocolVersion: "0.1",
    campaignId: "cmp_ffffffffffffffffffffffffffffffff",
    campaignVersion: 1,
    merchantId: MERCHANT.id,
    resourceOrigin: "https://merchant.example",
    operations: [
      {
        operationId: "risk.score",
        method: "POST",
        pathTemplate: "/v1/risk",
        inputSchema: {
          type: "object",
          properties: {
            wallet: { type: "string" }
          },
          required: ["wallet"]
        }
      },
      {
        operationId: "wallet.labels",
        method: "GET",
        pathTemplate: "/v1/labels"
      }
    ],
    network: "solana:devnet",
    asset: "USDC",
    requiredAmountAtomic: "10000",
    payToWallet: "merchant-pay-to-wallet",
    commissionBps: 2000,
    protocolFeeBpsOfCommission: 1000,
    commissionBase: "required_amount",
    settlementMode: "accrual",
    attributionRequired: true,
    allowSelfReferral: false,
    payoutThresholdAtomic: "100000",
    startsAt: "2026-06-24T00:00:00.000Z",
    endsAt: null
  },
  termsHash: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  signingBytesHex: "00",
  merchantKid: "offer-key",
  merchantSignature: "signature",
  activatedAt: "2026-06-24T00:01:00.000Z",
  createdAt: "2026-06-24T00:00:00.000Z"
};

const ROUTE: RouteRecord = {
  id: "rte_ffffffffffffffffffffffffffffffff",
  currentVersion: 1,
  campaignId: CAMPAIGN_VERSION.campaignId,
  campaignVersionMin: 1,
  referrerWallet: "referrer-wallet",
  payoutWallet: "referrer-payout-wallet",
  resourceOrigin: "https://merchant.example",
  operationIds: ["risk.score"],
  claimHash: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  claim: {
    version: "1",
    routeId: "rte_ffffffffffffffffffffffffffffffff",
    campaignId: CAMPAIGN_VERSION.campaignId,
    campaignVersionMin: 1,
    referrerWallet: "referrer-wallet",
    payoutWallet: "referrer-payout-wallet",
    resourceOrigin: "https://merchant.example",
    operationIds: ["risk.score"],
    issuedAt: "2026-06-24T00:00:00.000Z",
    expiresAt: "2026-06-25T00:00:00.000Z",
    nonce: "route-nonce",
    metadataHash:
      "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    signature: {
      type: "solana-ed25519",
      publicKey: "referrer-wallet",
      value: "signature"
    }
  },
  signingBytesHex: "00",
  status: "active",
  issuedAt: "2026-06-24T00:00:00.000Z",
  expiresAt: "2026-06-25T00:00:00.000Z",
  nonce: "route-nonce",
  metadataHash:
    "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  createdAt: "2026-06-24T00:00:00.000Z",
  activatedAt: "2026-06-24T00:02:00.000Z"
};

const CAMPAIGN_PROFILE: CampaignProfile = {
  id: CAMPAIGN_VERSION.campaignId,
  merchantId: MERCHANT.id,
  resourceOrigin: CAMPAIGN_VERSION.terms.resourceOrigin,
  status: "active",
  currentVersion: 1,
  createdAt: "2026-06-24T00:00:00.000Z",
  updatedAt: "2026-06-24T00:01:00.000Z",
  current: CAMPAIGN_VERSION
};

describe("merchant reliability profile", () => {
  it("summarizes public discovery readiness signals", () => {
    expect(
      createMerchantReliabilityProfile(
        MERCHANT,
        "2026-06-24T00:02:00.000Z",
      ),
    ).toEqual({
      schema: "split402.merchant_reliability_profile.v1",
      generatedAt: "2026-06-24T00:02:00.000Z",
      merchant: {
        id: MERCHANT.id,
        slug: MERCHANT.slug,
        displayName: MERCHANT.displayName,
        status: "active",
      },
      signals: {
        verifiedOrigins: 1,
        activeOfferReceiptKeys: 1,
        activeWebhookKeys: 1,
        activePayoutWallets: 1,
      },
      readiness: {
        acceptsReceipts: true,
        payoutReady: true,
        webhookReady: true,
        discoveryReady: true,
      },
    });
  });

  it("does not count expired or revoked keys as active", () => {
    const profile = createMerchantReliabilityProfile(
      {
        ...MERCHANT,
        keys: MERCHANT.keys.map((key) => ({
          ...key,
          revokedAt: "2026-06-24T00:01:00.000Z",
        })),
      },
      "2026-06-24T00:02:00.000Z",
    );

    expect(profile.signals.activeOfferReceiptKeys).toBe(0);
    expect(profile.readiness.acceptsReceipts).toBe(false);
  });
});

describe("Split402 Bazaar resource projection", () => {
  it("projects a route operation into Bazaar-compatible resource metadata", () => {
    expect(createSplit402BazaarResources(ROUTE, CAMPAIGN_VERSION)).toEqual([
      {
        schema: "split402.bazaar_resource.v1",
        resource: "https://merchant.example/v1/risk",
        type: "http",
        x402Version: 2,
        accepts: [
          {
            scheme: "exact",
            network: "solana:devnet",
            amount: "10000",
            asset: "USDC",
            payTo: "merchant-pay-to-wallet"
          }
        ],
        lastUpdated: "2026-06-24T00:02:00.000Z",
        metadata: {
          description: "Split402 paid POST /v1/risk",
          method: "POST",
          operationId: "risk.score",
          input: {
            schema: CAMPAIGN_VERSION.terms.operations[0]?.inputSchema
          },
          split402: {
            routeId: ROUTE.id,
            campaignId: CAMPAIGN_VERSION.campaignId,
            campaignVersion: 1,
            referrerWallet: "referrer-wallet",
            payoutWallet: "referrer-payout-wallet",
            commissionBps: 2000,
            protocolFeeBpsOfCommission: 1000,
            commissionBase: "required_amount",
            settlementMode: "accrual",
            attributionRequired: true,
            operationIds: ["risk.score"],
            metadataHash:
              "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
          }
        }
      }
    ]);
  });

  it("expands wildcard routes across campaign operations", () => {
    const resources = createSplit402BazaarResources(
      {
        ...ROUTE,
        operationIds: ["*"]
      },
      CAMPAIGN_VERSION
    );

    expect(resources.map((resource) => resource.resource)).toEqual([
      "https://merchant.example/v1/risk",
      "https://merchant.example/v1/labels"
    ]);
  });
});

describe("merchant dashboard summary", () => {
  it("summarizes merchant readiness, campaigns, operations, and routes", () => {
    expect(
      createMerchantDashboardSummary({
        merchant: MERCHANT,
        campaigns: [CAMPAIGN_PROFILE],
        routes: [
          ROUTE,
          {
            ...ROUTE,
            id: "rte_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
            status: "suspended"
          }
        ],
        now: "2026-06-24T00:03:00.000Z"
      })
    ).toEqual({
      schema: "split402.merchant_dashboard_summary.v1",
      generatedAt: "2026-06-24T00:03:00.000Z",
      merchant: {
        id: MERCHANT.id,
        slug: MERCHANT.slug,
        displayName: MERCHANT.displayName,
        status: "active"
      },
      reliability: {
        acceptsReceipts: true,
        payoutReady: true,
        webhookReady: true,
        discoveryReady: true,
        signals: {
          verifiedOrigins: 1,
          activeOfferReceiptKeys: 1,
          activeWebhookKeys: 1,
          activePayoutWallets: 1
        }
      },
      campaigns: {
        total: 1,
        byStatus: {
          draft: 0,
          active: 1,
          paused: 0,
          closed: 0
        },
        activeCampaignIds: [CAMPAIGN_PROFILE.id],
        operationCount: 2
      },
      routes: {
        total: 2,
        byStatus: {
          active: 1,
          suspended: 1,
          expired: 0,
          revoked: 0
        },
        activeRouteIds: [ROUTE.id]
      }
    });
  });
});
