import { describe, expect, it } from "vitest";

import {
  createPhase6CustodyEvidenceBundle,
  phase6CustodyEvidenceEnvName,
} from "../src/phase6CustodyBundle.js";

describe("Phase 6 custody evidence bundle scaffold", () => {
  it("creates a bundle in custody validator field order", () => {
    const bundle = createPhase6CustodyEvidenceBundle({
      review_id: "phase6-custody-001",
      review_date: "2026-06-25",
      source_commit: "022bce5",
    });

    expect(bundle.split("\n").slice(0, 4)).toEqual([
      "review_id: phase6-custody-001",
      "review_date: 2026-06-25",
      "reviewers: ",
      "source_commit: 022bce5",
    ]);
  });

  it("defaults approval decision to no-go", () => {
    expect(createPhase6CustodyEvidenceBundle()).toContain(
      "approval_decision: no-go\n",
    );
  });

  it("maps fields to operator environment variable names", () => {
    expect(phase6CustodyEvidenceEnvName("signer_policy_record")).toBe(
      "SPLIT402_PHASE6_EVIDENCE_SIGNER_POLICY_RECORD",
    );
  });
});
