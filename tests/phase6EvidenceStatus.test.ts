import { describe, expect, it } from "vitest";

import {
  PHASE6_EVIDENCE_COMMANDS,
  createPhase6EvidenceStatusReport,
  formatPhase6EvidenceStatusBrief,
} from "../src/phase6EvidenceStatus.js";

describe("Phase 6 evidence status", () => {
  it("lists the operator evidence commands before a bundle exists", () => {
    const report = createPhase6EvidenceStatusReport();

    expect(report).toMatchObject({
      schema: "split402.phase6_evidence_status.v1",
      readyForCustody: false,
      evidenceBundleChecked: false,
    });
    expect(report.commands).toBe(PHASE6_EVIDENCE_COMMANDS);
    expect(report.commands[0]?.command).toBe(
      "corepack pnpm phase6:evidence:bundle",
    );
    expect(report.commands.map((item) => item.command)).toContain(
      "corepack pnpm phase6:evidence:assemble",
    );
    expect(report.commands.map((item) => item.command)).toContain(
      "corepack pnpm phase6:evidence:env-template split402-launch-evidence split402-launch-evidence/phase6-evidence.env",
    );
    expect(report.commands.map((item) => item.command)).toContain(
      "corepack pnpm phase6:network-policy",
    );
    expect(report.commands.map((item) => item.command)).toContain(
      "corepack pnpm phase6:incident-drill",
    );
    expect(report.commands.map((item) => item.command)).toContain(
      "corepack pnpm phase6:reconciliation-drill",
    );
    expect(report.commands.map((item) => item.command)).toContain(
      "corepack pnpm signer:payout:smoke && corepack pnpm phase6:signer-smoke",
    );
    expect(report.commands.map((item) => item.command)).toContain(
      "corepack pnpm payout:finality:failover-drill && corepack pnpm phase6:rpc-failover",
    );
    expect(report.nextActions).toContain(
      "Generate a bundle scaffold with corepack pnpm phase6:evidence:bundle.",
    );
    expect(report.nextActions).toContain(
      "Review generated split402-launch-evidence/phase6-evidence.env before editing; regenerate only if missing with corepack pnpm phase6:evidence:env-template split402-launch-evidence split402-launch-evidence/phase6-evidence.env.",
    );
  });

  it("reports blockers from an incomplete evidence bundle", () => {
    const report = createPhase6EvidenceStatusReport(`review_id: pending
approval_decision: no-go
`);

    expect(report.readyForCustody).toBe(false);
    expect(report.evidenceBundleChecked).toBe(true);
    expect(report.sourceCommitStatus.status).toBe("not_applicable");
    expect(report.validation?.missingFields).toContain("review_date");
    expect(report.validation?.placeholderFields).toContain("review_id");
    expect(report.validation?.invalidFields).toContain(
      "approval_decision must be approved before Phase 6 custody can go live",
    );
    expect(report.nextActions.join("\n")).toContain(
      "Fill direct Phase 6 custody review fields in split402-launch-evidence/phase6-evidence.env",
    );
    expect(report.nextActions.join("\n")).toContain(
      "Generate image provenance with corepack pnpm phase6:image-provenance",
    );
    expect(report.nextActions.join("\n")).toContain(
      "Generate signer policy evidence with corepack pnpm phase6:signer-policy",
    );
    expect(report.nextActions.join("\n")).toContain(
      "Generate custody drill evidence",
    );
    expect(report.nextActions.join("\n")).toContain(
      "Keep approval_decision=no-go until all Phase 6 custody evidence fields and reviews are complete",
    );
    expect(report.nextActions.join("\n")).toContain(
      "Reassemble with corepack pnpm phase6:evidence:assemble",
    );
    expect(report.nextActions.join("\n")).not.toContain("Fill missing fields:");
    expect(report.nextActions.join("\n")).not.toContain(
      "Replace placeholder fields: approval_decision",
    );
    const brief = formatPhase6EvidenceStatusBrief(report);
    expect(brief).toContain("Phase 6 custody evidence: checked, blocked");
    expect(brief).toContain("Launch posture: production custody remains no-go");
    expect(brief).toContain("Missing fields:");
  });

  it("validates Phase 6 evidence source_commit against the current checkout", () => {
    const report = createPhase6EvidenceStatusReport(
      `review_id: pending
source_commit: abc1234
approval_decision: no-go
`,
      {
        currentSourceCommit: "abc1234000000000000000000000000000000000",
      },
    );

    expect(report.sourceCommitStatus).toEqual({
      status: "valid",
      evidenceSourceCommit: "abc1234",
      currentSourceCommit: "abc1234000000000000000000000000000000000",
      blockers: [],
    });
  });

  it("blocks Phase 6 evidence from a stale checkout", () => {
    const report = createPhase6EvidenceStatusReport(
      `review_id: pending
source_commit: abc1234
approval_decision: no-go
`,
      {
        currentSourceCommit: "def5678000000000000000000000000000000000",
      },
    );

    expect(report.sourceCommitStatus).toEqual({
      status: "invalid",
      evidenceSourceCommit: "abc1234",
      currentSourceCommit: "def5678000000000000000000000000000000000",
      blockers: ["source_commit does not match current checkout"],
    });
    expect(report.nextActions).toContain(
      "source_commit does not match current checkout",
    );
  });
});
