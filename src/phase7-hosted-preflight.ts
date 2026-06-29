import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { loadEvidenceEnvFiles } from "./evidenceEnvFile.js";
import { runPhase7HostedStagingPreflight } from "./phase7HostedStagingPreflight.js";

const env = process.env;

try {
  loadEvidenceEnvFiles({
    argv: process.argv.slice(2),
    defaultEnvFiles: [
      "split402-launch-evidence/phase7-staging.env",
      "phase7-staging-evidence/phase7-staging.env",
    ],
  });
  const outputDir =
    readOptionalEnv("SPLIT402_PHASE7_HOSTED_PREFLIGHT_OUTPUT_DIR") ??
    readOptionalEnv("SPLIT402_PHASE7_EVIDENCE_DIR") ??
    "phase7-staging-evidence";
  mkdirSync(outputDir, { recursive: true });

  const report = await runPhase7HostedStagingPreflight({
    controlPlaneUrl: readRequiredEnv("SPLIT402_PHASE7_CONTROL_PLANE_URL"),
    dashboardUrl: readRequiredEnv("SPLIT402_PHASE7_DASHBOARD_URL"),
    sourceCommit:
      readOptionalEnv("SPLIT402_PHASE7_SOURCE_COMMIT") ?? readCurrentGitCommit(),
    outputDir,
    ...(readOptionalEnv("SPLIT402_DASHBOARD_VIEWER_TOKEN") === undefined
      ? {}
      : {
          dashboardViewerToken: readOptionalEnv("SPLIT402_DASHBOARD_VIEWER_TOKEN"),
        }),
    fetch,
    writeArtifact: (path, text) => writeFileSync(path, text),
    joinPath: (directory, fileName) => join(directory, fileName),
  });

  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(
    [
      "Usage: corepack pnpm phase7:hosted:preflight",
      "Env file options:",
      "  --evidence-env-file <path> (optional; defaults to split402-launch-evidence/phase7-staging.env when present)",
      "  SPLIT402_ENV_FILE=<path> (optional; uses platform path separator for multiple files)",
      "Required environment:",
      "  SPLIT402_PHASE7_CONTROL_PLANE_URL",
      "  SPLIT402_PHASE7_DASHBOARD_URL",
      "  SPLIT402_PHASE7_SOURCE_COMMIT (optional; defaults to git rev-parse HEAD)",
      "Optional environment:",
      "  SPLIT402_DASHBOARD_VIEWER_TOKEN",
      "  SPLIT402_PHASE7_HOSTED_PREFLIGHT_OUTPUT_DIR",
      "  SPLIT402_PHASE7_EVIDENCE_DIR",
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

function readCurrentGitCommit(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}
