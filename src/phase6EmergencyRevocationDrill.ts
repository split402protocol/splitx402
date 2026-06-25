export interface Phase6EmergencyRevocationDrillInput {
  drillId: string;
  drillDate: string;
  owners: string;
  stagingEnvironment: string;
  retiredKeyId: string;
  replacementKeyId: string;
  revocationStartTime: string;
  signerDeployTime: string;
  controlPlaneRotationTime: string;
  oldKeyRejectionEvidence: string;
  newKeySuccessEvidence: string;
  metricsEvidence: string;
  auditLogEvidence: string;
  affectedPayoutBatchesReconciled: string;
  drillDecision?: string;
  drillNotes?: string;
}

export function createPhase6EmergencyRevocationDrillRecord(
  input: Phase6EmergencyRevocationDrillInput,
): string {
  const retiredKeyId = assertRequired(input.retiredKeyId, "retiredKeyId");
  const replacementKeyId = assertRequired(
    input.replacementKeyId,
    "replacementKeyId",
  );
  if (retiredKeyId === replacementKeyId) {
    throw new Error("replacementKeyId must differ from retiredKeyId");
  }

  const record = {
    drill_id: assertRequired(input.drillId, "drillId"),
    drill_date: assertRequired(input.drillDate, "drillDate"),
    owners: assertRequired(input.owners, "owners"),
    staging_environment: assertRequired(
      input.stagingEnvironment,
      "stagingEnvironment",
    ),
    retired_key_id: retiredKeyId,
    replacement_key_id: replacementKeyId,
    revocation_start_time: assertRequired(
      input.revocationStartTime,
      "revocationStartTime",
    ),
    signer_deploy_time: assertRequired(input.signerDeployTime, "signerDeployTime"),
    control_plane_rotation_time: assertRequired(
      input.controlPlaneRotationTime,
      "controlPlaneRotationTime",
    ),
    old_key_rejection_evidence: assertOldKeyRejectionEvidence(
      input.oldKeyRejectionEvidence,
    ),
    new_key_success_evidence: assertNewKeySuccessEvidence(
      input.newKeySuccessEvidence,
    ),
    metrics_evidence: assertRequired(input.metricsEvidence, "metricsEvidence"),
    audit_log_evidence: assertRequired(input.auditLogEvidence, "auditLogEvidence"),
    affected_payout_batches_reconciled: assertRequired(
      input.affectedPayoutBatchesReconciled,
      "affectedPayoutBatchesReconciled",
    ),
    drill_decision: input.drillDecision ?? "no-go",
    drill_notes: input.drillNotes ?? "",
  };

  return `${Object.entries(record)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n")}\n`;
}

export function assertOldKeyRejectionEvidence(value: string): string {
  const trimmed = assertRequired(value, "oldKeyRejectionEvidence");
  const normalized = trimmed.toLowerCase();
  if (!normalized.includes("401") && !normalized.includes("unauthorized")) {
    throw new Error(
      "oldKeyRejectionEvidence must mention 401 or unauthorized rejection",
    );
  }
  return trimmed;
}

export function assertNewKeySuccessEvidence(value: string): string {
  const trimmed = assertRequired(value, "newKeySuccessEvidence");
  const normalized = trimmed.toLowerCase();
  if (normalized.includes("401") || normalized.includes("unauthorized")) {
    throw new Error(
      "newKeySuccessEvidence must not describe an unauthorized request",
    );
  }
  return trimmed;
}

function assertRequired(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${fieldName} is required`);
  }
  return trimmed;
}
