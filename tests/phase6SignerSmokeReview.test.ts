import { describe, expect, it } from "vitest";

import {
  assertNoExposureEvidence,
  assertNonNegativeInteger,
  assertSmokeService,
  assertSmokeStatus,
  assertSolanaNetwork,
  createPhase6SignerSmokeReviewRecord,
} from "../src/phase6SignerSmokeReview.js";

const VALID_REVIEW = {
  reviewId: "phase6-signer-smoke-001",
  reviewDate: "2026-06-26",
  reviewers: "security, operations",
  stagingEnvironment: "split402-staging",
  smokeStatus: "ok",
  smokeService: "split402-payout-signer",
  signerReference: "kms:split402-devnet-payout",
  network: "solana:devnet",
  requestsTotal: "3",
  signedTotal: "1",
  rejectedTotal: "2",
  healthReadyMetricsEvidence: "attached: signer-smoke-output.json",
  endpointSecretExposureEvidence:
    "attached: endpoint scan showed no secrets and no transaction bytes",
  auditLogSecretExposureEvidence:
    "attached: sanitized audit sample has no private key and no shared secret",
};

describe("Phase 6 signer smoke review", () => {
  it("creates a signer smoke review record", () => {
    expect(createPhase6SignerSmokeReviewRecord(VALID_REVIEW)).toContain(
      "smoke_service: split402-payout-signer\n",
    );
  });

  it("requires an ok smoke status", () => {
    expect(() => assertSmokeStatus("failed")).toThrow("smokeStatus must be ok");
  });

  it("requires the payout signer service name", () => {
    expect(() => assertSmokeService("api")).toThrow(
      "smokeService must be split402-payout-signer",
    );
  });

  it("requires a Solana network", () => {
    expect(() => assertSolanaNetwork("eip155:8453")).toThrow(
      "network must start with solana:",
    );
  });

  it("requires non-negative metric counters", () => {
    expect(() => assertNonNegativeInteger("-1", "requestsTotal")).toThrow(
      "requestsTotal must be a non-negative integer",
    );
    expect(() => assertNonNegativeInteger("1.5", "requestsTotal")).toThrow(
      "requestsTotal must be a non-negative integer",
    );
  });

  it("requires endpoint and audit no-exposure evidence", () => {
    expect(() =>
      assertNoExposureEvidence("attached: smoke output", "endpointEvidence"),
    ).toThrow(
      "endpointEvidence must mention no secret, no private key, or no transaction bytes",
    );
  });
});
