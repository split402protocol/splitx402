import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  createProductEvidenceInitWrites,
  findExistingProductEvidenceInitWrites,
  parseProductEvidenceInitArgs,
} from "./productEvidenceInitPlan.js";
import { createSplit402ProductEvidenceWorkspace } from "./productEvidenceWorkspace.js";

const args = parseArgs();
const workspace = createSplit402ProductEvidenceWorkspace({
  directory: args.directory,
  sourceCommit: readCurrentGitCommit(),
  reviewDate: isoDate(),
});
const writes = createProductEvidenceInitWrites(workspace);
const existingFiles = args.force
  ? []
  : findExistingProductEvidenceInitWrites(writes, existsSync);

if (existingFiles.length > 0) {
  console.error(
    [
      "Refusing to overwrite existing Split402 launch evidence scaffold files.",
      "Review or move these files first, or rerun with `corepack pnpm product:evidence:init --force` to replace them intentionally:",
      ...existingFiles.map((path) => `- ${path}`),
    ].join("\n"),
  );
  process.exit(1);
}

for (const write of writes) {
  mkdirSync(dirname(write.path), { recursive: true });
  writeFileSync(write.path, write.contents);
}

console.log(
  JSON.stringify(
    {
      schema: "split402.product_evidence_init.v1",
      evidenceDirectory: workspace.directory,
      phase6EvidenceFile: join(
        workspace.directory,
        workspace.phase6EvidenceFileName,
      ),
      phase6EnvFile: join(workspace.directory, workspace.phase6EnvFileName),
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

function parseArgs() {
  try {
    return parseProductEvidenceInitArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function readCurrentGitCommit(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

function isoDate(): string {
  return new Date().toISOString().slice(0, 10);
}
