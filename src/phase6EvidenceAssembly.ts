import {
  createPhase6CustodyEvidenceBundle,
  type Phase6CustodyEvidenceBundleValues,
} from "./phase6CustodyBundle.js";

export interface Phase6EvidenceAssemblyInput {
  values?: Phase6CustodyEvidenceBundleValues;
  records?: {
    imageProvenance?: string;
    signerPolicy?: string;
  };
  attachments?: Partial<
    Record<
      | "network_policy_record"
      | "signer_policy_record"
      | "smoke_check_output"
      | "unknown_outcome_reconciliation_record"
      | "rotation_drill_record"
      | "emergency_revocation_drill_record"
      | "key_custody_record"
      | "incident_drill_record"
      | "rollback_drill_record"
      | "rpc_failover_record",
      string
    >
  >;
}

export function assemblePhase6CustodyEvidenceBundle(
  input: Phase6EvidenceAssemblyInput,
): string {
  const values: Phase6CustodyEvidenceBundleValues = {
    ...deriveValuesFromImageProvenance(input.records?.imageProvenance),
    ...deriveValuesFromSignerPolicy(input.records?.signerPolicy),
    ...deriveAttachmentValues(input.attachments ?? {}),
    ...(input.values ?? {}),
  };

  return createPhase6CustodyEvidenceBundle(values);
}

export function parsePhase6Record(text: string): Map<string, string> {
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

function deriveValuesFromImageProvenance(
  text: string | undefined,
): Phase6CustodyEvidenceBundleValues {
  if (text === undefined) {
    return {};
  }

  const fields = parsePhase6Record(text);
  return {
    review_date: fields.get("review_date"),
    reviewers: fields.get("reviewers"),
    source_commit: fields.get("source_commit"),
    signer_image_digest: fields.get("signer_image_digest"),
    signer_image_build_command: fields.get("signer_image_build_command"),
    signer_image_dependency_audit_output: fields.get("dependency_audit_output"),
    control_plane_image_digest: fields.get("control_plane_image_digest"),
  };
}

function deriveValuesFromSignerPolicy(
  text: string | undefined,
): Phase6CustodyEvidenceBundleValues {
  if (text === undefined) {
    return {};
  }

  const fields = parsePhase6Record(text);
  return {
    network: fields.get("network"),
    funding_wallet: fields.get("funding_wallet"),
    signer_policy_network: fields.get("network"),
    signer_policy_funding_wallet: fields.get("funding_wallet"),
    signer_policy_source_token_account: fields.get("source_token_account"),
    signer_policy_mint: fields.get("mint"),
    signer_policy_allowed_token_program_ids: fields.get(
      "allowed_token_program_ids",
    ),
    signer_policy_max_transaction_amount_atomic: fields.get(
      "max_transaction_amount_atomic",
    ),
  };
}

function deriveAttachmentValues(
  attachments: NonNullable<Phase6EvidenceAssemblyInput["attachments"]>,
): Phase6CustodyEvidenceBundleValues {
  const values: Phase6CustodyEvidenceBundleValues = {};
  for (const [field, path] of Object.entries(attachments)) {
    if (path.trim().length > 0) {
      values[field as keyof typeof values] = `attached: ${path.trim()}`;
    }
  }
  return values;
}
