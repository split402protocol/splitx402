import { describe, expect, it } from "vitest";

import {
  ReferralClaimV1Schema,
  Split402AttributionV1Schema,
  Split402OfferV1Schema,
  Split402ReceiptV1Schema,
  createTestVectorBundle,
  verifyReferralClaim,
  verifySplit402Attribution,
  verifySplit402Offer,
  verifySplit402Receipt
} from "../src/index.js";

describe("protocol artifacts", () => {
  const bundle = createTestVectorBundle();

  it("validates all generated sample artifacts with strict schemas", () => {
    expect(ReferralClaimV1Schema.parse(bundle.artifacts.referralClaim)).toEqual(
      bundle.artifacts.referralClaim
    );
    expect(Split402OfferV1Schema.parse(bundle.artifacts.offer)).toEqual(
      bundle.artifacts.offer
    );
    expect(Split402AttributionV1Schema.parse(bundle.artifacts.attribution)).toEqual(
      bundle.artifacts.attribution
    );
    expect(Split402ReceiptV1Schema.parse(bundle.artifacts.receipt)).toEqual(
      bundle.artifacts.receipt
    );
  });

  it("rejects unknown fields", () => {
    expect(() =>
      ReferralClaimV1Schema.parse({
        ...bundle.artifacts.referralClaim,
        unexpected: true
      })
    ).toThrow();
  });

  it("verifies claim, offer, attribution, and receipt offline", () => {
    expect(verifyReferralClaim(bundle.artifacts.referralClaim)).toEqual({
      ok: true,
      errors: []
    });
    expect(verifySplit402Offer(bundle.artifacts.offer, bundle.keys.merchantPublicKey)).toEqual({
      ok: true,
      errors: []
    });
    expect(
      verifySplit402Attribution(bundle.artifacts.attribution, bundle.keys.merchantPublicKey)
    ).toEqual({
      ok: true,
      errors: []
    });
    expect(
      verifySplit402Receipt(bundle.artifacts.receipt, bundle.keys.merchantPublicKey)
    ).toEqual({
      ok: true,
      errors: []
    });
  });

  it("fails verification after a signed field mutation", () => {
    const mutatedClaim = structuredClone(bundle.artifacts.referralClaim);
    mutatedClaim.payoutWallet = bundle.keys.payerWallet;

    expect(verifyReferralClaim(mutatedClaim).ok).toBe(false);
  });

  it("checks receipt arithmetic independently of signed values", () => {
    const mutatedReceipt = structuredClone(bundle.artifacts.receipt);
    mutatedReceipt.commissionAmountAtomic = "1999";

    const result = verifySplit402Receipt(mutatedReceipt, bundle.keys.merchantPublicKey);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("invalid receipt signature");
    expect(result.errors).toContain("commissionAmountAtomic does not match commissionBps");
  });

  it("rejects receipts with incorrect protocol fee or referrer credit", () => {
    const wrongProtocolFee = structuredClone(bundle.artifacts.receipt);
    wrongProtocolFee.protocolFeeAtomic = "0";
    const wrongProtocolFeeResult = verifySplit402Receipt(
      wrongProtocolFee,
      bundle.keys.merchantPublicKey
    );

    expect(wrongProtocolFeeResult.ok).toBe(false);
    expect(wrongProtocolFeeResult.errors).toContain(
      "protocolFeeAtomic does not match protocol fee policy"
    );

    const wrongReferrerCredit = structuredClone(bundle.artifacts.receipt);
    wrongReferrerCredit.referrerCreditAtomic = "2000";
    const wrongReferrerCreditResult = verifySplit402Receipt(
      wrongReferrerCredit,
      bundle.keys.merchantPublicKey
    );

    expect(wrongReferrerCreditResult.ok).toBe(false);
    expect(wrongReferrerCreditResult.errors).toContain(
      "referrerCreditAtomic does not match commission minus protocol fee"
    );
  });
});
