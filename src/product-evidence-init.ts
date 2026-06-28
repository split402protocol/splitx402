import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createSplit402ProductEvidenceWorkspace } from "./productEvidenceWorkspace.js";

const directory = process.argv[2] ?? "split402-launch-evidence";
const workspace = createSplit402ProductEvidenceWorkspace({
  directory,
  sourceCommit: readCurrentGitCommit(),
  reviewDate: isoDate(),
});

mkdirSync(workspace.directory, { recursive: true });
mkdirSync(workspace.phase7.directory, { recursive: true });

writeFileSync(
  join(workspace.directory, workspace.readmeFileName),
  workspace.readmeText,
);
writeFileSync(
  join(workspace.directory, workspace.phase6EvidenceFileName),
  workspace.phase6EvidenceText,
);
writeFileSync(
  join(workspace.directory, workspace.phase7EnvFileName),
  workspace.phase7.envText,
);
writeFileSync(
  join(workspace.phase7.directory, workspace.phase7.readmeFileName),
  workspace.phase7.readmeText,
);

console.log(
  JSON.stringify(
    {
      schema: "split402.product_evidence_init.v1",
      evidenceDirectory: workspace.directory,
      phase6EvidenceFile: join(
        workspace.directory,
        workspace.phase6EvidenceFileName,
      ),
      phase7ProofFile: join(workspace.directory, workspace.phase7ProofFileName),
      phase7EnvFile: join(workspace.directory, workspace.phase7EnvFileName),
      phase7EvidenceDirectory: workspace.phase7.directory,
      readmeFile: join(workspace.directory, workspace.readmeFileName),
      nextCommands: workspace.nextCommands,
    },
    null,
    2,
  ),
);

function readCurrentGitCommit(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

function isoDate(): string {
  return new Date().toISOString().slice(0, 10);
}
