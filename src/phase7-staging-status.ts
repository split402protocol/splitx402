import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import { createPhase7StagingStatusReport } from "./phase7StagingStatus.js";

const proofPath =
  process.argv[2] ?? process.env.SPLIT402_PHASE7_STAGING_PROOF;

const proofText =
  proofPath === undefined || proofPath.trim().length === 0
    ? undefined
    : readFileSync(proofPath, "utf8");

const artifactBaseDir =
  proofPath === undefined || proofPath.trim().length === 0
    ? undefined
    : dirname(resolve(proofPath));
const report = createPhase7StagingStatusReport(proofText, {
  currentSourceCommit: readCurrentGitCommit(),
  currentWorktreeDirty: readCurrentWorktreeDirty(),
  ...(artifactBaseDir === undefined
    ? {}
    : {
        artifactBaseDir,
        artifactExists: existsSync,
        readArtifact: (artifactPath) => readFileSync(artifactPath),
        resolveArtifactPath: (artifactPath, baseDir) =>
          isAbsolute(artifactPath) ? artifactPath : resolve(baseDir, artifactPath),
      }),
});
console.log(JSON.stringify(report, null, 2));

if (report.proofChecked && !report.readyForPublicAlphaDemo) {
  process.exitCode = 1;
}

function readCurrentGitCommit(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function readCurrentWorktreeDirty(): boolean {
  return execFileSync("git", ["status", "--porcelain"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim().length > 0;
}
