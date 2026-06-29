import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createPhase7StagingEvidenceWorkspace } from "./phase7StagingEvidenceWorkspace.js";

export const PHASE7_STAGING_INIT_USAGE =
  "Usage: corepack pnpm phase7:staging:init [evidence-directory]";

export interface Phase7StagingInitCliArgs {
  directory: string;
  help: boolean;
}

if (isMainModule()) {
  main();
}

function main(): void {
  const { directory, help } = parseArgs();

  if (help) {
    console.log(PHASE7_STAGING_INIT_USAGE);
    process.exit(0);
  }

  const workspace = createPhase7StagingEvidenceWorkspace({ directory });

  mkdirSync(workspace.directory, { recursive: true });
  const envFilePath = workspace.envFilePath;
  writeFileSync(
    join(workspace.directory, workspace.readmeFileName),
    workspace.readmeText,
  );
  writeFileSync(envFilePath, workspace.envText);

  console.log(
    JSON.stringify(
      {
        schema: "split402.phase7_staging_init.v1",
        evidenceDirectory: workspace.directory,
        envFile: envFilePath,
        readmeFile: join(workspace.directory, workspace.readmeFileName),
        artifactFilesToCapture: workspace.artifacts.map((artifact) => ({
          field: artifact.field,
          path: join(workspace.directory, artifact.fileName),
        })),
        nextCommands: [
          "Fill direct SPLIT402_PHASE7_* proof fields.",
          `Use ${envFilePath} for SPLIT402_PHASE7_ASSEMBLE_* attachment paths.`,
          "Capture real staging outputs into the listed artifact files.",
          "SPLIT402_PHASE7_SEED_CONFIRM=seed-hosted-staging corepack pnpm phase7:staging:seed",
          `corepack pnpm phase7:staging-proof --evidence-env-file ${envFilePath} phase7-staging-proof.txt`,
          `corepack pnpm phase7:hosted:preflight --evidence-env-file ${envFilePath}`,
          "Confirm hosted control plane has SPLIT402_FUNDING_BALANCE_PROVIDER=solana-rpc before read collection.",
          `corepack pnpm phase7:staging:collect-reads --evidence-env-file ${envFilePath}`,
          "Fill SPLIT402_MCP_* hosted proof variables and use a funded buyer key before MCP collection.",
          `SPLIT402_PHASE7_MCP_GATEWAY_EXECUTE=1 corepack pnpm phase7:staging:collect-mcp-gateway --evidence-env-file ${envFilePath}`,
          "corepack pnpm demo:mcp-gateway:smoke",
          `corepack pnpm demo:mcp-bundle ${workspace.directory}/mcp-bundle.json`,
          `corepack pnpm demo:paid-suite ${workspace.directory}/paid-suite.log`,
          `corepack pnpm phase7:staging:derive-receipt-verification --evidence-env-file ${envFilePath} ${workspace.directory}/paid-suite.log ${workspace.directory}/receipt-verification.json`,
          `corepack pnpm phase7:staging:manifest phase7-staging-proof.txt ${workspace.directory}/artifact-manifest.json`,
          `corepack pnpm phase7:staging:assemble --evidence-env-file ${envFilePath} phase7-staging-proof.txt`,
          "corepack pnpm phase7:staging:status phase7-staging-proof.txt",
          "Record the commands above plus lint, typecheck, test, build, vectors:check, and audit in commands.log.",
        ],
      },
      null,
      2,
    ),
  );
}

export function parsePhase7StagingInitCliArgs(
  args: readonly string[],
): Phase7StagingInitCliArgs {
  const help = args.includes("--help") || args.includes("-h");
  const unknownOptions = args.filter(
    (arg) => arg.startsWith("-") && arg !== "--help" && arg !== "-h",
  );
  if (unknownOptions.length > 0) {
    throw new Error(
      `${PHASE7_STAGING_INIT_USAGE}\nUnknown option: ${unknownOptions[0]}`,
    );
  }

  const positionalArgs = args.filter((arg) => arg !== "--help" && arg !== "-h");
  if (positionalArgs.length > 1) {
    throw new Error(PHASE7_STAGING_INIT_USAGE);
  }

  return {
    directory: help
      ? "phase7-staging-evidence"
      : positionalArgs[0] ?? "phase7-staging-evidence",
    help,
  };
}

function parseArgs(): Phase7StagingInitCliArgs {
  try {
    return parsePhase7StagingInitCliArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function isMainModule(): boolean {
  return (
    process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(process.argv[1]).href
  );
}
