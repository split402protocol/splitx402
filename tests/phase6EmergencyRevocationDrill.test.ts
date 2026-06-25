import { describe, expect, it } from "vitest";

import {
  assertNewKeySuccessEvidence,
  assertOldKeyRejectionEvidence,
  createPhase6EmergencyRevocationDrillRecord,
} from "../src/phase6EmergencyRevocationDrill.js";

const VALID_DRILL = {
  drillId: "phase6-emergency-revocation-001",
  drillDate: "2026-06-25",
  owners: "security, operations",
  stagingEnvironment: "split402-staging",
  retiredKeyId: "control-plane-compromised",
  replacementKeyId: "control-plane-current",
  revocationStartTime: "2026-06-25T20:00:00Z",
  signerDeployTime: "2026-06-25T20:05:00Z",
  controlPlaneRotationTime: "2026-06-25T20:10:00Z",
  oldKeyRejectionEvidence: "attached: old-key-request returned 401",
  newKeySuccessEvidence: "attached: new-key request signed successfully",
  metricsEvidence: "attached: rejectedByCode.unauthorized incremented",
  auditLogEvidence: "attached: sanitized audit log sample",
  affectedPayoutBatchesReconciled: "attached: reconciliation-records-001.md",
};

describe("Phase 6 emergency revocation drill", () => {
  it("creates an emergency revocation drill record", () => {
    expect(createPhase6EmergencyRevocationDrillRecord(VALID_DRILL)).toContain(
      "retired_key_id: control-plane-compromised\n",
    );
  });

  it("rejects identical retired and replacement key IDs", () => {
    expect(() =>
      createPhase6EmergencyRevocationDrillRecord({
        ...VALID_DRILL,
        replacementKeyId: VALID_DRILL.retiredKeyId,
      }),
    ).toThrow("replacementKeyId must differ from retiredKeyId");
  });

  it("requires old-key rejection evidence to mention 401 or unauthorized", () => {
    expect(() => assertOldKeyRejectionEvidence("attached: rejected")).toThrow(
      "oldKeyRejectionEvidence must mention 401 or unauthorized rejection",
    );
  });

  it("rejects new-key success evidence that still shows unauthorized", () => {
    expect(() =>
      assertNewKeySuccessEvidence("attached: request returned 401"),
    ).toThrow("newKeySuccessEvidence must not describe an unauthorized request");
  });
});
