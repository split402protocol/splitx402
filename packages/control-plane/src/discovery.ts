import type { CampaignOperation, CampaignVersionRecord } from "./campaigns.js";
import type { MerchantKeyRecord, MerchantProfile } from "./merchants.js";
import type { RouteOperationScope, RouteRecord } from "./routes.js";

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
      commissionBase: string;
      settlementMode: string;
      attributionRequired: boolean;
      operationIds: RouteOperationScope;
      metadataHash?: `sha256:${string}`;
    };
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
