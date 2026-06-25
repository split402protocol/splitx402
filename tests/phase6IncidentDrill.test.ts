import { describe, expect, it } from "vitest";

import {
  assertNoReplacementBytesEvidence,
  assertPauseEvidence,
  assertReconciliationEvidence,
  assertResumeEvidence,
  assertScenario,
  createPhase6IncidentDrillRecord,
} from "../src/phase6IncidentDrill.js";

const VALID_DRILL = {
  drillId: "phase6-incident-001",
  scenario: "rpc_timeout_after_broadcast",
  startedAt: "2026-06-26T20:00:00Z",
  endedAt: "2026-06-26T20:30:00Z",
  incidentCommander: "security-lead",
  controlPlaneOperator: "control-plane-operator",
  signerOperator: "signer-operator",
  chainOperator: "chain-operator",
  reviewer: "protocol-reviewer",
  sourceCommit: "bbbe53c",
  signerImageDigest:
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  signerReference: "kms:split402-devnet-payout",
  network: "solana:devnet",
  fundingWallet: "8jYFQwU6P4L3uYJwqN4uJtVq4n5o7x8p9a1b2c3d4e5f",
  affectedBatchIds: "pbt_incident_drill_001",
  payoutCreationPausedEvidence: "attached: payout creation paused at 20:00Z",
  smokeCheckOutput: "attached: signer-smoke-after-incident.log",
  metricsBefore: "attached: signer-metrics-before.json",
  metricsAfter: "attached: signer-metrics-after.json",
  auditLogSample: "attached: sanitized audit log sample",
  reconciliationReports: "attached: reconciliation reports for affected batches",
  noReplacementBytesEvidence:
    "attached: no replacement signed bytes were created before reconciliation",
  resumeEvidence: "attached: payout creation resumed after reviewer approval",
};

describe("Phase 6 custody incident drill", () => {
  it("creates an incident drill record", () => {
    expect(createPhase6IncidentDrillRecord(VALID_DRILL)).toContain(
      "scenario: rpc_timeout_after_broadcast\n",
    );
  });

  it("requires a known incident scenario", () => {
    expect(() => assertScenario("general_outage")).toThrow(
      "scenario must be one of:",
    );
  });

  it("requires paused payout creation evidence", () => {
    expect(() => assertPauseEvidence("attached: operator note")).toThrow(
      "payoutCreationPausedEvidence must mention paused payouts",
    );
  });

  it("requires reconciliation evidence", () => {
    expect(() => assertReconciliationEvidence("attached: batch list")).toThrow(
      "reconciliationReports must mention reconciliation",
    );
  });

  it("requires no replacement-byte evidence", () => {
    expect(() =>
      assertNoReplacementBytesEvidence("attached: retry transaction built"),
    ).toThrow(
      "noReplacementBytesEvidence must mention no replacement or no new signed bytes",
    );
  });

  it("requires resumed payout creation evidence", () => {
    expect(() => assertResumeEvidence("attached: reviewer approval")).toThrow(
      "resumeEvidence must mention resumed payout creation",
    );
  });

  it("rejects mutable signer image digests", () => {
    expect(() =>
      createPhase6IncidentDrillRecord({
        ...VALID_DRILL,
        signerImageDigest: "latest",
      }),
    ).toThrow("signerImageDigest must be an immutable sha256 digest");
  });
});
