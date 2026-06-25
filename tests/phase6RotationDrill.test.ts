import { describe, expect, it } from "vitest";

import {
  assertRetiredKeyEvidence,
  createPhase6RotationDrillRecord,
} from "../src/phase6RotationDrill.js";

const VALID_DRILL = {
  drillId: "phase6-rotation-001",
  drillDate: "2026-06-25",
  owners: "security, operations",
  stagingEnvironment: "split402-staging",
  previousKeyId: "control-plane-previous",
  currentKeyId: "control-plane-current",
  dualActiveDeployTime: "2026-06-25T20:00:00Z",
  controlPlaneRotationTime: "2026-06-25T20:05:00Z",
  retiredKeyDeployTime: "2026-06-25T20:10:00Z",
  currentKeyTrafficEvidence: "attached: current-key-traffic.log",
  previousKeyRetiredEvidence: "attached: previous key status retired",
  healthEvidence: "attached: /v1/health after rotation",
  metricsEvidence: "attached: signer-metrics-after-rotation.log",
  auditLogEvidence: "attached: sanitized-audit-log-sample.jsonl",
};

describe("Phase 6 HMAC rotation drill", () => {
  it("creates a rotation drill record", () => {
    expect(createPhase6RotationDrillRecord(VALID_DRILL)).toContain(
      "current_key_id: control-plane-current\n",
    );
  });

  it("rejects identical previous and current key IDs", () => {
    expect(() =>
      createPhase6RotationDrillRecord({
        ...VALID_DRILL,
        currentKeyId: VALID_DRILL.previousKeyId,
      }),
    ).toThrow("currentKeyId must differ from previousKeyId");
  });

  it("requires retired evidence for the previous key", () => {
    expect(() => assertRetiredKeyEvidence("attached: key was removed")).toThrow(
      "previousKeyRetiredEvidence must mention retired status",
    );
  });
});
