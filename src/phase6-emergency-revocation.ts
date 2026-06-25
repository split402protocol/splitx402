import { createPhase6EmergencyRevocationDrillRecord } from "./phase6EmergencyRevocationDrill.js";

const env = process.env;

try {
  console.log(
    createPhase6EmergencyRevocationDrillRecord({
      drillId: readRequiredEnv("SPLIT402_PHASE6_EMERGENCY_REVOCATION_DRILL_ID"),
      drillDate:
        env.SPLIT402_PHASE6_EMERGENCY_REVOCATION_DRILL_DATE ?? isoDate(),
      owners: readRequiredEnv("SPLIT402_PHASE6_EMERGENCY_REVOCATION_OWNERS"),
      stagingEnvironment: readRequiredEnv(
        "SPLIT402_PHASE6_EMERGENCY_REVOCATION_STAGING_ENVIRONMENT",
      ),
      retiredKeyId: readRequiredEnv(
        "SPLIT402_PHASE6_EMERGENCY_REVOCATION_RETIRED_KEY_ID",
      ),
      replacementKeyId: readRequiredEnv(
        "SPLIT402_PHASE6_EMERGENCY_REVOCATION_REPLACEMENT_KEY_ID",
      ),
      revocationStartTime: readRequiredEnv(
        "SPLIT402_PHASE6_EMERGENCY_REVOCATION_START_TIME",
      ),
      signerDeployTime: readRequiredEnv(
        "SPLIT402_PHASE6_EMERGENCY_REVOCATION_SIGNER_DEPLOY_TIME",
      ),
      controlPlaneRotationTime: readRequiredEnv(
        "SPLIT402_PHASE6_EMERGENCY_REVOCATION_CONTROL_PLANE_ROTATION_TIME",
      ),
      oldKeyRejectionEvidence: readRequiredEnv(
        "SPLIT402_PHASE6_EMERGENCY_REVOCATION_OLD_KEY_REJECTION_EVIDENCE",
      ),
      newKeySuccessEvidence: readRequiredEnv(
        "SPLIT402_PHASE6_EMERGENCY_REVOCATION_NEW_KEY_SUCCESS_EVIDENCE",
      ),
      metricsEvidence: readRequiredEnv(
        "SPLIT402_PHASE6_EMERGENCY_REVOCATION_METRICS_EVIDENCE",
      ),
      auditLogEvidence: readRequiredEnv(
        "SPLIT402_PHASE6_EMERGENCY_REVOCATION_AUDIT_LOG_EVIDENCE",
      ),
      affectedPayoutBatchesReconciled: readRequiredEnv(
        "SPLIT402_PHASE6_EMERGENCY_REVOCATION_RECONCILIATION_EVIDENCE",
      ),
      drillDecision:
        env.SPLIT402_PHASE6_EMERGENCY_REVOCATION_DRILL_DECISION ?? "no-go",
      drillNotes: env.SPLIT402_PHASE6_EMERGENCY_REVOCATION_DRILL_NOTES ?? "",
    }),
  );
} catch (error) {
  console.error(readErrorMessage(error));
  console.error(
    [
      "Required environment:",
      "  SPLIT402_PHASE6_EMERGENCY_REVOCATION_DRILL_ID",
      "  SPLIT402_PHASE6_EMERGENCY_REVOCATION_OWNERS",
      "  SPLIT402_PHASE6_EMERGENCY_REVOCATION_STAGING_ENVIRONMENT",
      "  SPLIT402_PHASE6_EMERGENCY_REVOCATION_RETIRED_KEY_ID",
      "  SPLIT402_PHASE6_EMERGENCY_REVOCATION_REPLACEMENT_KEY_ID",
      "  SPLIT402_PHASE6_EMERGENCY_REVOCATION_START_TIME",
      "  SPLIT402_PHASE6_EMERGENCY_REVOCATION_SIGNER_DEPLOY_TIME",
      "  SPLIT402_PHASE6_EMERGENCY_REVOCATION_CONTROL_PLANE_ROTATION_TIME",
      "  SPLIT402_PHASE6_EMERGENCY_REVOCATION_OLD_KEY_REJECTION_EVIDENCE",
      "  SPLIT402_PHASE6_EMERGENCY_REVOCATION_NEW_KEY_SUCCESS_EVIDENCE",
      "  SPLIT402_PHASE6_EMERGENCY_REVOCATION_METRICS_EVIDENCE",
      "  SPLIT402_PHASE6_EMERGENCY_REVOCATION_AUDIT_LOG_EVIDENCE",
      "  SPLIT402_PHASE6_EMERGENCY_REVOCATION_RECONCILIATION_EVIDENCE",
      "Optional environment:",
      "  SPLIT402_PHASE6_EMERGENCY_REVOCATION_DRILL_DATE",
      "  SPLIT402_PHASE6_EMERGENCY_REVOCATION_DRILL_DECISION",
      "  SPLIT402_PHASE6_EMERGENCY_REVOCATION_DRILL_NOTES",
    ].join("\n"),
  );
  process.exitCode = 1;
}

function readRequiredEnv(name: string): string {
  const value = env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function isoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
