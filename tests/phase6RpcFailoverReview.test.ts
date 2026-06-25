import { describe, expect, it } from "vitest";

import {
  assertFinalityRpcUrl,
  assertPassed,
  assertRequestedRpcUrls,
  createPhase6RpcFailoverReviewRecord,
} from "../src/phase6RpcFailoverReview.js";

const VALID_REVIEW = {
  reviewId: "phase6-rpc-failover-001",
  reviewDate: "2026-06-26",
  owners: "security, operations",
  stagingEnvironment: "split402-staging",
  drillReportSchema: "split402.payout_finality_failover_drill.v1",
  drillPassed: "true",
  primaryRpcUrl: "https://primary-unavailable.example",
  secondaryRpcUrl: "https://secondary-healthy.example",
  requestedRpcUrls:
    "https://primary-unavailable.example,https://secondary-healthy.example",
  finalityStatus: "confirmed",
  finalityRpcUrl: "https://secondary-healthy.example",
  primaryRpcUnavailableEvidence: "attached: primary-rpc-503.log",
  secondaryRpcStatusEvidence: "attached: secondary-rpc-confirmed.json",
};

describe("Phase 6 RPC failover review", () => {
  it("creates an RPC failover review record", () => {
    expect(createPhase6RpcFailoverReviewRecord(VALID_REVIEW)).toContain(
      "drill_passed: true\n",
    );
  });

  it("requires the drill to pass", () => {
    expect(() => assertPassed("false")).toThrow("drillPassed must be true");
  });

  it("requires finality to be observed from the secondary RPC", () => {
    expect(() =>
      assertFinalityRpcUrl(
        "https://primary-unavailable.example",
        VALID_REVIEW.secondaryRpcUrl,
      ),
    ).toThrow("finalityRpcUrl must match secondaryRpcUrl");
  });

  it("requires the primary RPC to be attempted before the secondary RPC", () => {
    expect(() =>
      assertRequestedRpcUrls(
        "https://secondary-healthy.example,https://primary-unavailable.example",
        VALID_REVIEW.primaryRpcUrl,
        VALID_REVIEW.secondaryRpcUrl,
      ),
    ).toThrow(
      "requestedRpcUrls must list primaryRpcUrl followed by secondaryRpcUrl",
    );
  });

  it("rejects matching primary and secondary RPC URLs", () => {
    expect(() =>
      createPhase6RpcFailoverReviewRecord({
        ...VALID_REVIEW,
        secondaryRpcUrl: VALID_REVIEW.primaryRpcUrl,
      }),
    ).toThrow("secondaryRpcUrl must differ from primaryRpcUrl");
  });
});
