import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { loadEvidenceEnvFiles } from "./evidenceEnvFile.js";
import { collectPhase7McpGatewayEvidence } from "./phase7McpGatewayEvidence.js";

try {
  loadEvidenceEnvFiles({
    argv: process.argv.slice(2),
    defaultEnvFiles: [
      "split402-launch-evidence/phase7-staging.env",
      "phase7-staging-evidence/phase7-staging.env",
    ],
  });
  const outputDir =
    readOptionalEnv("SPLIT402_PHASE7_MCP_GATEWAY_OUTPUT_DIR") ??
    readOptionalEnv("SPLIT402_PHASE7_EVIDENCE_DIR") ??
    "phase7-staging-evidence";
  mkdirSync(outputDir, { recursive: true });

  const report = await collectPhase7McpGatewayEvidence({
    outputDir,
    env: process.env,
    fetch,
    writeArtifact: (path, text) => writeFileSync(path, text),
    joinPath: (directory, fileName) => join(directory, fileName),
  });

  console.log(JSON.stringify(report, null, 2));
  if (!report.proofReady) {
    console.error(report.blockers.join("\n"));
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(
    [
      "Usage: corepack pnpm phase7:staging:collect-mcp-gateway",
      "Env file options:",
      "  --evidence-env-file <path> (optional; defaults to split402-launch-evidence/phase7-staging.env when present)",
      "  SPLIT402_ENV_FILE=<path> (optional; uses platform path separator for multiple files)",
      "Optional environment:",
      "  SPLIT402_PHASE7_EVIDENCE_DIR",
      "  SPLIT402_PHASE7_MCP_GATEWAY_OUTPUT_DIR",
      "  SPLIT402_MCP_CONTROL_PLANE_URL",
      "  SPLIT402_MCP_CONTROL_PLANE_TOKEN",
      "  SPLIT402_MCP_CAPABILITY",
      "  SPLIT402_MCP_WALLET",
      "  SPLIT402_MCP_MAX_AMOUNT_ATOMIC",
      "  SPLIT402_MCP_RESOURCE_ORIGIN",
      "  SPLIT402_MCP_OPERATION_ID",
      "  SPLIT402_MCP_DISCOVERY_LIMIT",
      "  SPLIT402_PHASE7_MCP_GATEWAY_EXECUTE",
      "  SPLIT402_MCP_SVM_PRIVATE_KEY",
      "  SVM_PRIVATE_KEY",
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
