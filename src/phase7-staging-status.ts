import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import { isPhase7SourceWorktreeDirty } from "./phase7GitStatus.js";
import {
  PHASE7_EVIDENCE_FIELDS,
  parsePhase7ProofRecord,
} from "./phase7StagingProof.js";
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
  currentWorktreeDirty: readCurrentWorktreeDirty(proofPath, proofText),
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

function readCurrentWorktreeDirty(
  proofFilePath: string | undefined,
  checkedProofText: string | undefined,
): boolean {
  const porcelainStatus = execFileSync("git", ["status", "--porcelain"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return isPhase7SourceWorktreeDirty({
    porcelainStatus,
    proofPath: proofFilePath,
    allowedArtifactPaths: readAttachedArtifactPaths(checkedProofText),
    repositoryRoot: process.cwd(),
  });
}

function readAttachedArtifactPaths(checkedProofText: string | undefined): string[] {
  if (checkedProofText === undefined) {
    return [];
  }
  const fields = parsePhase7ProofRecord(checkedProofText);
  return PHASE7_EVIDENCE_FIELDS.map((field) =>
    readAttachedArtifactPath(fields.get(field)),
  ).filter((path): path is string => path !== undefined);
}

function readAttachedArtifactPath(reference: string | undefined): string | undefined {
  const prefix = "attached:";
  if (reference === undefined || !reference.toLowerCase().startsWith(prefix)) {
    return undefined;
  }
  const path = reference.slice(prefix.length).trim();
  return path.length === 0 ? undefined : path;
}
