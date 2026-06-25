import { createPhase6SignerSmokeReviewRecord } from "./phase6SignerSmokeReview.js";

interface SignerSmokeOutput {
  status?: unknown;
  service?: unknown;
  signerReference?: unknown;
  network?: unknown;
  metrics?: {
    requestsTotal?: unknown;
    signedTotal?: unknown;
    rejectedTotal?: unknown;
  };
}

const env = process.env;

try {
  const smokeOutput = parseSmokeOutput(
    env.SPLIT402_PHASE6_SIGNER_SMOKE_OUTPUT_JSON,
  );

  console.log(
    createPhase6SignerSmokeReviewRecord({
      reviewId: readRequiredEnv("SPLIT402_PHASE6_SIGNER_SMOKE_REVIEW_ID"),
      reviewDate: env.SPLIT402_PHASE6_SIGNER_SMOKE_REVIEW_DATE ?? isoDate(),
      reviewers: readRequiredEnv("SPLIT402_PHASE6_SIGNER_SMOKE_REVIEWERS"),
      stagingEnvironment: readRequiredEnv(
        "SPLIT402_PHASE6_SIGNER_SMOKE_STAGING_ENVIRONMENT",
      ),
      smokeStatus: readOutputString(
        smokeOutput?.status,
        "SPLIT402_PHASE6_SIGNER_SMOKE_STATUS",
      ),
      smokeService: readOutputString(
        smokeOutput?.service,
        "SPLIT402_PHASE6_SIGNER_SMOKE_SERVICE",
      ),
      signerReference: readOutputString(
        smokeOutput?.signerReference,
        "SPLIT402_PHASE6_SIGNER_SMOKE_SIGNER_REFERENCE",
      ),
      network: readOutputString(
        smokeOutput?.network,
        "SPLIT402_PHASE6_SIGNER_SMOKE_NETWORK",
      ),
      requestsTotal: readOutputString(
        smokeOutput?.metrics?.requestsTotal,
        "SPLIT402_PHASE6_SIGNER_SMOKE_REQUESTS_TOTAL",
      ),
      signedTotal: readOutputString(
        smokeOutput?.metrics?.signedTotal,
        "SPLIT402_PHASE6_SIGNER_SMOKE_SIGNED_TOTAL",
      ),
      rejectedTotal: readOutputString(
        smokeOutput?.metrics?.rejectedTotal,
        "SPLIT402_PHASE6_SIGNER_SMOKE_REJECTED_TOTAL",
      ),
      healthReadyMetricsEvidence: readRequiredEnv(
        "SPLIT402_PHASE6_SIGNER_SMOKE_HEALTH_READY_METRICS_EVIDENCE",
      ),
      endpointSecretExposureEvidence: readRequiredEnv(
        "SPLIT402_PHASE6_SIGNER_SMOKE_ENDPOINT_SECRET_EXPOSURE_EVIDENCE",
      ),
      auditLogSecretExposureEvidence: readRequiredEnv(
        "SPLIT402_PHASE6_SIGNER_SMOKE_AUDIT_LOG_SECRET_EXPOSURE_EVIDENCE",
      ),
      reviewDecision: env.SPLIT402_PHASE6_SIGNER_SMOKE_REVIEW_DECISION ?? "no-go",
      reviewNotes: env.SPLIT402_PHASE6_SIGNER_SMOKE_REVIEW_NOTES ?? "",
    }),
  );
} catch (error) {
  console.error(readErrorMessage(error));
  console.error(
    [
      "Required environment:",
      "  SPLIT402_PHASE6_SIGNER_SMOKE_REVIEW_ID",
      "  SPLIT402_PHASE6_SIGNER_SMOKE_REVIEWERS",
      "  SPLIT402_PHASE6_SIGNER_SMOKE_STAGING_ENVIRONMENT",
      "  SPLIT402_PHASE6_SIGNER_SMOKE_HEALTH_READY_METRICS_EVIDENCE",
      "  SPLIT402_PHASE6_SIGNER_SMOKE_ENDPOINT_SECRET_EXPOSURE_EVIDENCE",
      "  SPLIT402_PHASE6_SIGNER_SMOKE_AUDIT_LOG_SECRET_EXPOSURE_EVIDENCE",
      "  SPLIT402_PHASE6_SIGNER_SMOKE_OUTPUT_JSON",
      "Or, instead of SPLIT402_PHASE6_SIGNER_SMOKE_OUTPUT_JSON:",
      "  SPLIT402_PHASE6_SIGNER_SMOKE_STATUS",
      "  SPLIT402_PHASE6_SIGNER_SMOKE_SERVICE",
      "  SPLIT402_PHASE6_SIGNER_SMOKE_SIGNER_REFERENCE",
      "  SPLIT402_PHASE6_SIGNER_SMOKE_NETWORK",
      "  SPLIT402_PHASE6_SIGNER_SMOKE_REQUESTS_TOTAL",
      "  SPLIT402_PHASE6_SIGNER_SMOKE_SIGNED_TOTAL",
      "  SPLIT402_PHASE6_SIGNER_SMOKE_REJECTED_TOTAL",
      "Optional environment:",
      "  SPLIT402_PHASE6_SIGNER_SMOKE_REVIEW_DATE",
      "  SPLIT402_PHASE6_SIGNER_SMOKE_REVIEW_DECISION",
      "  SPLIT402_PHASE6_SIGNER_SMOKE_REVIEW_NOTES",
    ].join("\n"),
  );
  process.exitCode = 1;
}

function parseSmokeOutput(value: string | undefined): SignerSmokeOutput | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  const parsed = JSON.parse(value) as unknown;
  if (parsed === null || typeof parsed !== "object") {
    throw new Error("SPLIT402_PHASE6_SIGNER_SMOKE_OUTPUT_JSON must be an object");
  }
  return parsed as SignerSmokeOutput;
}

function readOutputString(outputValue: unknown, envName: string): string {
  if (outputValue !== undefined) {
    return String(outputValue);
  }
  return readRequiredEnv(envName);
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
