import { describe, expect, it } from "vitest";

import {
  PHASE6_EVIDENCE_COMMANDS,
  createPhase6EvidenceStatusReport,
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
  });

  it("reports blockers from an incomplete evidence bundle", () => {
    const report = createPhase6EvidenceStatusReport(`review_id: pending
approval_decision: no-go
`);

    expect(report.readyForCustody).toBe(false);
    expect(report.evidenceBundleChecked).toBe(true);
    expect(report.validation?.missingFields).toContain("review_date");
    expect(report.validation?.placeholderFields).toContain("review_id");
    expect(report.nextActions.join("\n")).toContain(
      "approval_decision must be approved before Phase 6 custody can go live",
    );
  });
});
