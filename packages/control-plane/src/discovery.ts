import type { MerchantKeyRecord, MerchantProfile } from "./merchants.js";

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
