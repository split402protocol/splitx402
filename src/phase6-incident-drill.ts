import { createPhase6IncidentDrillRecord } from "./phase6IncidentDrill.js";

const env = process.env;

try {
  console.log(
    createPhase6IncidentDrillRecord({
      drillId: readRequiredEnv("SPLIT402_PHASE6_INCIDENT_DRILL_ID"),
      scenario: readRequiredEnv("SPLIT402_PHASE6_INCIDENT_SCENARIO"),
      startedAt: readRequiredEnv("SPLIT402_PHASE6_INCIDENT_STARTED_AT"),
      endedAt: readRequiredEnv("SPLIT402_PHASE6_INCIDENT_ENDED_AT"),
      incidentCommander: readRequiredEnv(
        "SPLIT402_PHASE6_INCIDENT_COMMANDER",
      ),
      controlPlaneOperator: readRequiredEnv(
        "SPLIT402_PHASE6_INCIDENT_CONTROL_PLANE_OPERATOR",
      ),
      signerOperator: readRequiredEnv(
        "SPLIT402_PHASE6_INCIDENT_SIGNER_OPERATOR",
      ),
      chainOperator: readRequiredEnv("SPLIT402_PHASE6_INCIDENT_CHAIN_OPERATOR"),
      reviewer: readRequiredEnv("SPLIT402_PHASE6_INCIDENT_REVIEWER"),
      sourceCommit: readRequiredEnv("SPLIT402_PHASE6_INCIDENT_SOURCE_COMMIT"),
      signerImageDigest: readRequiredEnv(
        "SPLIT402_PHASE6_INCIDENT_SIGNER_IMAGE_DIGEST",
      ),
      signerReference: readRequiredEnv(
        "SPLIT402_PHASE6_INCIDENT_SIGNER_REFERENCE",
      ),
      network: readRequiredEnv("SPLIT402_PHASE6_INCIDENT_NETWORK"),
      fundingWallet: readRequiredEnv("SPLIT402_PHASE6_INCIDENT_FUNDING_WALLET"),
      affectedBatchIds: readRequiredEnv(
        "SPLIT402_PHASE6_INCIDENT_AFFECTED_BATCH_IDS",
      ),
      payoutCreationPausedEvidence: readRequiredEnv(
        "SPLIT402_PHASE6_INCIDENT_PAYOUT_CREATION_PAUSED_EVIDENCE",
      ),
      smokeCheckOutput: readRequiredEnv(
        "SPLIT402_PHASE6_INCIDENT_SMOKE_CHECK_OUTPUT",
      ),
      metricsBefore: readRequiredEnv("SPLIT402_PHASE6_INCIDENT_METRICS_BEFORE"),
      metricsAfter: readRequiredEnv("SPLIT402_PHASE6_INCIDENT_METRICS_AFTER"),
      auditLogSample: readRequiredEnv(
        "SPLIT402_PHASE6_INCIDENT_AUDIT_LOG_SAMPLE",
      ),
      reconciliationReports: readRequiredEnv(
        "SPLIT402_PHASE6_INCIDENT_RECONCILIATION_REPORTS",
      ),
      noReplacementBytesEvidence: readRequiredEnv(
        "SPLIT402_PHASE6_INCIDENT_NO_REPLACEMENT_BYTES_EVIDENCE",
      ),
      resumeEvidence: readRequiredEnv(
        "SPLIT402_PHASE6_INCIDENT_RESUME_EVIDENCE",
      ),
      drillDecision: env.SPLIT402_PHASE6_INCIDENT_DRILL_DECISION ?? "no-go",
      followUpActions: env.SPLIT402_PHASE6_INCIDENT_FOLLOW_UP_ACTIONS ?? "",
    }),
  );
} catch (error) {
  console.error(readErrorMessage(error));
  console.error(
    [
      "Required environment:",
      "  SPLIT402_PHASE6_INCIDENT_DRILL_ID",
      "  SPLIT402_PHASE6_INCIDENT_SCENARIO",
      "  SPLIT402_PHASE6_INCIDENT_STARTED_AT",
      "  SPLIT402_PHASE6_INCIDENT_ENDED_AT",
      "  SPLIT402_PHASE6_INCIDENT_COMMANDER",
      "  SPLIT402_PHASE6_INCIDENT_CONTROL_PLANE_OPERATOR",
      "  SPLIT402_PHASE6_INCIDENT_SIGNER_OPERATOR",
      "  SPLIT402_PHASE6_INCIDENT_CHAIN_OPERATOR",
      "  SPLIT402_PHASE6_INCIDENT_REVIEWER",
      "  SPLIT402_PHASE6_INCIDENT_SOURCE_COMMIT",
      "  SPLIT402_PHASE6_INCIDENT_SIGNER_IMAGE_DIGEST",
      "  SPLIT402_PHASE6_INCIDENT_SIGNER_REFERENCE",
      "  SPLIT402_PHASE6_INCIDENT_NETWORK",
      "  SPLIT402_PHASE6_INCIDENT_FUNDING_WALLET",
      "  SPLIT402_PHASE6_INCIDENT_AFFECTED_BATCH_IDS",
      "  SPLIT402_PHASE6_INCIDENT_PAYOUT_CREATION_PAUSED_EVIDENCE",
      "  SPLIT402_PHASE6_INCIDENT_SMOKE_CHECK_OUTPUT",
      "  SPLIT402_PHASE6_INCIDENT_METRICS_BEFORE",
      "  SPLIT402_PHASE6_INCIDENT_METRICS_AFTER",
      "  SPLIT402_PHASE6_INCIDENT_AUDIT_LOG_SAMPLE",
      "  SPLIT402_PHASE6_INCIDENT_RECONCILIATION_REPORTS",
      "  SPLIT402_PHASE6_INCIDENT_NO_REPLACEMENT_BYTES_EVIDENCE",
      "  SPLIT402_PHASE6_INCIDENT_RESUME_EVIDENCE",
      "Optional environment:",
      "  SPLIT402_PHASE6_INCIDENT_DRILL_DECISION",
      "  SPLIT402_PHASE6_INCIDENT_FOLLOW_UP_ACTIONS",
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

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
