import { createPhase6ReconciliationDrillRecord } from "./phase6ReconciliationDrill.js";

const env = process.env;

try {
  console.log(
    createPhase6ReconciliationDrillRecord({
      drillId: readRequiredEnv("SPLIT402_PHASE6_RECONCILIATION_DRILL_ID"),
      drillDate: env.SPLIT402_PHASE6_RECONCILIATION_DRILL_DATE ?? isoDate(),
      owners: readRequiredEnv("SPLIT402_PHASE6_RECONCILIATION_OWNERS"),
      stagingEnvironment: readRequiredEnv(
        "SPLIT402_PHASE6_RECONCILIATION_STAGING_ENVIRONMENT",
      ),
      merchantId: readRequiredEnv("SPLIT402_PHASE6_RECONCILIATION_MERCHANT_ID"),
      payoutBatchId: readRequiredEnv(
        "SPLIT402_PHASE6_RECONCILIATION_PAYOUT_BATCH_ID",
      ),
      expectedSignature: readRequiredEnv(
        "SPLIT402_PHASE6_RECONCILIATION_EXPECTED_SIGNATURE",
      ),
      outcomeUnknownEvidence: readRequiredEnv(
        "SPLIT402_PHASE6_RECONCILIATION_OUTCOME_UNKNOWN_EVIDENCE",
      ),
      reconciliationListEvidence: readRequiredEnv(
        "SPLIT402_PHASE6_RECONCILIATION_LIST_EVIDENCE",
      ),
      reconcileEndpointEvidence: readRequiredEnv(
        "SPLIT402_PHASE6_RECONCILIATION_ENDPOINT_EVIDENCE",
      ),
      recommendedAction: readRequiredEnv(
        "SPLIT402_PHASE6_RECONCILIATION_RECOMMENDED_ACTION",
      ),
      persistedStatusAfterReconcile: readRequiredEnv(
        "SPLIT402_PHASE6_RECONCILIATION_PERSISTED_STATUS_AFTER_RECONCILE",
      ),
      noReplacementBytesEvidence: readRequiredEnv(
        "SPLIT402_PHASE6_RECONCILIATION_NO_REPLACEMENT_BYTES_EVIDENCE",
      ),
      drillDecision:
        env.SPLIT402_PHASE6_RECONCILIATION_DRILL_DECISION ?? "no-go",
      drillNotes: env.SPLIT402_PHASE6_RECONCILIATION_DRILL_NOTES ?? "",
    }),
  );
} catch (error) {
  console.error(readErrorMessage(error));
  console.error(
    [
      "Required environment:",
      "  SPLIT402_PHASE6_RECONCILIATION_DRILL_ID",
      "  SPLIT402_PHASE6_RECONCILIATION_OWNERS",
      "  SPLIT402_PHASE6_RECONCILIATION_STAGING_ENVIRONMENT",
      "  SPLIT402_PHASE6_RECONCILIATION_MERCHANT_ID",
      "  SPLIT402_PHASE6_RECONCILIATION_PAYOUT_BATCH_ID",
      "  SPLIT402_PHASE6_RECONCILIATION_EXPECTED_SIGNATURE",
      "  SPLIT402_PHASE6_RECONCILIATION_OUTCOME_UNKNOWN_EVIDENCE",
      "  SPLIT402_PHASE6_RECONCILIATION_LIST_EVIDENCE",
      "  SPLIT402_PHASE6_RECONCILIATION_ENDPOINT_EVIDENCE",
      "  SPLIT402_PHASE6_RECONCILIATION_RECOMMENDED_ACTION",
      "  SPLIT402_PHASE6_RECONCILIATION_PERSISTED_STATUS_AFTER_RECONCILE",
      "  SPLIT402_PHASE6_RECONCILIATION_NO_REPLACEMENT_BYTES_EVIDENCE",
      "Optional environment:",
      "  SPLIT402_PHASE6_RECONCILIATION_DRILL_DATE",
      "  SPLIT402_PHASE6_RECONCILIATION_DRILL_DECISION",
      "  SPLIT402_PHASE6_RECONCILIATION_DRILL_NOTES",
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
