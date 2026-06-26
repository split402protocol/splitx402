import { describe, expect, it } from "vitest";

import {
  base58Decode,
  base58Encode,
  calculateCommission,
  calculateOperationDigest,
  canonicalizeProtocolObject,
  createPrefixedId,
  evaluateSelfReferralPolicy,
  hashProtocolObject,
  parseAtomicAmount,
  serializeAtomicAmount
} from "../src/index.js";

describe("protocol primitives", () => {
  it("canonicalizes objects deterministically", () => {
    const left = canonicalizeProtocolObject({ b: 2, a: { y: true, x: null } });
    const right = canonicalizeProtocolObject({ a: { x: null, y: true }, b: 2 });

    expect(left).toBe('{"a":{"x":null,"y":true},"b":2}');
    expect(left).toBe(right);
    expect(hashProtocolObject({ b: 2, a: 1 })).toBe(hashProtocolObject({ a: 1, b: 2 }));
  });

  it("round-trips base58 bytes", () => {
    const bytes = Uint8Array.from([0, 0, 1, 2, 3, 255]);
    expect(base58Decode(base58Encode(bytes))).toEqual(bytes);
  });

  it("parses and serializes atomic amounts without floating point", () => {
    expect(parseAtomicAmount("10000")).toBe(10000n);
    expect(serializeAtomicAmount(10000n)).toBe("10000");
    expect(() => parseAtomicAmount("1.5")).toThrow("atomic amount");
    expect(() => parseAtomicAmount("01")).toThrow("atomic amount");
  });

  it("calculates commissions with floor rounding", () => {
    expect(calculateCommission(10000n, 2000n)).toEqual({
      commission: 2000n,
      protocolFee: 0n,
      referrerCredit: 2000n
    });
    expect(calculateCommission(10000n, 2000n, 1000n)).toEqual({
      commission: 2000n,
      protocolFee: 200n,
      referrerCredit: 1800n
    });
    expect(calculateCommission(3n, 3333n)).toEqual({
      commission: 0n,
      protocolFee: 0n,
      referrerCredit: 0n
    });
  });

  it("evaluates self-referral policy by payer and merchant identity", () => {
    expect(
      evaluateSelfReferralPolicy({
        allowSelfReferral: false,
        payerWallet: "payer",
        referrerWallet: "referrer",
        payoutWallet: "referrer"
      })
    ).toEqual({ allowed: true });
    expect(
      evaluateSelfReferralPolicy({
        allowSelfReferral: false,
        payerWallet: "referrer",
        referrerWallet: "referrer",
        payoutWallet: "payout"
      })
    ).toEqual({ allowed: false, reason: "payer_is_referrer" });
    expect(
      evaluateSelfReferralPolicy({
        allowSelfReferral: false,
        payerWallet: "payout",
        referrerWallet: "referrer",
        payoutWallet: "payout"
      })
    ).toEqual({ allowed: false, reason: "payer_is_payout_wallet" });
    expect(
      evaluateSelfReferralPolicy({
        allowSelfReferral: false,
        payerWallet: "payer",
        referrerWallet: "owner",
        payoutWallet: "payout",
        merchantOwnerWallet: "owner"
      })
    ).toEqual({ allowed: false, reason: "merchant_owner_is_referrer" });
    expect(
      evaluateSelfReferralPolicy({
        allowSelfReferral: true,
        payerWallet: "referrer",
        referrerWallet: "referrer",
        payoutWallet: "payout"
      })
    ).toEqual({ allowed: true });
  });

  it("creates IDs with at least 128 bits of entropy", () => {
    expect(createPrefixedId("cmp")).toMatch(/^cmp_[0-9a-f]{32}$/u);
    expect(() => createPrefixedId("cmp", 15)).toThrow("128 bits");
  });

  it("binds operation digests to normalized operation input", () => {
    const digest = calculateOperationDigest({
      merchantId: "mrc_00000000000000000000000000000001",
      operationId: "wallet-risk-score",
      method: "post",
      pathTemplate: "/v1/risk/:wallet",
      pathParams: { wallet: "Wallet111111111111111111111111111111111" },
      query: {},
      body: { includeLabels: true },
      paymentId: "pay_00000000000000000000000000000004",
      offerNonce: "ofn_00000000000000000000000000000006"
    });

    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });
});
