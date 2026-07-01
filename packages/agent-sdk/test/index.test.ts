import {
  deriveEd25519PublicKey,
  hexToBytes,
  createSampleProtocolArtifacts,
  verifyReferralClaimObject,
  verifySplit402Receipt
} from "@split402/protocol";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  Split402AgentClient,
  corruptReferralClaimSignature,
  createReferralClaim,
  extractReceipt
} from "../src/index.js";

const REFERRER_SEED = hexToBytes(
  "202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f"
);
const PAYOUT_SEED = hexToBytes(
  "404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f"
);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Split402 agent SDK", () => {
  it("creates a verifiable referral claim", () => {
    const claim = createReferralClaim({
      privateSeed: REFERRER_SEED,
      routeId: "rte_00000000000000000000000000000003",
      campaignId: "cmp_00000000000000000000000000000002",
      campaignVersionMin: 1,
      payoutWallet: deriveEd25519PublicKey(PAYOUT_SEED),
      resourceOrigin: "http://localhost:4021",
      operationIds: ["wallet-risk-score"],
      issuedAt: "2026-06-24T00:00:00Z",
      expiresAt: "2099-06-24T00:00:00Z",
      nonce: "claim-nonce-000001",
      metadata: { label: "sdk test" }
    });

    expect(claim.referrerWallet).toBe(deriveEd25519PublicKey(REFERRER_SEED));
    expect(verifyReferralClaimObject(claim)).toEqual({ ok: true, errors: [] });
  });

  it("can intentionally corrupt a referral claim for invalid-claim demos", () => {
    const claim = createReferralClaim({
      privateSeed: REFERRER_SEED,
      routeId: "rte_00000000000000000000000000000003",
      campaignId: "cmp_00000000000000000000000000000002",
      campaignVersionMin: 1,
      payoutWallet: deriveEd25519PublicKey(PAYOUT_SEED),
      resourceOrigin: "http://localhost:4021",
      operationIds: ["wallet-risk-score"],
      expiresAt: "2099-06-24T00:00:00Z"
    });

    expect(verifyReferralClaimObject(corruptReferralClaimSignature(claim)).ok).toBe(
      false
    );
  });

  it("extracts a Split402 receipt from an x402 settlement extension", () => {
    const bundle = createSampleProtocolArtifacts();
    const receipt = bundle.artifacts.receipt;
    const extracted = extractReceipt({
      extensions: {
        split402: {
          receipt
        }
      }
    });

    expect(extracted).toEqual(receipt);
    expect(verifySplit402Receipt(extracted, bundle.keys.merchantPublicKey)).toEqual({
      ok: true,
      errors: []
    });
  });

  it("inspects and verifies a merchant Split402 offer from an unpaid response", async () => {
    const bundle = createSampleProtocolArtifacts();
    const offer = bundle.artifacts.offer;
    const paymentRequired: PaymentRequired = {
      x402Version: 2,
      error: "Payment required",
      resource: {
        url: "http://localhost:4021/v1/risk",
        description: "Demo wallet risk score",
        mimeType: "application/json"
      },
      accepts: [
        {
          scheme: "exact",
          network: offer.network as `${string}:${string}`,
          asset: offer.asset,
          amount: offer.requiredAmountAtomic,
          payTo: offer.payToWallet,
          maxTimeoutSeconds: 300,
          extra: {}
        }
      ],
      extensions: {
        split402: {
          info: offer
        }
      }
    };
    const fetchMock = vi.fn(async () => {
      return new Response("", {
        status: 402,
        headers: {
          "payment-required": encodePaymentRequiredHeader(paymentRequired)
        }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new Split402AgentClient({
      merchantOrigin: "http://localhost:4021",
      merchantPublicKey: bundle.keys.merchantPublicKey
    });
    const result = await client.inspectOffer({
      path: "/v1/risk",
      body: { wallet: "Wallet111" }
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4021/v1/risk",
      expect.objectContaining({
        method: "POST"
      })
    );
    expect(result.status).toBe(402);
    expect(result.offer).toEqual(offer);
    expect(result.verification).toEqual({ checked: true, ok: true, errors: [] });
  });

  it("inspects GET offers with query parameters", async () => {
    const bundle = createSampleProtocolArtifacts();
    const offer = bundle.artifacts.offer;
    const paymentRequired: PaymentRequired = {
      x402Version: 2,
      error: "Payment required",
      resource: {
        url: "http://localhost:4021/price/btc?format=json",
        description: "BTC price",
        mimeType: "application/json"
      },
      accepts: [
        {
          scheme: "exact",
          network: offer.network as `${string}:${string}`,
          asset: offer.asset,
          amount: offer.requiredAmountAtomic,
          payTo: offer.payToWallet,
          maxTimeoutSeconds: 300,
          extra: {}
        }
      ],
      extensions: {
        split402: {
          info: offer
        }
      }
    };
    const fetchMock = vi.fn(async () => {
      return new Response("", {
        status: 402,
        headers: {
          "payment-required": encodePaymentRequiredHeader(paymentRequired)
        }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new Split402AgentClient({
      merchantOrigin: "http://localhost:4021",
      merchantPublicKey: bundle.keys.merchantPublicKey
    });
    const result = await client.inspectOffer({
      path: "/price/btc",
      method: "GET",
      query: { format: "json" }
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4021/price/btc?format=json",
      expect.objectContaining({
        method: "GET"
      })
    );
    expect(result.status).toBe(402);
    expect(result.offer).toEqual(offer);
    expect(result.verification).toEqual({ checked: true, ok: true, errors: [] });
  });
});
