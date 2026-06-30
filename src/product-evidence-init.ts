import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  PRODUCT_EVIDENCE_INIT_USAGE,
  createProductEvidenceInitWrites,
  createProductEvidenceSourceRefreshWrites,
  findExistingProductEvidenceInitWrites,
  parseProductEvidenceInitArgs,
} from "./productEvidenceInitPlan.js";
import { createSplit402ProductEvidenceWorkspace } from "./productEvidenceWorkspace.js";

const args = parseArgs();
if (args.help) {
  console.log(PRODUCT_EVIDENCE_INIT_USAGE);
  process.exit(0);
}

const workspace = createSplit402ProductEvidenceWorkspace({
  directory: args.directory,
  sourceCommit: readCurrentGitCommit(),
  reviewDate: isoDate(),
});
const writes = createProductEvidenceInitWrites(workspace);
const existingFiles = findExistingProductEvidenceInitWrites(writes, existsSync);
const writesToCreate = createWritesToCreate();

if (!args.force && !args.missing && !args.refreshSource && existingFiles.length > 0) {
  console.error(
    [
      "Refusing to overwrite existing Split402 launch evidence scaffold files.",
      "Review or move these files first, run `corepack pnpm product:evidence:init --missing` to create only absent scaffold files, run `corepack pnpm product:evidence:init --refresh-source` to update only stale scaffold source_commit values, or rerun with `corepack pnpm product:evidence:init --force` to replace them intentionally:",
      ...existingFiles.map((path) => `- ${path}`),
    ].join("\n"),
  );
  process.exit(1);
}

for (const write of writesToCreate) {
  mkdirSync(dirname(write.path), { recursive: true });
  writeFileSync(write.path, write.contents);
}

console.log(
  JSON.stringify(
    {
      schema: "split402.product_evidence_init.v1",
      evidenceDirectory: workspace.directory,
      githubSettingsReviewFile: join(
        workspace.directory,
        workspace.githubSettingsReviewFileName,
      ),
      phase6EvidenceFile: join(
        workspace.directory,
        workspace.phase6EvidenceFileName,
      ),
      phase6EnvFile: join(workspace.directory, workspace.phase6EnvFileName),
      phase7ProofFile: join(workspace.directory, workspace.phase7ProofFileName),
      phase7EnvFile: join(workspace.directory, workspace.phase7EnvFileName),
      phase7EvidenceDirectory: workspace.phase7.directory,
      readmeFile: join(workspace.directory, workspace.readmeFileName),
      mode: args.force
        ? "force"
        : args.missing
          ? "missing"
          : args.refreshSource
            ? "refresh-source"
            : "create",
      writtenFiles: writesToCreate.map((write) => write.path),
      skippedExistingFiles: args.missing ? existingFiles : [],
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

function createWritesToCreate() {
  if (args.force) {
    return writes;
  }
  if (args.missing) {
    return writes.filter((write) => !existsSync(write.path));
  }
  if (args.refreshSource) {
    return createProductEvidenceSourceRefreshWrites({
      workspace,
      readText: (path) => readFileSync(path, "utf8"),
    });
  }
  return writes;
}

function readCurrentGitCommit(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

function isoDate(): string {
  return new Date().toISOString().slice(0, 10);
}
