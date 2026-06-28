import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { collectPhase7ReadArtifacts } from "./phase7StagingReadCollector.js";

const env = process.env;

try {
  const outputDir =
    readOptionalEnv("SPLIT402_PHASE7_READ_OUTPUT_DIR") ??
    readOptionalEnv("SPLIT402_PHASE7_EVIDENCE_DIR") ??
    "phase7-staging-evidence";
  mkdirSync(outputDir, { recursive: true });

  const report = await collectPhase7ReadArtifacts({
    controlPlaneUrl: readRequiredEnv("SPLIT402_PHASE7_CONTROL_PLANE_URL"),
    merchantId: readRequiredEnv("SPLIT402_PHASE7_MERCHANT_ID"),
    referrerWallet: readRequiredEnv("SPLIT402_PHASE7_REFERRER_WALLET"),
    outputDir,
    ...(readOptionalEnv("SPLIT402_PHASE7_CONTROL_PLANE_TOKEN") === undefined
      ? {}
      : {
          bearerToken: readOptionalEnv("SPLIT402_PHASE7_CONTROL_PLANE_TOKEN"),
        }),
    ...(readOptionalEnv("SPLIT402_PHASE7_WEBHOOK_STATUS") === undefined
      ? {}
      : { webhookStatus: readOptionalEnv("SPLIT402_PHASE7_WEBHOOK_STATUS") }),
    fetch,
    writeArtifact: (path, text) => writeFileSync(path, text),
    joinPath: (directory, fileName) => join(directory, fileName),
  });

  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(
    [
      "Usage: corepack pnpm phase7:staging:collect-reads",
      "Required environment:",
      "  SPLIT402_PHASE7_CONTROL_PLANE_URL",
      "  SPLIT402_PHASE7_MERCHANT_ID",
      "  SPLIT402_PHASE7_REFERRER_WALLET",
      "Optional environment:",
      "  SPLIT402_PHASE7_CONTROL_PLANE_TOKEN",
      "  SPLIT402_PHASE7_EVIDENCE_DIR",
      "  SPLIT402_PHASE7_READ_OUTPUT_DIR",
      "  SPLIT402_PHASE7_WEBHOOK_STATUS",
    ].join("\n"),
  );
  process.exitCode = 1;
}

function readRequiredEnv(envName: string): string {
  const value = readOptionalEnv(envName);
  if (value === undefined) {
    throw new Error(`${envName} is required`);
  }
  return value;
}

function readOptionalEnv(envName: string): string | undefined {
  const value = env[envName];
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  return value.trim();
}
