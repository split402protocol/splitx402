import { describe, expect, it } from "vitest";

import {
  assertNoReplacementBytesEvidence,
  assertOutcomeUnknownEvidence,
  assertReconcileEndpointEvidence,
  assertReconciliationListEvidence,
  assertRecommendedAction,
  createPhase6ReconciliationDrillRecord,
} from "../src/phase6ReconciliationDrill.js";

const VALID_DRILL = {
  drillId: "phase6-reconciliation-001",
  drillDate: "2026-06-26",
  owners: "operations, protocol",
  stagingEnvironment: "split402-staging",
  merchantId: "mrc_001",
  payoutBatchId: "pbt_001",
  expectedSignature: "5mR8Y6n3HfpLxq4NnEwD8phE8Ryj2N92dR6zM8GvG8eW",
  outcomeUnknownEvidence: "attached: batch status outcome_unknown before reconcile",
  reconciliationListEvidence:
    "attached: GET /v1/merchants/mrc_001/payouts/reconciliation returned pbt_001",
  reconcileEndpointEvidence:
    "attached: POST /v1/payout-batches/pbt_001/reconcile returned report",
  recommendedAction: "requery_chain_before_retry",
  persistedStatusAfterReconcile: "outcome_unknown",
  noReplacementBytesEvidence:
    "attached: no replacement signed bytes created before reconciliation",
};

describe("Phase 6 unknown-outcome reconciliation drill", () => {
  it("creates a reconciliation drill record", () => {
    expect(createPhase6ReconciliationDrillRecord(VALID_DRILL)).toContain(
      "recommended_action: requery_chain_before_retry\n",
    );
  });

  it("requires outcome_unknown evidence", () => {
    expect(() => assertOutcomeUnknownEvidence("attached: pending")).toThrow(
      "outcomeUnknownEvidence must mention outcome_unknown",
    );
  });

  it("requires the reconciliation list endpoint evidence", () => {
    expect(() => assertReconciliationListEvidence("attached: batch list")).toThrow(
      "reconciliationListEvidence must mention GET /v1/merchants/:merchantId/payouts/reconciliation",
    );
  });

  it("requires the reconcile endpoint evidence", () => {
    expect(() => assertReconcileEndpointEvidence("attached: post result")).toThrow(
      "reconcileEndpointEvidence must mention POST /v1/payout-batches/:batchId/reconcile",
    );
  });

  it("requires a known recommended action", () => {
    expect(() => assertRecommendedAction("retry_now")).toThrow(
      "recommendedAction must be one of:",
    );
  });

  it("requires no replacement-byte evidence", () => {
    expect(() =>
      assertNoReplacementBytesEvidence("attached: new transaction was built"),
    ).toThrow(
      "noReplacementBytesEvidence must mention no replacement or no new signed bytes",
    );
  });
});
