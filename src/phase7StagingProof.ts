export const REQUIRED_PHASE7_STAGING_FIELDS = [
  "proof_id",
  "proof_date",
  "reviewers",
  "source_commit",
  "staging_environment",
  "control_plane_url",
  "dashboard_url",
  "demo_merchant_url",
  "webhook_receiver_url",
  "hosted_preflight_evidence",
  "agent_discovery_evidence",
  "paid_request_evidence",
  "receipt_verification_evidence",
  "referrer_balance_evidence",
  "dashboard_summary_evidence",
  "webhook_delivery_evidence",
  "payout_obligation_evidence",
  "funding_balance_evidence",
  "mcp_bundle_evidence",
  "mcp_gateway_evidence",
  "artifact_manifest_evidence",
  "commands_run",
  "approval_decision",
] as const;

export type Phase7StagingProofField =
  (typeof REQUIRED_PHASE7_STAGING_FIELDS)[number] | "approval_notes";

export type Phase7StagingProofValues = Partial<
  Record<Phase7StagingProofField, string>
>;

const PHASE7_URL_FIELDS = [
  "control_plane_url",
  "dashboard_url",
  "demo_merchant_url",
  "webhook_receiver_url",
] as const satisfies readonly Phase7StagingProofField[];

export const PHASE7_EVIDENCE_FIELDS = [
  "hosted_preflight_evidence",
  "agent_discovery_evidence",
  "paid_request_evidence",
  "receipt_verification_evidence",
  "referrer_balance_evidence",
  "dashboard_summary_evidence",
  "webhook_delivery_evidence",
  "payout_obligation_evidence",
  "funding_balance_evidence",
  "mcp_bundle_evidence",
  "mcp_gateway_evidence",
  "artifact_manifest_evidence",
  "commands_run",
] as const satisfies readonly Phase7StagingProofField[];

const PHASE7_STAGING_PROOF_ENV_NAMES: Record<Phase7StagingProofField, string> = {
  proof_id: "SPLIT402_PHASE7_PROOF_ID",
  proof_date: "SPLIT402_PHASE7_PROOF_DATE",
  reviewers: "SPLIT402_PHASE7_PROOF_REVIEWERS",
  source_commit: "SPLIT402_PHASE7_SOURCE_COMMIT",
  staging_environment: "SPLIT402_PHASE7_STAGING_ENVIRONMENT",
  control_plane_url: "SPLIT402_PHASE7_CONTROL_PLANE_URL",
  dashboard_url: "SPLIT402_PHASE7_DASHBOARD_URL",
  demo_merchant_url: "SPLIT402_PHASE7_DEMO_MERCHANT_URL",
  webhook_receiver_url: "SPLIT402_PHASE7_WEBHOOK_RECEIVER_URL",
  hosted_preflight_evidence: "SPLIT402_PHASE7_HOSTED_PREFLIGHT_EVIDENCE",
  agent_discovery_evidence: "SPLIT402_PHASE7_AGENT_DISCOVERY_EVIDENCE",
  paid_request_evidence: "SPLIT402_PHASE7_PAID_REQUEST_EVIDENCE",
  receipt_verification_evidence:
    "SPLIT402_PHASE7_RECEIPT_VERIFICATION_EVIDENCE",
  referrer_balance_evidence: "SPLIT402_PHASE7_REFERRER_BALANCE_EVIDENCE",
  dashboard_summary_evidence: "SPLIT402_PHASE7_DASHBOARD_SUMMARY_EVIDENCE",
  webhook_delivery_evidence: "SPLIT402_PHASE7_WEBHOOK_DELIVERY_EVIDENCE",
  payout_obligation_evidence: "SPLIT402_PHASE7_PAYOUT_OBLIGATION_EVIDENCE",
  funding_balance_evidence: "SPLIT402_PHASE7_FUNDING_BALANCE_EVIDENCE",
  mcp_bundle_evidence: "SPLIT402_PHASE7_MCP_BUNDLE_EVIDENCE",
  mcp_gateway_evidence: "SPLIT402_PHASE7_MCP_GATEWAY_EVIDENCE",
  artifact_manifest_evidence: "SPLIT402_PHASE7_ARTIFACT_MANIFEST_EVIDENCE",
  commands_run: "SPLIT402_PHASE7_COMMANDS_RUN",
  approval_decision: "SPLIT402_PHASE7_APPROVAL_DECISION",
  approval_notes: "SPLIT402_PHASE7_APPROVAL_NOTES",
};

export interface Phase7StagingProofValidation {
  schema: "split402.phase7_staging_proof_validation.v1";
  approved: boolean;
  missingFields: string[];
  placeholderFields: string[];
  invalidFields: string[];
}

