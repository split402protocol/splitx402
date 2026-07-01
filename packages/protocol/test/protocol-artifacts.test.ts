import { describe, expect, it } from "vitest";

import {
  buildOfferSigningBytes,
  buildReceiptSigningBytes,
  ReferralClaimV1Schema,
  Split402AttributionV1Schema,
  Split402OfferV1Schema,
  Split402ReceiptV1Schema,
  createTestVectorBundle,
  hexToBytes,
  signEd25519Message,
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

  it("accepts EVM payment identifiers in signed offers and receipts", () => {
    const merchantSeed = hexToBytes(
      "101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f"
    );
    const unsignedOffer = {
      ...bundle.artifacts.offer,
      network: "eip155:8453",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      payToWallet: "0x68614873C5d624c07DCAA3aFF5243DD5027c3910"
    };
    const offerSignature = signEd25519Message(
      buildOfferSigningBytes(unsignedOffer),
      merchantSeed
    );
    const evmOffer = {
      ...unsignedOffer,
      signature: offerSignature.signature
    };

    expect(Split402OfferV1Schema.parse(evmOffer)).toEqual(evmOffer);
    expect(verifySplit402Offer(evmOffer, offerSignature.publicKey)).toEqual({
      ok: true,
      errors: []
    });

    const unsignedReceipt = {
      ...bundle.artifacts.receipt,
      network: "eip155:8453",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      payerWallet: "0x0000000000000000000000000000000000000001",
      payToWallet: "0x68614873C5d624c07DCAA3aFF5243DD5027c3910",
      settlementTxSignature:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    };
    const receiptSignature = signEd25519Message(
      buildReceiptSigningBytes(unsignedReceipt),
      merchantSeed
    );
    const evmReceipt = {
      ...unsignedReceipt,
      signature: receiptSignature.signature
    };

    expect(Split402ReceiptV1Schema.parse(evmReceipt)).toEqual(evmReceipt);
    expect(verifySplit402Receipt(evmReceipt, receiptSignature.publicKey)).toEqual({
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
