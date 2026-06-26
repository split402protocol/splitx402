import { describe, expect, it } from "vitest";

import {
  createPhase7StagingProofRecord,
  validatePhase7StagingProof,
} from "../src/phase7StagingProof.js";
import {
  PHASE7_STAGING_COMMANDS,
  createPhase7StagingStatusReport,
} from "../src/phase7StagingStatus.js";

describe("Phase 7 staging proof", () => {
  it("scaffolds a no-go proof record", () => {
    const record = createPhase7StagingProofRecord({
      proof_id: "phase7-staging-2026-06-26",
      proof_date: "2026-06-26",
    });

    expect(record).toContain("proof_id: phase7-staging-2026-06-26");
    expect(record).toContain("proof_date: 2026-06-26");
    expect(record).toContain("approval_decision: no-go");
    expect(record).toContain("dashboard_summary_evidence:");
    expect(record).toContain("funding_balance_evidence:");
  });

  it("reports missing and placeholder fields", () => {
    const validation = validatePhase7StagingProof(`proof_id: pending
approval_decision: no-go
`);

    expect(validation.approved).toBe(false);
    expect(validation.missingFields).toContain("proof_date");
    expect(validation.placeholderFields).toContain("proof_id");
    expect(validation.invalidFields).toContain(
      "approval_decision must be approved before Phase 7 staging proof can close",
    );
  });

  it("approves a complete staging proof record", () => {
    const validation = validatePhase7StagingProof(
      createPhase7StagingProofRecord({
        proof_id: "phase7-staging-2026-06-26",
        proof_date: "2026-06-26",
        reviewers: "Split402 operators",
        source_commit: "fd88024",
        staging_environment: "staging-us",
        control_plane_url: "https://control.staging.example",
        dashboard_url: "https://dashboard.staging.example",
        demo_merchant_url: "https://merchant.staging.example",
        webhook_receiver_url: "https://webhook.staging.example",
        agent_discovery_evidence: "attached: agent-discovery.json",
        paid_request_evidence: "attached: paid-suite.log",
        receipt_verification_evidence: "attached: receipt-verification.json",
        referrer_balance_evidence: "attached: referrer-balances.json",
        dashboard_summary_evidence: "attached: dashboard-summary.json",
        webhook_delivery_evidence: "attached: webhook-events.json",
        payout_obligation_evidence: "attached: payout-obligations.json",
        funding_balance_evidence: "attached: funding-balance.json",
        mcp_bundle_evidence: "attached: mcp-bundle.json",
        commands_run: "attached: commands.log",
        approval_decision: "approved",
      }),
    );

    expect(validation).toMatchObject({
      approved: true,
      missingFields: [],
      placeholderFields: [],
      invalidFields: [],
    });
  });

  it("lists staging proof commands before proof exists", () => {
    const report = createPhase7StagingStatusReport();

    expect(report).toMatchObject({
      schema: "split402.phase7_staging_status.v1",
      readyForPublicAlphaDemo: false,
      proofChecked: false,
    });
    expect(report.commands).toBe(PHASE7_STAGING_COMMANDS);
    expect(report.commands.map((item) => item.command)).toContain(
      "corepack pnpm phase7:staging-proof",
    );
    expect(report.commands.map((item) => item.evidenceField)).toContain(
      "funding_balance_evidence",
    );
    expect(report.nextActions).toContain(
      "Generate a proof scaffold with corepack pnpm phase7:staging-proof.",
    );
  });
});
