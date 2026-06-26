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
        "corepack pnpm phase7:staging:assemble > phase7-staging-proof.txt",
        "corepack pnpm phase7:staging:status phase7-staging-proof.txt",
      ],
    },
    null,
    2,
  ),
);
