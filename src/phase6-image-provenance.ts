import { execFileSync } from "node:child_process";

import { createPhase6ImageProvenanceRecord } from "./phase6ImageProvenance.js";

const env = process.env;

try {
  const signerImageDigest = readRequiredEnv("SPLIT402_SIGNER_IMAGE_DIGEST");
  const controlPlaneImageDigest = readRequiredEnv(
    "SPLIT402_CONTROL_PLANE_IMAGE_DIGEST",
  );

  console.log(
    createPhase6ImageProvenanceRecord({
      reviewId: readRequiredEnv("SPLIT402_PHASE6_IMAGE_REVIEW_ID"),
      reviewDate: env.SPLIT402_PHASE6_IMAGE_REVIEW_DATE ?? isoDate(),
      reviewers: readRequiredEnv("SPLIT402_PHASE6_IMAGE_REVIEWERS"),
      sourceCommit:
        env.SPLIT402_PHASE6_SOURCE_COMMIT ?? readCurrentGitCommit(),
      signerImageDigest,
      controlPlaneImageDigest,
      signerImageBuildCommand:
        env.SPLIT402_SIGNER_IMAGE_BUILD_COMMAND ??
        `docker build -f apps/payout-signer/Dockerfile -t ghcr.io/split402protocol/splitx402/payout-signer@${signerImageDigest} .`,
      dependencyInstallCommand:
        env.SPLIT402_DEPENDENCY_INSTALL_COMMAND ??
        "corepack pnpm install --frozen-lockfile",
      dependencyAuditCommand:
        env.SPLIT402_DEPENDENCY_AUDIT_COMMAND ??
        "corepack pnpm audit --audit-level high",
      dependencyAuditOutput: readRequiredEnv(
        "SPLIT402_DEPENDENCY_AUDIT_OUTPUT",
      ),
      buildLogRecord: readRequiredEnv("SPLIT402_BUILD_LOG_RECORD"),
      sbomRecord: readRequiredEnv("SPLIT402_SBOM_RECORD"),
      reviewDecision: env.SPLIT402_PHASE6_IMAGE_REVIEW_DECISION ?? "no-go",
      reviewNotes: env.SPLIT402_PHASE6_IMAGE_REVIEW_NOTES ?? "",
    }),
  );
} catch (error) {
  console.error(readErrorMessage(error));
  console.error(
    [
      "Required environment:",
      "  SPLIT402_PHASE6_IMAGE_REVIEW_ID",
      "  SPLIT402_PHASE6_IMAGE_REVIEWERS",
      "  SPLIT402_SIGNER_IMAGE_DIGEST",
      "  SPLIT402_CONTROL_PLANE_IMAGE_DIGEST",
      "  SPLIT402_DEPENDENCY_AUDIT_OUTPUT",
      "  SPLIT402_BUILD_LOG_RECORD",
      "  SPLIT402_SBOM_RECORD",
      "Optional environment:",
      "  SPLIT402_PHASE6_IMAGE_REVIEW_DATE",
      "  SPLIT402_PHASE6_SOURCE_COMMIT",
      "  SPLIT402_SIGNER_IMAGE_BUILD_COMMAND",
      "  SPLIT402_DEPENDENCY_INSTALL_COMMAND",
      "  SPLIT402_DEPENDENCY_AUDIT_COMMAND",
      "  SPLIT402_PHASE6_IMAGE_REVIEW_DECISION",
      "  SPLIT402_PHASE6_IMAGE_REVIEW_NOTES",
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

function readCurrentGitCommit(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

function isoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
