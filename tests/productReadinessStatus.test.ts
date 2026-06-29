import { describe, expect, it } from "vitest";

import {
  createSplit402ProductReadinessReport,
  formatSplit402ProductReadinessBrief,
} from "../src/productReadinessStatus.js";

describe("Split402 product readiness status", () => {
  it("reports the product as no-go until Phase 6 and Phase 7 evidence are checked", () => {
    const report = createSplit402ProductReadinessReport();

    expect(report).toMatchObject({
      schema: "split402.product_readiness_status.v1",
      product: "Split402",
      repository: "split402protocol/splitx402",
      implementationState: "public-alpha foundation implemented",
      readiness: {
        totalLaunchGates: 2,
        checkedLaunchGates: 0,
        readyLaunchGates: 0,
        checkedLaunchGatePercent: 0,
        readyLaunchGatePercent: 0,
      },
      launchDecision: "no-go",
      readyForPublicAlphaDemo: false,
      readyForProductionCustody: false,
      readyForMainnet: false,
    });
    expect(report.summary).toContain("public-alpha implementation foundation");
    expect(report.summary).toContain("Missing checked evidence");
    expect(report.nextActions).toContain(
      "Create a combined launch evidence workspace with corepack pnpm product:evidence:init.",
    );
    expect(report.nextActions).toContain(
      "Run corepack pnpm product:launch-preflight --brief --workspace split402-launch-evidence and follow its next action.",
    );
    expect(report.nextActions).toContain(
      "Fill the generated Phase 7 and Phase 6 env files with hosted staging and custody evidence values.",
    );
    expect(report.nextActions).toContain(
      "Collect Phase 7 hosted proof and Phase 6 custody evidence from the same deployed environment and source commit.",
    );
    expect(report.nextActions).toContain(
      "Run hosted Phase 7 staging proof collection and status validation.",
    );
    expect(report.nextActions).toContain(
      "Run corepack pnpm product:status --brief --workspace split402-launch-evidence.",
    );
    expect(report.nextActions).not.toContain(
      "Create the evidence workspace with corepack pnpm phase7:staging:init.",
    );
  });

  it("surfaces blockers from checked but incomplete evidence", () => {
    const report = createSplit402ProductReadinessReport({
      phase6EvidenceText: `review_id: pending
approval_decision: no-go
`,
      phase7ProofText: `proof_id: pending
approval_decision: no-go
proof_date: 2026-06-29
source_commit: 21113e7
control_plane_url: https://control.example
dashboard_url: https://dashboard.example
demo_merchant_url: https://merchant.example
hosted_preflight_evidence: attached: hosted-preflight.json
agent_discovery_evidence: attached: agent-discovery.json
paid_request_evidence: attached: paid-suite.log
receipt_verification_evidence: attached: receipt-verification.json
referrer_balance_evidence: attached: referrer-balance.json
dashboard_summary_evidence: attached: dashboard-summary.json
webhook_delivery_evidence: attached: webhook-delivery.json
payout_obligation_evidence: attached: payout-obligation.json
funding_balance_evidence: attached: funding-balance.json
mcp_bundle_evidence: attached: mcp-bundle.json
mcp_gateway_evidence: attached: mcp-gateway.jsonl
artifact_manifest_evidence: attached: artifact-manifest.json
commands_run: attached: commands.log
approval_notes: checked evidence is intentionally incomplete
`,
    });

    expect(report.launchDecision).toBe("no-go");
    expect(report.phase6.evidenceBundleChecked).toBe(true);
    expect(report.phase7.proofChecked).toBe(true);
    expect(report.readiness.checkedLaunchGatePercent).toBe(100);
    expect(report.readiness.readyLaunchGatePercent).toBe(0);
    expect(report.nextActions.join("\n")).toContain(
      "Fix Phase 7 hosted proof blockers",
    );
    expect(report.nextActions.join("\n")).toContain(
      "Fix Phase 6 custody evidence blockers",
    );
    const brief = formatSplit402ProductReadinessBrief(report);
    expect(brief).toContain(
      "Fix Phase 7 hosted proof blockers reported by corepack pnpm phase7:staging:status.",
    );
    expect(brief).toContain(
      "Fix Phase 6 custody evidence blockers reported by corepack pnpm phase6:evidence:status.",
    );
    expect(brief.indexOf("Fill missing fields: reviewers")).toBeGreaterThan(-1);
    expect(brief.indexOf("Fill missing fields: review_date")).toBeGreaterThan(-1);
  });

  it("formats a simple operator-facing summary", () => {
    const report = createSplit402ProductReadinessReport();
    const brief = formatSplit402ProductReadinessBrief(report);

    expect(brief).toContain("Split402 status: no-go");
    expect(brief).toContain("Launch gates ready: 0/2 (0%)");
    expect(brief).toContain("Launch gates checked: 0/2 (0%)");
    expect(brief).toContain("Phase 7 hosted public-alpha proof: not checked");
    expect(brief).toContain("Phase 6 production custody evidence: not checked");
    expect(brief).toContain("Mainnet ready: no");
    expect(brief).toContain("corepack pnpm product:evidence:init");
    expect(brief).toContain("generated Phase 7 and Phase 6 env files");
    expect(brief).toContain("corepack pnpm product:launch-preflight");
  });
});
