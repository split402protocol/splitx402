import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { loadEvidenceEnvFiles } from "./evidenceEnvFile.js";
import { derivePhase7ReceiptVerificationEvidence } from "./phase7ReceiptVerificationEvidence.js";

try {
  const cli = loadEvidenceEnvFiles({
    argv: process.argv.slice(2),
    defaultEnvFiles: [
      "split402-launch-evidence/phase7-staging.env",
      "phase7-staging-evidence/phase7-staging.env",
    ],
  });
  const evidenceDir =
    readOptionalEnv("SPLIT402_PHASE7_EVIDENCE_DIR") ??
    "phase7-staging-evidence";
  const paidSuiteLogPath =
    cli.args[0] ??
    readOptionalEnv("SPLIT402_PHASE7_PAID_SUITE_LOG") ??
    join(evidenceDir, "paid-suite.log");
  const outputPath =
    cli.args[1] ??
    readOptionalEnv("SPLIT402_PHASE7_RECEIPT_VERIFICATION_OUTPUT") ??
    join(evidenceDir, "receipt-verification.json");

  mkdirSync(dirname(outputPath), { recursive: true });
  const evidence = derivePhase7ReceiptVerificationEvidence({
    paidSuiteLogPath,
    outputPath,
    readArtifact: (path) => readFileSync(path),
    writeArtifact: (path, text) => writeFileSync(path, text),
  });

  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(
    [
      "Usage: corepack pnpm phase7:staging:derive-receipt-verification [paid-suite.log] [receipt-verification.json]",
      "Env file options:",
      "  --evidence-env-file <path> (optional; defaults to split402-launch-evidence/phase7-staging.env when present)",
      "  SPLIT402_ENV_FILE=<path> (optional; uses platform path separator for multiple files)",
      "Optional environment:",
      "  SPLIT402_PHASE7_EVIDENCE_DIR",
      "  SPLIT402_PHASE7_PAID_SUITE_LOG",
      "  SPLIT402_PHASE7_RECEIPT_VERIFICATION_OUTPUT",
    ].join("\n"),
  );
  process.exitCode = 1;
}

function readOptionalEnv(envName: string): string | undefined {
  const value = process.env[envName];
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  return value.trim();
}
