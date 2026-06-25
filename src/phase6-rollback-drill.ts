import { createPhase6RollbackDrillRecord } from "./phase6RollbackDrill.js";

const env = process.env;

try {
  console.log(
    createPhase6RollbackDrillRecord({
      drillId: readRequiredEnv("SPLIT402_PHASE6_ROLLBACK_DRILL_ID"),
      drillDate: env.SPLIT402_PHASE6_ROLLBACK_DRILL_DATE ?? isoDate(),
      owners: readRequiredEnv("SPLIT402_PHASE6_ROLLBACK_OWNERS"),
      stagingEnvironment: readRequiredEnv(
        "SPLIT402_PHASE6_ROLLBACK_STAGING_ENVIRONMENT",
      ),
      currentSignerImageDigest: readRequiredEnv(
        "SPLIT402_PHASE6_ROLLBACK_CURRENT_SIGNER_IMAGE_DIGEST",
      ),
      lastKnownGoodSignerImageDigest: readRequiredEnv(
        "SPLIT402_PHASE6_ROLLBACK_LAST_KNOWN_GOOD_SIGNER_IMAGE_DIGEST",
      ),
      currentSecretSetReference: readRequiredEnv(
        "SPLIT402_PHASE6_ROLLBACK_CURRENT_SECRET_SET_REFERENCE",
      ),
      lastKnownGoodSecretSetReference: readRequiredEnv(
        "SPLIT402_PHASE6_ROLLBACK_LAST_KNOWN_GOOD_SECRET_SET_REFERENCE",
      ),
      payoutBatchCreationPausedAt: readRequiredEnv(
        "SPLIT402_PHASE6_ROLLBACK_PAYOUT_BATCH_CREATION_PAUSED_AT",
      ),
      rollbackStartedAt: readRequiredEnv(
        "SPLIT402_PHASE6_ROLLBACK_STARTED_AT",
      ),
      rollbackCompletedAt: readRequiredEnv(
        "SPLIT402_PHASE6_ROLLBACK_COMPLETED_AT",
      ),
      readinessAfterRollback: readRequiredEnv(
        "SPLIT402_PHASE6_ROLLBACK_READINESS_AFTER_ROLLBACK",
      ),
      metricsAfterRollback: readRequiredEnv(
        "SPLIT402_PHASE6_ROLLBACK_METRICS_AFTER_ROLLBACK",
      ),
      reconciliationRecords: readRequiredEnv(
        "SPLIT402_PHASE6_ROLLBACK_RECONCILIATION_RECORDS",
      ),
      batchCreationResumedAt: readRequiredEnv(
        "SPLIT402_PHASE6_ROLLBACK_BATCH_CREATION_RESUMED_AT",
      ),
      drillDecision: env.SPLIT402_PHASE6_ROLLBACK_DRILL_DECISION ?? "no-go",
      drillNotes: env.SPLIT402_PHASE6_ROLLBACK_DRILL_NOTES ?? "",
    }),
  );
} catch (error) {
  console.error(readErrorMessage(error));
  console.error(
    [
      "Required environment:",
      "  SPLIT402_PHASE6_ROLLBACK_DRILL_ID",
      "  SPLIT402_PHASE6_ROLLBACK_OWNERS",
      "  SPLIT402_PHASE6_ROLLBACK_STAGING_ENVIRONMENT",
      "  SPLIT402_PHASE6_ROLLBACK_CURRENT_SIGNER_IMAGE_DIGEST",
      "  SPLIT402_PHASE6_ROLLBACK_LAST_KNOWN_GOOD_SIGNER_IMAGE_DIGEST",
      "  SPLIT402_PHASE6_ROLLBACK_CURRENT_SECRET_SET_REFERENCE",
      "  SPLIT402_PHASE6_ROLLBACK_LAST_KNOWN_GOOD_SECRET_SET_REFERENCE",
      "  SPLIT402_PHASE6_ROLLBACK_PAYOUT_BATCH_CREATION_PAUSED_AT",
      "  SPLIT402_PHASE6_ROLLBACK_STARTED_AT",
      "  SPLIT402_PHASE6_ROLLBACK_COMPLETED_AT",
      "  SPLIT402_PHASE6_ROLLBACK_READINESS_AFTER_ROLLBACK",
      "  SPLIT402_PHASE6_ROLLBACK_METRICS_AFTER_ROLLBACK",
      "  SPLIT402_PHASE6_ROLLBACK_RECONCILIATION_RECORDS",
      "  SPLIT402_PHASE6_ROLLBACK_BATCH_CREATION_RESUMED_AT",
      "Optional environment:",
      "  SPLIT402_PHASE6_ROLLBACK_DRILL_DATE",
      "  SPLIT402_PHASE6_ROLLBACK_DRILL_DECISION",
      "  SPLIT402_PHASE6_ROLLBACK_DRILL_NOTES",
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
