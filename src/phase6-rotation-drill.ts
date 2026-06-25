import { createPhase6RotationDrillRecord } from "./phase6RotationDrill.js";

const env = process.env;

try {
  console.log(
    createPhase6RotationDrillRecord({
      drillId: readRequiredEnv("SPLIT402_PHASE6_ROTATION_DRILL_ID"),
      drillDate: env.SPLIT402_PHASE6_ROTATION_DRILL_DATE ?? isoDate(),
      owners: readRequiredEnv("SPLIT402_PHASE6_ROTATION_OWNERS"),
      stagingEnvironment: readRequiredEnv(
        "SPLIT402_PHASE6_ROTATION_STAGING_ENVIRONMENT",
      ),
      previousKeyId: readRequiredEnv("SPLIT402_PHASE6_ROTATION_PREVIOUS_KEY_ID"),
      currentKeyId: readRequiredEnv("SPLIT402_PHASE6_ROTATION_CURRENT_KEY_ID"),
      dualActiveDeployTime: readRequiredEnv(
        "SPLIT402_PHASE6_ROTATION_DUAL_ACTIVE_DEPLOY_TIME",
      ),
      controlPlaneRotationTime: readRequiredEnv(
        "SPLIT402_PHASE6_ROTATION_CONTROL_PLANE_ROTATION_TIME",
      ),
      retiredKeyDeployTime: readRequiredEnv(
        "SPLIT402_PHASE6_ROTATION_RETIRED_KEY_DEPLOY_TIME",
      ),
      currentKeyTrafficEvidence: readRequiredEnv(
        "SPLIT402_PHASE6_ROTATION_CURRENT_KEY_TRAFFIC_EVIDENCE",
      ),
      previousKeyRetiredEvidence: readRequiredEnv(
        "SPLIT402_PHASE6_ROTATION_PREVIOUS_KEY_RETIRED_EVIDENCE",
      ),
      healthEvidence: readRequiredEnv("SPLIT402_PHASE6_ROTATION_HEALTH_EVIDENCE"),
      metricsEvidence: readRequiredEnv(
        "SPLIT402_PHASE6_ROTATION_METRICS_EVIDENCE",
      ),
      auditLogEvidence: readRequiredEnv(
        "SPLIT402_PHASE6_ROTATION_AUDIT_LOG_EVIDENCE",
      ),
      drillDecision: env.SPLIT402_PHASE6_ROTATION_DRILL_DECISION ?? "no-go",
      drillNotes: env.SPLIT402_PHASE6_ROTATION_DRILL_NOTES ?? "",
    }),
  );
} catch (error) {
  console.error(readErrorMessage(error));
  console.error(
    [
      "Required environment:",
      "  SPLIT402_PHASE6_ROTATION_DRILL_ID",
      "  SPLIT402_PHASE6_ROTATION_OWNERS",
      "  SPLIT402_PHASE6_ROTATION_STAGING_ENVIRONMENT",
      "  SPLIT402_PHASE6_ROTATION_PREVIOUS_KEY_ID",
      "  SPLIT402_PHASE6_ROTATION_CURRENT_KEY_ID",
      "  SPLIT402_PHASE6_ROTATION_DUAL_ACTIVE_DEPLOY_TIME",
      "  SPLIT402_PHASE6_ROTATION_CONTROL_PLANE_ROTATION_TIME",
      "  SPLIT402_PHASE6_ROTATION_RETIRED_KEY_DEPLOY_TIME",
      "  SPLIT402_PHASE6_ROTATION_CURRENT_KEY_TRAFFIC_EVIDENCE",
      "  SPLIT402_PHASE6_ROTATION_PREVIOUS_KEY_RETIRED_EVIDENCE",
      "  SPLIT402_PHASE6_ROTATION_HEALTH_EVIDENCE",
      "  SPLIT402_PHASE6_ROTATION_METRICS_EVIDENCE",
      "  SPLIT402_PHASE6_ROTATION_AUDIT_LOG_EVIDENCE",
      "Optional environment:",
      "  SPLIT402_PHASE6_ROTATION_DRILL_DATE",
      "  SPLIT402_PHASE6_ROTATION_DRILL_DECISION",
      "  SPLIT402_PHASE6_ROTATION_DRILL_NOTES",
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
