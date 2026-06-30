export const PHASE6_CUSTODY_REQUIRED_FIELDS = [
  "review_id",
  "review_date",
  "reviewers",
  "source_commit",
  "signer_image_digest",
  "signer_image_build_command",
  "signer_image_dependency_audit_output",
  "control_plane_image_digest",
  "staging_environment",
  "funding_wallet",
  "network",
  "network_policy_record",
  "signer_policy_record",
  "signer_policy_network",
  "signer_policy_funding_wallet",
  "signer_policy_source_token_account",
  "signer_policy_mint",
  "signer_policy_allowed_token_program_ids",
  "signer_policy_max_transaction_amount_atomic",
  "smoke_check_output",
  "unknown_outcome_reconciliation_record",
  "rotation_drill_record",
  "emergency_revocation_drill_record",
  "key_custody_record",
  "incident_drill_record",
  "rollback_drill_record",
  "rpc_failover_record",
  "approval_decision",
  "approval_notes",
] as const;

export type Phase6CustodyRequiredField =
  (typeof PHASE6_CUSTODY_REQUIRED_FIELDS)[number];

export interface Phase6CustodyReviewValidation {
  approved: boolean;
  missingFields: Phase6CustodyRequiredField[];
  placeholderFields: Phase6CustodyRequiredField[];
  invalidFields: string[];
}

export function validatePhase6CustodyEvidence(
  evidenceText: string,
): Phase6CustodyReviewValidation {
  const fields = parseEvidenceFields(evidenceText);
  const missingFields: Phase6CustodyRequiredField[] = [];
  const placeholderFields: Phase6CustodyRequiredField[] = [];
  const invalidFields: string[] = [];

  for (const field of PHASE6_CUSTODY_REQUIRED_FIELDS) {
    const value = fields.get(field);
    if (value === undefined || value.trim().length === 0) {
      missingFields.push(field);
      continue;
    }
    if (isPlaceholderValue(value)) {
      placeholderFields.push(field);
    }
  }

  const approvalDecision = fields.get("approval_decision")?.trim().toLowerCase();
  if (approvalDecision !== undefined && approvalDecision !== "approved") {
    invalidFields.push(
      "approval_decision must be approved before Phase 6 custody can go live",
    );
  }

  const sourceCommit = fields.get("source_commit")?.trim();
  if (
    sourceCommit !== undefined &&
    sourceCommit.length > 0 &&
    !/^[a-f0-9]{7,40}$/u.test(sourceCommit)
  ) {
    invalidFields.push("source_commit must be a git SHA");
  }

  const reviewDate = fields.get("review_date")?.trim();
  if (
    reviewDate !== undefined &&
    reviewDate.length > 0 &&
    !isIsoCalendarDate(reviewDate)
  ) {
    invalidFields.push("review_date must be a valid YYYY-MM-DD calendar date");
  }

  const signerPolicyNetwork = fields.get("signer_policy_network")?.trim();
  const network = fields.get("network")?.trim();
  if (
    signerPolicyNetwork !== undefined &&
    signerPolicyNetwork.length > 0 &&
    !signerPolicyNetwork.startsWith("solana:")
  ) {
    invalidFields.push("signer_policy_network must start with solana:");
  }
  if (
    signerPolicyNetwork !== undefined &&
    network !== undefined &&
    signerPolicyNetwork.length > 0 &&
    network.length > 0 &&
    signerPolicyNetwork !== network
  ) {
    invalidFields.push("signer_policy_network must match network");
  }

  const signerPolicyFundingWallet = fields
    .get("signer_policy_funding_wallet")
    ?.trim();
  const fundingWallet = fields.get("funding_wallet")?.trim();
  if (
    signerPolicyFundingWallet !== undefined &&
    fundingWallet !== undefined &&
    signerPolicyFundingWallet.length > 0 &&
    fundingWallet.length > 0 &&
    signerPolicyFundingWallet !== fundingWallet
  ) {
    invalidFields.push("signer_policy_funding_wallet must match funding_wallet");
  }

  const signerPolicyAllowedTokenProgramIds = fields
    .get("signer_policy_allowed_token_program_ids")
    ?.trim();
  if (
    signerPolicyAllowedTokenProgramIds !== undefined &&
    signerPolicyAllowedTokenProgramIds.length > 0 &&
    signerPolicyAllowedTokenProgramIds.split(",").every((item) => item.trim().length === 0)
  ) {
    invalidFields.push(
      "signer_policy_allowed_token_program_ids must include at least one token program",
    );
  }

  const signerPolicyMaxTransactionAmountAtomic = fields
    .get("signer_policy_max_transaction_amount_atomic")
    ?.trim();
  if (
    signerPolicyMaxTransactionAmountAtomic !== undefined &&
    signerPolicyMaxTransactionAmountAtomic.length > 0 &&
    !/^[1-9][0-9]*$/u.test(signerPolicyMaxTransactionAmountAtomic)
  ) {
    invalidFields.push(
      "signer_policy_max_transaction_amount_atomic must be a positive atomic amount",
    );
  }

  for (const digestField of [
    "signer_image_digest",
    "control_plane_image_digest",
  ] as const) {
    const digest = fields.get(digestField)?.trim();
    if (
      digest !== undefined &&
      digest.length > 0 &&
      !/^sha256:[a-f0-9]{64}$/u.test(digest)
    ) {
      invalidFields.push(`${digestField} must be an immutable sha256 digest`);
    }
  }

  return {
    approved:
      missingFields.length === 0 &&
      placeholderFields.length === 0 &&
      invalidFields.length === 0,
    missingFields,
    placeholderFields,
    invalidFields,
  };
}

function parseEvidenceFields(text: string): Map<string, string> {
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

function isPlaceholderValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.length === 0 ||
    normalized === "pending" ||
    normalized === "todo" ||
    normalized === "tbd" ||
    normalized === "no-go" ||
    normalized === "replace-me" ||
    normalized.startsWith("<") ||
    normalized.includes("replace-with") ||
    normalized.includes("yyyy")
  );
}

function isIsoCalendarDate(value: string): boolean {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/u.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
