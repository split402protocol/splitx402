import { describe, expect, it } from "vitest";

import {
  assertImageDigest,
  assertReadinessEvidence,
  createPhase6RollbackDrillRecord,
} from "../src/phase6RollbackDrill.js";

const VALID_DRILL = {
  drillId: "phase6-rollback-001",
  drillDate: "2026-06-25",
  owners: "security, operations",
  stagingEnvironment: "split402-staging",
  currentSignerImageDigest:
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  lastKnownGoodSignerImageDigest:
    "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  currentSecretSetReference: "secret-set-current",
  lastKnownGoodSecretSetReference: "secret-set-previous",
  payoutBatchCreationPausedAt: "2026-06-25T20:00:00Z",
  rollbackStartedAt: "2026-06-25T20:05:00Z",
  rollbackCompletedAt: "2026-06-25T20:10:00Z",
  readinessAfterRollback: "attached: /v1/ready returned HTTP 200",
  metricsAfterRollback: "attached: signer-metrics-after-rollback.log",
  reconciliationRecords: "attached: reconciliation-records-001.md",
  batchCreationResumedAt: "2026-06-25T20:20:00Z",
};

describe("Phase 6 rollback drill", () => {
  it("creates a rollback drill record", () => {
    expect(createPhase6RollbackDrillRecord(VALID_DRILL)).toContain(
      "rollback_completed_at: 2026-06-25T20:10:00Z\n",
    );
  });

  it("rejects mutable image references", () => {
    expect(() => assertImageDigest("latest", "currentSignerImageDigest")).toThrow(
      "currentSignerImageDigest must be an immutable sha256 digest",
    );
  });

  it("requires rollback target image and secret set to differ", () => {
    expect(() =>
      createPhase6RollbackDrillRecord({
        ...VALID_DRILL,
        lastKnownGoodSignerImageDigest: VALID_DRILL.currentSignerImageDigest,
      }),
    ).toThrow(
      "lastKnownGoodSignerImageDigest must differ from currentSignerImageDigest",
    );

    expect(() =>
      createPhase6RollbackDrillRecord({
        ...VALID_DRILL,
        lastKnownGoodSecretSetReference: VALID_DRILL.currentSecretSetReference,
      }),
    ).toThrow(
      "lastKnownGoodSecretSetReference must differ from currentSecretSetReference",
    );
  });

  it("requires readiness evidence after rollback", () => {
    expect(() => assertReadinessEvidence("attached: response captured")).toThrow(
      "readinessAfterRollback must mention ready or HTTP 200",
    );
  });
});
