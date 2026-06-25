import { PHASE6_CUSTODY_REQUIRED_FIELDS } from "./phase6CustodyReview.js";

export type Phase6CustodyEvidenceBundleValues = Partial<
  Record<(typeof PHASE6_CUSTODY_REQUIRED_FIELDS)[number], string>
>;

export function createPhase6CustodyEvidenceBundle(
  values: Phase6CustodyEvidenceBundleValues = {},
): string {
  const lines = PHASE6_CUSTODY_REQUIRED_FIELDS.map((field) => {
    const value = values[field] ?? defaultValueForField(field);
    return `${field}: ${value}`;
  });
  return `${lines.join("\n")}\n`;
}

export function phase6CustodyEvidenceEnvName(field: string): string {
  return `SPLIT402_PHASE6_EVIDENCE_${field.toUpperCase()}`;
}

function defaultValueForField(field: string): string {
  if (field === "approval_decision") {
    return "no-go";
  }
  return "";
}
