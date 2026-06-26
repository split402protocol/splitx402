import { describe, expect, it } from "vitest";

import { assemblePhase7StagingProof } from "../src/phase7StagingProofAssembly.js";

describe("Phase 7 staging proof assembly", () => {
  it("assembles proof values from artifact attachments", () => {
    const proof = assemblePhase7StagingProof({
      attachments: {
        agent_discovery_evidence: "evidence/agent-discovery.json",
        paid_request_evidence: "evidence/paid-suite.log",
        receipt_verification_evidence: "evidence/receipt.json",
        referrer_balance_evidence: "evidence/referrer-balances.json",
        dashboard_summary_evidence: "evidence/dashboard-summary.json",
        webhook_delivery_evidence: "evidence/webhook-events.json",
        payout_obligation_evidence: "evidence/payout-obligations.json",
        funding_balance_evidence: "evidence/funding-balance.json",
        mcp_bundle_evidence: "evidence/mcp-bundle.json",
        artifact_manifest_evidence: "evidence/artifact-manifest.json",
        commands_run: "evidence/commands.log",
      },
      values: {
        proof_id: "phase7-staging-001",
        proof_date: "2026-06-26",
        reviewers: "Split402 operators",
        source_commit: "b16b856",
        staging_environment: "split402-staging",
        control_plane_url: "https://control.staging.example",
        dashboard_url: "https://dashboard.staging.example",
        demo_merchant_url: "https://merchant.staging.example",
        webhook_receiver_url: "https://webhook.staging.example",
      },
    });

    expect(proof).toContain("proof_id: phase7-staging-001\n");
    expect(proof).toContain(
      "agent_discovery_evidence: attached: evidence/agent-discovery.json\n",
    );
    expect(proof).toContain(
      "funding_balance_evidence: attached: evidence/funding-balance.json\n",
    );
    expect(proof).toContain(
      "artifact_manifest_evidence: attached: evidence/artifact-manifest.json\n",
    );
    expect(proof).toContain("approval_decision: no-go\n");
  });

  it("lets direct values override attachment paths", () => {
    const proof = assemblePhase7StagingProof({
      attachments: {
        funding_balance_evidence: "evidence/funding-balance.json",
      },
      values: {
        funding_balance_evidence: "attached: reviewed-funding-balance.json",
      },
    });

    expect(proof).toContain(
      "funding_balance_evidence: attached: reviewed-funding-balance.json\n",
    );
  });
});
