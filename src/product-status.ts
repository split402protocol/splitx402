import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import { isPhase7SourceWorktreeDirty } from "./phase7GitStatus.js";
import {
  PHASE7_EVIDENCE_FIELDS,
  parsePhase7ProofRecord,
} from "./phase7StagingProof.js";
import { createSplit402ProductReadinessReport } from "./productReadinessStatus.js";

const phase6EvidencePath =
  process.argv[2] ?? process.env.SPLIT402_PHASE6_CUSTODY_EVIDENCE;
const phase7ProofPath =
  process.argv[3] ?? process.env.SPLIT402_PHASE7_STAGING_PROOF;

const phase6EvidenceText = readOptionalText(phase6EvidencePath);
const phase7ProofText = readOptionalText(phase7ProofPath);
const phase7ArtifactBaseDir =
  phase7ProofPath === undefined || phase7ProofPath.trim().length === 0
    ? undefined
    : dirname(resolve(phase7ProofPath));

const report = createSplit402ProductReadinessReport({
  phase6EvidenceText,
  phase7ProofText,
  phase7Options: {
    currentSourceCommit: readCurrentGitCommit(),
    currentWorktreeDirty: readCurrentWorktreeDirty(
      phase7ProofPath,
      phase7ProofText,
    ),
    ...(phase7ArtifactBaseDir === undefined
      ? {}
      : {
          artifactBaseDir: phase7ArtifactBaseDir,
          artifactExists: existsSync,
          readArtifact: (artifactPath) => readFileSync(artifactPath),
          resolveArtifactPath: (artifactPath, baseDir) =>
            isAbsolute(artifactPath)
              ? artifactPath
              : resolve(baseDir, artifactPath),
        }),
  },
});

console.log(JSON.stringify(report, null, 2));

if (
  (report.phase6.evidenceBundleChecked || report.phase7.proofChecked) &&
  report.launchDecision !== "go"
) {
  process.exitCode = 1;
}

function readOptionalText(path: string | undefined): string | undefined {
  if (path === undefined || path.trim().length === 0) {
    return undefined;
  }
  return readFileSync(path, "utf8");
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
