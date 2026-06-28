import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createPhase7StagingEvidenceWorkspace } from "./phase7StagingEvidenceWorkspace.js";

const directory = process.argv[2] ?? "phase7-staging-evidence";
const workspace = createPhase7StagingEvidenceWorkspace({ directory });

mkdirSync(workspace.directory, { recursive: true });
writeFileSync(
  join(workspace.directory, workspace.readmeFileName),
  workspace.readmeText,
);
writeFileSync(workspace.envFileName, workspace.envText);

console.log(
  JSON.stringify(
    {
      schema: "split402.phase7_staging_init.v1",
      evidenceDirectory: workspace.directory,
      envFile: workspace.envFileName,
      readmeFile: join(workspace.directory, workspace.readmeFileName),
      artifactFilesToCapture: workspace.artifacts.map((artifact) => ({
        field: artifact.field,
        path: join(workspace.directory, artifact.fileName),
      })),
      nextCommands: [
        "Fill direct SPLIT402_PHASE7_* proof fields.",
        `Use ${workspace.envFileName} for SPLIT402_PHASE7_ASSEMBLE_* attachment paths.`,
        "Capture real staging outputs into the listed artifact files.",
        "SPLIT402_PHASE7_SEED_CONFIRM=seed-hosted-staging corepack pnpm phase7:staging:seed",
        "corepack pnpm phase7:staging-proof > phase7-staging-proof.txt",
        "corepack pnpm phase7:hosted:preflight",
        "corepack pnpm phase7:staging:collect-reads",
        "corepack pnpm phase7:staging:collect-mcp-gateway",
        "corepack pnpm demo:mcp-gateway:smoke",
        `corepack pnpm demo:mcp-bundle > ${workspace.directory}/mcp-bundle.json`,
        `corepack pnpm demo:paid-suite > ${workspace.directory}/paid-suite.log`,
        "corepack pnpm phase7:staging:derive-receipt-verification",
        `corepack pnpm phase7:staging:manifest phase7-staging-proof.txt > ${workspace.directory}/artifact-manifest.json`,
        "corepack pnpm phase7:staging:assemble > phase7-staging-proof.txt",
        "corepack pnpm phase7:staging:status phase7-staging-proof.txt",
        "Record the commands above plus lint, typecheck, test, build, vectors:check, and audit in commands.log.",
      ],
    },
    null,
    2,
  ),
);
