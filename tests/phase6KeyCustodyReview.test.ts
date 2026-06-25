import { describe, expect, it } from "vitest";

import {
  assertSolanaNetwork,
  createPhase6KeyCustodyReviewRecord,
} from "../src/phase6KeyCustodyReview.js";

const VALID_REVIEW = {
  reviewId: "phase6-key-custody-001",
  reviewDate: "2026-06-25",
  reviewers: "security, operations",
  network: "solana:devnet",
  fundingWallet: "funding-wallet",
  sourceTokenAccount: "source-token-account",
  keySource: "kms:split402-devnet-payout",
  keyOwner: "operations",
  keyBackupPolicy: "attached: backup-policy-001.md",
  keyRecoveryProcess: "attached: recovery-process-001.md",
  accessList: ["security-lead", "operations-lead"],
  accessReviewRecord: "attached: access-review-001.md",
  separationOfDutiesRecord: "attached: separation-of-duties-001.md",
  lastRotationOrGenerationTime: "2026-06-25T20:00:00Z",
};

describe("Phase 6 key custody review", () => {
  it("creates a key custody review record", () => {
    expect(createPhase6KeyCustodyReviewRecord(VALID_REVIEW)).toContain(
      "access_list: security-lead,operations-lead\n",
    );
  });

  it("defaults mainnet custody to disabled", () => {
    expect(createPhase6KeyCustodyReviewRecord(VALID_REVIEW)).toContain(
      "mainnet_enabled: false\n",
    );
  });

  it("rejects non-Solana networks", () => {
    expect(() => assertSolanaNetwork("eip155:8453")).toThrow(
      "network must start with solana:",
    );
  });

  it("requires custody controls and access list evidence", () => {
    expect(() =>
      createPhase6KeyCustodyReviewRecord({
        ...VALID_REVIEW,
        keyBackupPolicy: "",
      }),
    ).toThrow("keyBackupPolicy is required");

    expect(() =>
      createPhase6KeyCustodyReviewRecord({
        ...VALID_REVIEW,
        accessList: [""],
      }),
    ).toThrow("accessList must include at least one authorized operator");
  });
});