export function createPhase7StagingProofRecord(
  values: Phase7StagingProofValues = {},
): string {
  return [
    `proof_id: ${values.proof_id ?? ""}`,
    `proof_date: ${values.proof_date ?? ""}`,
    `reviewers: ${values.reviewers ?? ""}`,
    `source_commit: ${values.source_commit ?? ""}`,
    `staging_environment: ${values.staging_environment ?? ""}`,
    `control_plane_url: ${values.control_plane_url ?? ""}`,
    `dashboard_url: ${values.dashboard_url ?? ""}`,
    `demo_merchant_url: ${values.demo_merchant_url ?? ""}`,
    `webhook_receiver_url: ${values.webhook_receiver_url ?? ""}`,
    `hosted_preflight_evidence: ${values.hosted_preflight_evidence ?? ""}`,
    `agent_discovery_evidence: ${values.agent_discovery_evidence ?? ""}`,
    `paid_request_evidence: ${values.paid_request_evidence ?? ""}`,
    `receipt_verification_evidence: ${values.receipt_verification_evidence ?? ""}`,
    `referrer_balance_evidence: ${values.referrer_balance_evidence ?? ""}`,
    `dashboard_summary_evidence: ${values.dashboard_summary_evidence ?? ""}`,
    `webhook_delivery_evidence: ${values.webhook_delivery_evidence ?? ""}`,
    `payout_obligation_evidence: ${values.payout_obligation_evidence ?? ""}`,
    `funding_balance_evidence: ${values.funding_balance_evidence ?? ""}`,
    `mcp_bundle_evidence: ${values.mcp_bundle_evidence ?? ""}`,
    `mcp_gateway_evidence: ${values.mcp_gateway_evidence ?? ""}`,
    `artifact_manifest_evidence: ${values.artifact_manifest_evidence ?? ""}`,
    `commands_run: ${values.commands_run ?? ""}`,
    `approval_decision: ${values.approval_decision ?? "no-go"}`,
    `approval_notes: ${values.approval_notes ?? ""}`,
    "",
  ].join("\n");
}

export function phase7StagingProofEnvName(
  field: Phase7StagingProofField,
): string {
  return PHASE7_STAGING_PROOF_ENV_NAMES[field];
}

export function validatePhase7StagingProof(
  text: string,
): Phase7StagingProofValidation {
  const fields = parsePhase7ProofRecord(text);
  const missingFields = REQUIRED_PHASE7_STAGING_FIELDS.filter((field) => {
    const value = fields.get(field);
    return value === undefined || value.length === 0;
  });
  const placeholderFields = REQUIRED_PHASE7_STAGING_FIELDS.filter((field) =>
    isPlaceholder(fields.get(field)),
  );
  const invalidFields: string[] = [];
  const approvalDecision = fields.get("approval_decision");
  const proofDate = fields.get("proof_date");
  const sourceCommit = fields.get("source_commit");

  if (
    approvalDecision !== undefined &&
    approvalDecision.length > 0 &&
    approvalDecision !== "approved" &&
    approvalDecision !== "no-go"
  ) {
    invalidFields.push("approval_decision must be approved or no-go");
  }
  if (approvalDecision !== "approved") {
    invalidFields.push(
      "approval_decision must be approved before Phase 7 staging proof can close",
    );
  }
  if (
    proofDate !== undefined &&
    proofDate.length > 0 &&
    !isIsoDate(proofDate)
  ) {
    invalidFields.push("proof_date must use YYYY-MM-DD");
  }
  if (
    sourceCommit !== undefined &&
    sourceCommit.length > 0 &&
    !/^[0-9a-f]{7,40}$/u.test(sourceCommit)
  ) {
    invalidFields.push("source_commit must be a 7-40 character git SHA");
  }
  for (const field of PHASE7_URL_FIELDS) {
    const value = fields.get(field);
    if (value !== undefined && value.length > 0 && !isHttpUrl(value)) {
      invalidFields.push(`${field} must be an http(s) URL`);
    }
  }
  for (const field of PHASE7_EVIDENCE_FIELDS) {
    const value = fields.get(field);
    if (value !== undefined && value.length > 0 && !isEvidenceReference(value)) {
      invalidFields.push(`${field} must be an attached artifact or http(s) URL`);
    }
  }

  return {
    schema: "split402.phase7_staging_proof_validation.v1",
    approved:
      missingFields.length === 0 &&
      placeholderFields.length === 0 &&
      invalidFields.length === 0,
    missingFields,
    placeholderFields,
    invalidFields,
  };
}

export function parsePhase7ProofRecord(text: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of text.split(/\r?\n/u)) {
    const match = /^([a-z][a-z0-9_]*):\s*(.*)$/u.exec(line);
    if (match === null) {
      continue;
    }
    const [, key, value] = match;
    if (key !== undefined && value !== undefined) {
      fields.set(key, value.trim());
    }
  }
  return fields;
}

function isPlaceholder(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  return (
    value === "TODO" ||
    value === "TBD" ||
    value === "pending" ||
    value.startsWith("<") ||
    value.includes("...")
  );
}

function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) {
    return false;
  }
  const [, year, month, day] = match;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() + 1 === Number(month) &&
    date.getUTCDate() === Number(day)
  );
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isEvidenceReference(value: string): boolean {
  if (isHttpUrl(value)) {
    return true;
  }
  const attachedPrefix = "attached:";
  return (
    value.startsWith(attachedPrefix) &&
    value.slice(attachedPrefix.length).trim().length > 0
  );
}
