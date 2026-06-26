import { createPhase7StagingProofRecord } from "./phase7StagingProof.js";

const values = {
  proof_id: process.env.SPLIT402_PHASE7_PROOF_ID,
  proof_date: process.env.SPLIT402_PHASE7_PROOF_DATE ?? isoDate(),
  reviewers: process.env.SPLIT402_PHASE7_PROOF_REVIEWERS,
  source_commit: process.env.SPLIT402_PHASE7_SOURCE_COMMIT,
  staging_environment: process.env.SPLIT402_PHASE7_STAGING_ENVIRONMENT,
  control_plane_url: process.env.SPLIT402_PHASE7_CONTROL_PLANE_URL,
  dashboard_url: process.env.SPLIT402_PHASE7_DASHBOARD_URL,
  demo_merchant_url: process.env.SPLIT402_PHASE7_DEMO_MERCHANT_URL,
  webhook_receiver_url: process.env.SPLIT402_PHASE7_WEBHOOK_RECEIVER_URL,
  agent_discovery_evidence: process.env.SPLIT402_PHASE7_AGENT_DISCOVERY_EVIDENCE,
  paid_request_evidence: process.env.SPLIT402_PHASE7_PAID_REQUEST_EVIDENCE,
  receipt_verification_evidence:
    process.env.SPLIT402_PHASE7_RECEIPT_VERIFICATION_EVIDENCE,
  referrer_balance_evidence:
    process.env.SPLIT402_PHASE7_REFERRER_BALANCE_EVIDENCE,
  dashboard_summary_evidence:
    process.env.SPLIT402_PHASE7_DASHBOARD_SUMMARY_EVIDENCE,
  webhook_delivery_evidence:
    process.env.SPLIT402_PHASE7_WEBHOOK_DELIVERY_EVIDENCE,
  payout_obligation_evidence:
    process.env.SPLIT402_PHASE7_PAYOUT_OBLIGATION_EVIDENCE,
  funding_balance_evidence:
    process.env.SPLIT402_PHASE7_FUNDING_BALANCE_EVIDENCE,
  mcp_bundle_evidence: process.env.SPLIT402_PHASE7_MCP_BUNDLE_EVIDENCE,
  commands_run: process.env.SPLIT402_PHASE7_COMMANDS_RUN,
  approval_decision: process.env.SPLIT402_PHASE7_APPROVAL_DECISION,
  approval_notes: process.env.SPLIT402_PHASE7_APPROVAL_NOTES,
};

console.log(createPhase7StagingProofRecord(values));

function isoDate(): string {
  return new Date().toISOString().slice(0, 10);
}
