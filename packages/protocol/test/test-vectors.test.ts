import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  createTestVectorBundle,
  verifyReferralClaim,
  verifySplit402Attribution,
  verifySplit402Offer,
  verifySplit402Receipt
} from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "..", "test-vectors", "fixtures");

describe("shared test vectors", () => {
  const bundle = createTestVectorBundle();

  it("are deterministic", () => {
    for (const [filename, expected] of Object.entries({
      "referral-claim-valid.json": bundle.vectors["referral-claim-valid"],
      "referral-claim-invalid-signature.json":
        bundle.vectors["referral-claim-invalid-signature"],
      "offer-valid.json": bundle.vectors["offer-valid"],
      "attribution-valid.json": bundle.vectors["attribution-valid"],
      "receipt-valid.json": bundle.vectors["receipt-valid"],
      "request-digest-cases.json": bundle.requestDigestCases,
      "commission-cases.json": bundle.commissionCases
    })) {
      const actual = readFileSync(join(fixturesDir, filename), "utf8");
      expect(actual).toBe(`${JSON.stringify(expected, null, 2)}\n`);
    }
  });

  it("encode expected validation outcomes", () => {
    const validClaim = readFixture("referral-claim-valid.json").artifact;
    const invalidClaim = readFixture("referral-claim-invalid-signature.json").artifact;
    const offer = readFixture("offer-valid.json").artifact;
    const attribution = readFixture("attribution-valid.json").artifact;
    const receipt = readFixture("receipt-valid.json").artifact;

    expect(verifyReferralClaim(validClaim).ok).toBe(true);
    expect(verifyReferralClaim(invalidClaim).ok).toBe(false);
    expect(verifySplit402Offer(offer, bundle.keys.merchantPublicKey).ok).toBe(true);
    expect(verifySplit402Attribution(attribution, bundle.keys.merchantPublicKey).ok).toBe(true);
    expect(verifySplit402Receipt(receipt, bundle.keys.merchantPublicKey).ok).toBe(true);
  });
});

function readFixture(filename: string): { artifact: unknown } {
  return JSON.parse(readFileSync(join(fixturesDir, filename), "utf8")) as {
    artifact: unknown;
  };
}

