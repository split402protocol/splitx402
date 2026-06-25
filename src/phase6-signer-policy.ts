import { createPhase6SignerPolicyReviewRecord } from "./phase6SignerPolicyReview.js";

const env = process.env;

try {
  console.log(
    createPhase6SignerPolicyReviewRecord({
      reviewId: readRequiredEnv("SPLIT402_PHASE6_SIGNER_POLICY_REVIEW_ID"),
      reviewDate: env.SPLIT402_PHASE6_SIGNER_POLICY_REVIEW_DATE ?? isoDate(),
      reviewers: readRequiredEnv("SPLIT402_PHASE6_SIGNER_POLICY_REVIEWERS"),
      network: readRequiredEnv("SPLIT402_SIGNER_POLICY_NETWORK"),
      fundingWallet: readRequiredEnv("SPLIT402_SIGNER_POLICY_FUNDING_WALLET"),
      sourceTokenAccount: readRequiredEnv(
        "SPLIT402_SIGNER_POLICY_SOURCE_TOKEN_ACCOUNT",
      ),
      mint: readRequiredEnv("SPLIT402_SIGNER_POLICY_MINT"),
      allowedTokenProgramIds: readRequiredEnv(
        "SPLIT402_SIGNER_POLICY_ALLOWED_TOKEN_PROGRAM_IDS",
      ).split(","),
      maxTransactionAmountAtomic: readRequiredEnv(
        "SPLIT402_SIGNER_POLICY_MAX_TRANSACTION_AMOUNT_ATOMIC",
      ),
      maxBatchAmountAtomic: readRequiredEnv(
        "SPLIT402_SIGNER_POLICY_MAX_BATCH_AMOUNT_ATOMIC",
      ),
      expectedDestinationAmountListHash: readRequiredEnv(
        "SPLIT402_SIGNER_POLICY_EXPECTED_DESTINATION_AMOUNT_LIST_HASH",
      ),
      requireSuccessfulSimulation:
        readRequiredEnv(
          "SPLIT402_SIGNER_POLICY_REQUIRE_SUCCESSFUL_SIMULATION",
        ).toLowerCase() === "true",
      signerReference: readRequiredEnv("SPLIT402_SIGNER_POLICY_SIGNER_REFERENCE"),
      reviewDecision: env.SPLIT402_PHASE6_SIGNER_POLICY_REVIEW_DECISION ?? "no-go",
      reviewNotes: env.SPLIT402_PHASE6_SIGNER_POLICY_REVIEW_NOTES ?? "",
    }),
  );
} catch (error) {
  console.error(readErrorMessage(error));
  console.error(
    [
      "Required environment:",
      "  SPLIT402_PHASE6_SIGNER_POLICY_REVIEW_ID",
      "  SPLIT402_PHASE6_SIGNER_POLICY_REVIEWERS",
      "  SPLIT402_SIGNER_POLICY_NETWORK",
      "  SPLIT402_SIGNER_POLICY_FUNDING_WALLET",
      "  SPLIT402_SIGNER_POLICY_SOURCE_TOKEN_ACCOUNT",
      "  SPLIT402_SIGNER_POLICY_MINT",
      "  SPLIT402_SIGNER_POLICY_ALLOWED_TOKEN_PROGRAM_IDS",
      "  SPLIT402_SIGNER_POLICY_MAX_TRANSACTION_AMOUNT_ATOMIC",
      "  SPLIT402_SIGNER_POLICY_MAX_BATCH_AMOUNT_ATOMIC",
      "  SPLIT402_SIGNER_POLICY_EXPECTED_DESTINATION_AMOUNT_LIST_HASH",
      "  SPLIT402_SIGNER_POLICY_REQUIRE_SUCCESSFUL_SIMULATION=true",
      "  SPLIT402_SIGNER_POLICY_SIGNER_REFERENCE",
      "Optional environment:",
      "  SPLIT402_PHASE6_SIGNER_POLICY_REVIEW_DATE",
      "  SPLIT402_PHASE6_SIGNER_POLICY_REVIEW_DECISION",
      "  SPLIT402_PHASE6_SIGNER_POLICY_REVIEW_NOTES",
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
