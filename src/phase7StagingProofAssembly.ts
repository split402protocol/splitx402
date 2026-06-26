import {
  createPhase7StagingProofRecord,
  type Phase7StagingProofField,
  type Phase7StagingProofValues,
} from "./phase7StagingProof.js";

export const PHASE7_STAGING_ATTACHMENT_FIELDS = [
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
] as const satisfies readonly Phase7StagingProofField[];

export type Phase7StagingAttachmentField =
  (typeof PHASE7_STAGING_ATTACHMENT_FIELDS)[number];

export interface Phase7StagingProofAssemblyInput {
  values?: Phase7StagingProofValues;
  attachments?: Partial<Record<Phase7StagingAttachmentField, string>>;
}

export function assemblePhase7StagingProof(
  input: Phase7StagingProofAssemblyInput,
): string {
  const values: Phase7StagingProofValues = {
    ...deriveAttachmentValues(input.attachments ?? {}),
    ...(input.values ?? {}),
  };

  return createPhase7StagingProofRecord(values);
}

function deriveAttachmentValues(
  attachments: NonNullable<Phase7StagingProofAssemblyInput["attachments"]>,
): Phase7StagingProofValues {
  const values: Phase7StagingProofValues = {};
  for (const [field, path] of Object.entries(attachments)) {
    if (path.trim().length > 0) {
      values[field as Phase7StagingAttachmentField] = `attached: ${path.trim()}`;
    }
  }
  return values;
}
