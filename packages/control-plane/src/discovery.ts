import type { CampaignOperation, CampaignVersionRecord } from "./campaigns.js";
import type { CampaignProfile, CampaignStatus } from "./campaigns.js";
import type { MerchantKeyRecord, MerchantProfile } from "./merchants.js";
import type { RouteOperationScope, RouteRecord, RouteStatus } from "./routes.js";

export interface MerchantReliabilityProfile {
  schema: "split402.merchant_reliability_profile.v1";
  generatedAt: string;
  merchant: {
    id: string;
    slug: string;
    displayName: string;
    status: MerchantProfile["status"];
  };
  signals: {
    verifiedOrigins: number;
    activeOfferReceiptKeys: number;
    activeWebhookKeys: number;
    activePayoutWallets: number;
  };
  readiness: {
    acceptsReceipts: boolean;
    payoutReady: boolean;
    webhookReady: boolean;
    discoveryReady: boolean;
  };
}

export interface Split402BazaarResource {
  schema: "split402.bazaar_resource.v1";
  resource: string;
  type: "http";
  x402Version: 2;
  accepts: [
    {
      scheme: "exact";
      network: string;
      amount: string;
      asset: string;
      payTo: string;
    },
  ];
  lastUpdated: string;
  metadata: {
    description: string;
    method: string;
    operationId: string;
    input?: {
      schema: unknown;
    };
    split402: {
      routeId: string;
      campaignId: string;
      campaignVersion: number;
      referrerWallet: string;
      payoutWallet: string;
      commissionBps: number;
      protocolFeeBpsOfCommission: number;
      commissionBase: string;
      settlementMode: string;
      attributionRequired: boolean;
      operationIds: RouteOperationScope;
      metadataHash?: `sha256:${string}`;
    };
  };
}

export interface MerchantDashboardSummary {
  schema: "split402.merchant_dashboard_summary.v1";
  generatedAt: string;
  merchant: MerchantReliabilityProfile["merchant"];
  reliability: MerchantReliabilityProfile["readiness"] & {
    signals: MerchantReliabilityProfile["signals"];
  };
  campaigns: {
    total: number;
    byStatus: Record<CampaignStatus, number>;
    activeCampaignIds: string[];
    operationCount: number;
  };
  routes: {
    total: number;
    byStatus: Record<RouteStatus, number>;
    activeRouteIds: string[];
  };
}

export function createMerchantReliabilityProfile(
  merchant: MerchantProfile,
  now = new Date().toISOString(),
): MerchantReliabilityProfile {
  const activeOfferReceiptKeys = merchant.keys.filter((key) =>
    isActiveMerchantKey(key, "offer_receipt", now),
  ).length;
  const activeWebhookKeys = merchant.keys.filter((key) =>
    isActiveMerchantKey(key, "webhook", now),
  ).length;
  const verifiedOrigins = merchant.origins.filter(
    (origin) => origin.status === "verified",
  ).length;
  const activePayoutWallets = merchant.payoutWallets.filter(
    (wallet) => wallet.status === "active",
  ).length;
  const acceptsReceipts =
    merchant.status === "active" &&
    verifiedOrigins > 0 &&
    activeOfferReceiptKeys > 0;
  const payoutReady = activePayoutWallets > 0;
  const webhookReady = activeWebhookKeys > 0;

  return {
    schema: "split402.merchant_reliability_profile.v1",
    generatedAt: now,
    merchant: {
      id: merchant.id,
      slug: merchant.slug,
      displayName: merchant.displayName,
      status: merchant.status,
    },
    signals: {
      verifiedOrigins,
      activeOfferReceiptKeys,
      activeWebhookKeys,
      activePayoutWallets,
    },
    readiness: {
      acceptsReceipts,
      payoutReady,
      webhookReady,
      discoveryReady: acceptsReceipts && payoutReady,
    },
  };
}

