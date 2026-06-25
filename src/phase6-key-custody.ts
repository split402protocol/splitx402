import { createPhase6KeyCustodyReviewRecord } from "./phase6KeyCustodyReview.js";

const env = process.env;

try {
  console.log(
    createPhase6KeyCustodyReviewRecord({
      reviewId: readRequiredEnv("SPLIT402_PHASE6_KEY_CUSTODY_REVIEW_ID"),
      reviewDate: env.SPLIT402_PHASE6_KEY_CUSTODY_REVIEW_DATE ?? isoDate(),
      reviewers: readRequiredEnv("SPLIT402_PHASE6_KEY_CUSTODY_REVIEWERS"),
      network: readRequiredEnv("SPLIT402_KEY_CUSTODY_NETWORK"),
      fundingWallet: readRequiredEnv("SPLIT402_KEY_CUSTODY_FUNDING_WALLET"),
      sourceTokenAccount: readRequiredEnv(
        "SPLIT402_KEY_CUSTODY_SOURCE_TOKEN_ACCOUNT",
      ),
      keySource: readRequiredEnv("SPLIT402_KEY_CUSTODY_KEY_SOURCE"),
      keyOwner: readRequiredEnv("SPLIT402_KEY_CUSTODY_KEY_OWNER"),
      keyBackupPolicy: readRequiredEnv(
        "SPLIT402_KEY_CUSTODY_KEY_BACKUP_POLICY",
      ),
      keyRecoveryProcess: readRequiredEnv(
        "SPLIT402_KEY_CUSTODY_KEY_RECOVERY_PROCESS",
      ),
      accessList: readRequiredEnv("SPLIT402_KEY_CUSTODY_ACCESS_LIST").split(","),
      accessReviewRecord: readRequiredEnv(
        "SPLIT402_KEY_CUSTODY_ACCESS_REVIEW_RECORD",
      ),
      separationOfDutiesRecord: readRequiredEnv(
        "SPLIT402_KEY_CUSTODY_SEPARATION_OF_DUTIES_RECORD",
      ),
      lastRotationOrGenerationTime: readRequiredEnv(
        "SPLIT402_KEY_CUSTODY_LAST_ROTATION_OR_GENERATION_TIME",
      ),
      mainnetEnabled:
        env.SPLIT402_KEY_CUSTODY_MAINNET_ENABLED?.toLowerCase() === "true",
      reviewDecision: env.SPLIT402_PHASE6_KEY_CUSTODY_REVIEW_DECISION ?? "no-go",
      reviewNotes: env.SPLIT402_PHASE6_KEY_CUSTODY_REVIEW_NOTES ?? "",
    }),
  );
} catch (error) {
  console.error(readErrorMessage(error));
  console.error(
    [
      "Required environment:",
      "  SPLIT402_PHASE6_KEY_CUSTODY_REVIEW_ID",
      "  SPLIT402_PHASE6_KEY_CUSTODY_REVIEWERS",
      "  SPLIT402_KEY_CUSTODY_NETWORK",
      "  SPLIT402_KEY_CUSTODY_FUNDING_WALLET",
      "  SPLIT402_KEY_CUSTODY_SOURCE_TOKEN_ACCOUNT",
      "  SPLIT402_KEY_CUSTODY_KEY_SOURCE",
      "  SPLIT402_KEY_CUSTODY_KEY_OWNER",
      "  SPLIT402_KEY_CUSTODY_KEY_BACKUP_POLICY",
      "  SPLIT402_KEY_CUSTODY_KEY_RECOVERY_PROCESS",
      "  SPLIT402_KEY_CUSTODY_ACCESS_LIST",
      "  SPLIT402_KEY_CUSTODY_ACCESS_REVIEW_RECORD",
      "  SPLIT402_KEY_CUSTODY_SEPARATION_OF_DUTIES_RECORD",
      "  SPLIT402_KEY_CUSTODY_LAST_ROTATION_OR_GENERATION_TIME",
      "Optional environment:",
      "  SPLIT402_PHASE6_KEY_CUSTODY_REVIEW_DATE",
      "  SPLIT402_KEY_CUSTODY_MAINNET_ENABLED",
      "  SPLIT402_PHASE6_KEY_CUSTODY_REVIEW_DECISION",
      "  SPLIT402_PHASE6_KEY_CUSTODY_REVIEW_NOTES",
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
