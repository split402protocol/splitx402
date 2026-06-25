import { describe, expect, it } from "vitest";

import {
  createMerchantReliabilityProfile,
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