export function createMerchantDashboardSummary(input: {
  merchant: MerchantProfile;
  campaigns: readonly CampaignProfile[];
  routes: readonly RouteRecord[];
  now?: string;
}): MerchantDashboardSummary {
  const generatedAt = input.now ?? new Date().toISOString();
  const profile = createMerchantReliabilityProfile(input.merchant, generatedAt);
  const campaignCounts = createCampaignStatusCounts();
  const routeCounts = createRouteStatusCounts();
  let operationCount = 0;
  for (const campaign of input.campaigns) {
    campaignCounts[campaign.status] += 1;
    operationCount += campaign.current.terms.operations.length;
  }
  for (const route of input.routes) {
    routeCounts[route.status] += 1;
  }

  return {
    schema: "split402.merchant_dashboard_summary.v1",
    generatedAt,
    merchant: profile.merchant,
    reliability: {
      ...profile.readiness,
      signals: profile.signals,
    },
    campaigns: {
      total: input.campaigns.length,
      byStatus: campaignCounts,
      activeCampaignIds: input.campaigns
        .filter((campaign) => campaign.status === "active")
        .map((campaign) => campaign.id),
      operationCount,
    },
    routes: {
      total: input.routes.length,
      byStatus: routeCounts,
      activeRouteIds: input.routes
        .filter((route) => route.status === "active")
        .map((route) => route.id),
    },
  };
}

export function createSplit402BazaarResources(
  route: RouteRecord,
  campaignVersion: CampaignVersionRecord,
): Split402BazaarResource[] {
  const terms = campaignVersion.terms;
  return selectRouteOperations(route.operationIds, terms.operations).map(
    (operation) => {
      const metadata: Split402BazaarResource["metadata"] = {
        description: `Split402 paid ${operation.method} ${operation.pathTemplate}`,
        method: operation.method,
        operationId: operation.operationId,
        ...(operation.inputSchema === undefined
          ? {}
          : { input: { schema: operation.inputSchema } }),
        split402: {
          routeId: route.id,
          campaignId: terms.campaignId,
          campaignVersion: campaignVersion.version,
          referrerWallet: route.referrerWallet,
          payoutWallet: route.payoutWallet,
          commissionBps: terms.commissionBps,
          protocolFeeBpsOfCommission: terms.protocolFeeBpsOfCommission,
          commissionBase: terms.commissionBase,
          settlementMode: terms.settlementMode,
          attributionRequired: terms.attributionRequired,
          operationIds: [...route.operationIds] as RouteOperationScope,
          ...(route.metadataHash === undefined
            ? {}
            : { metadataHash: route.metadataHash }),
        },
      };

      return {
        schema: "split402.bazaar_resource.v1",
        resource: new URL(operation.pathTemplate, terms.resourceOrigin).toString(),
        type: "http",
        x402Version: 2,
        accepts: [
          {
            scheme: "exact",
            network: terms.network,
            amount: terms.requiredAmountAtomic,
            asset: terms.asset,
            payTo: terms.payToWallet,
          },
        ],
        lastUpdated: route.activatedAt,
        metadata,
      };
    },
  );
}

function isActiveMerchantKey(
  key: MerchantKeyRecord,
  purpose: MerchantKeyRecord["purpose"],
  now: string,
): boolean {
  if (key.purpose !== purpose || key.revokedAt !== undefined) {
    return false;
  }
  const nowMs = Date.parse(now);
  if (Date.parse(key.validFrom) > nowMs) {
    return false;
  }
  return key.validUntil === undefined || Date.parse(key.validUntil) > nowMs;
}

function selectRouteOperations(
  scope: RouteOperationScope,
  operations: CampaignOperation[],
): CampaignOperation[] {
  if (scope.length === 1 && scope[0] === "*") {
    return operations;
  }
  const operationIds = new Set(scope);
  return operations.filter((operation) => operationIds.has(operation.operationId));
}

function createCampaignStatusCounts(): Record<CampaignStatus, number> {
  return {
    draft: 0,
    active: 0,
    paused: 0,
    closed: 0,
  };
}

function createRouteStatusCounts(): Record<RouteStatus, number> {
  return {
    active: 0,
    suspended: 0,
    expired: 0,
    revoked: 0,
  };
}
