const REQUIRED_PHASE7_STAGING_FIELDS = [
  "proof_id",
  "proof_date",
  "reviewers",
  "source_commit",
  "staging_environment",
  "control_plane_url",
  "dashboard_url",
  "demo_merchant_url",
  "webhook_receiver_url",
  "agent_discovery_evidence",
  "paid_request_evidence",
  "receipt_verification_evidence",
  "referrer_balance_evidence",
  "dashboard_summary_evidence",
  "webhook_delivery_evidence",
  "payout_obligation_evidence",
  "funding_balance_evidence",
  "mcp_bundle_evidence",
  "commands_run",
  "approval_decision",
] as const;

export type Phase7StagingProofField =
  (typeof REQUIRED_PHASE7_STAGING_FIELDS)[number] | "approval_notes";

export type Phase7StagingProofValues = Partial<
  Record<Phase7StagingProofField, string>
>;

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
    `agent_discovery_evidence: ${values.agent_discovery_evidence ?? ""}`,
    `paid_request_evidence: ${values.paid_request_evidence ?? ""}`,
    `receipt_verification_evidence: ${values.receipt_verification_evidence ?? ""}`,
    `referrer_balance_evidence: ${values.referrer_balance_evidence ?? ""}`,
    `dashboard_summary_evidence: ${values.dashboard_summary_evidence ?? ""}`,
    `webhook_delivery_evidence: ${values.webhook_delivery_evidence ?? ""}`,
    `payout_obligation_evidence: ${values.payout_obligation_evidence ?? ""}`,
    `funding_balance_evidence: ${values.funding_balance_evidence ?? ""}`,
    `mcp_bundle_evidence: ${values.mcp_bundle_evidence ?? ""}`,
    `commands_run: ${values.commands_run ?? ""}`,
    `approval_decision: ${values.approval_decision ?? "no-go"}`,
    `approval_notes: ${values.approval_notes ?? ""}`,
    "",
  ].join("\n");
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
