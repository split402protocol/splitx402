export interface Phase6RotationDrillInput {
  drillId: string;
  drillDate: string;
  owners: string;
  stagingEnvironment: string;
  previousKeyId: string;
  currentKeyId: string;
  dualActiveDeployTime: string;
  controlPlaneRotationTime: string;
  retiredKeyDeployTime: string;
  currentKeyTrafficEvidence: string;
  previousKeyRetiredEvidence: string;
  healthEvidence: string;
  metricsEvidence: string;
  auditLogEvidence: string;
  drillDecision?: string;
  drillNotes?: string;
}

export function createPhase6RotationDrillRecord(
  input: Phase6RotationDrillInput,
): string {
  const previousKeyId = assertRequired(input.previousKeyId, "previousKeyId");
  const currentKeyId = assertRequired(input.currentKeyId, "currentKeyId");
  if (previousKeyId === currentKeyId) {
    throw new Error("currentKeyId must differ from previousKeyId");
  }

  const record = {
    drill_id: assertRequired(input.drillId, "drillId"),
    drill_date: assertRequired(input.drillDate, "drillDate"),
    owners: assertRequired(input.owners, "owners"),
    staging_environment: assertRequired(
      input.stagingEnvironment,
      "stagingEnvironment",
    ),
    previous_key_id: previousKeyId,
    current_key_id: currentKeyId,
    dual_active_deploy_time: assertRequired(
      input.dualActiveDeployTime,
      "dualActiveDeployTime",
    ),
    control_plane_rotation_time: assertRequired(
      input.controlPlaneRotationTime,
      "controlPlaneRotationTime",
    ),
    retired_key_deploy_time: assertRequired(
      input.retiredKeyDeployTime,
      "retiredKeyDeployTime",
    ),
    current_key_traffic_evidence: assertRequired(
      input.currentKeyTrafficEvidence,
      "currentKeyTrafficEvidence",
    ),
    previous_key_retired_evidence: assertRetiredKeyEvidence(
      input.previousKeyRetiredEvidence,
    ),
    health_evidence: assertRequired(input.healthEvidence, "healthEvidence"),
    metrics_evidence: assertRequired(input.metricsEvidence, "metricsEvidence"),
    audit_log_evidence: assertRequired(input.auditLogEvidence, "auditLogEvidence"),
    drill_decision: input.drillDecision ?? "no-go",
    drill_notes: input.drillNotes ?? "",
  };

  return `${Object.entries(record)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n")}\n`;
}

export function assertRetiredKeyEvidence(value: string): string {
  const trimmed = assertRequired(value, "previousKeyRetiredEvidence");
  const normalized = trimmed.toLowerCase();
  if (!normalized.includes("retired")) {
    throw new Error("previousKeyRetiredEvidence must mention retired status");
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
