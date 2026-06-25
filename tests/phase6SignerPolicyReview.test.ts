import { describe, expect, it } from "vitest";

import {
  assertPositiveAtomicAmount,
  assertSolanaNetwork,
  createPhase6SignerPolicyReviewRecord,
} from "../src/phase6SignerPolicyReview.js";

const VALID_REVIEW = {
  reviewId: "phase6-signer-policy-001",
  reviewDate: "2026-06-25",
  reviewers: "security, operations",
  network: "solana:devnet",
  fundingWallet: "funding-wallet",
  sourceTokenAccount: "source-token-account",
  mint: "usdc-mint",
  allowedTokenProgramIds: ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"],
  maxTransactionAmountAtomic: "100000000",
  maxBatchAmountAtomic: "500000000",
  expectedDestinationAmountListHash: "sha256:destination-amount-list",
  requireSuccessfulSimulation: true,
  signerReference: "kms:split402-devnet-payout",
};

describe("Phase 6 signer policy review", () => {
  it("creates a signer policy review record", () => {
    expect(createPhase6SignerPolicyReviewRecord(VALID_REVIEW)).toContain(
      "require_successful_simulation: true\n",
    );
  });

  it("rejects non-Solana networks", () => {
    expect(() => assertSolanaNetwork("eip155:8453")).toThrow(
      "network must start with solana:",
    );
  });

  it("rejects non-positive or decimal atomic amounts", () => {
    expect(() =>
      assertPositiveAtomicAmount("0", "maxTransactionAmountAtomic"),
    ).toThrow("maxTransactionAmountAtomic must be a positive atomic amount");
    expect(() =>
      assertPositiveAtomicAmount("1.5", "maxTransactionAmountAtomic"),
    ).toThrow("maxTransactionAmountAtomic must be a positive atomic amount");
  });

  it("requires a token program allow-list and successful simulation", () => {
    expect(() =>
      createPhase6SignerPolicyReviewRecord({
        ...VALID_REVIEW,
        allowedTokenProgramIds: [""],
      }),
    ).toThrow("allowedTokenProgramIds must include at least one token program");

    expect(() =>
      createPhase6SignerPolicyReviewRecord({
        ...VALID_REVIEW,
        requireSuccessfulSimulation: false,
      }),
    ).toThrow("requireSuccessfulSimulation must be true");
  });
});
