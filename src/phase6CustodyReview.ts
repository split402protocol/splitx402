export const PHASE6_CUSTODY_REQUIRED_FIELDS = [
  "review_id",
  "review_date",
  "reviewers",
  "source_commit",
  "signer_image_digest",
  "control_plane_image_digest",
  "staging_environment",
  "funding_wallet",
  "network",
  "network_policy_record",
  "smoke_check_output",
  "rotation_drill_record",
  "incident_drill_record",
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
    normalized.includes("replace-with")
  );
}
