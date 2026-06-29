import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import { isPhase7SourceWorktreeDirty } from "./phase7GitStatus.js";
import {
  PHASE7_EVIDENCE_FIELDS,
  parsePhase7ProofRecord,
} from "./phase7StagingProof.js";
import {
  createPhase7StagingStatusReport,
  formatPhase7StagingStatusBrief,
} from "./phase7StagingStatus.js";

const { brief, help, proofPath } = parseCliArgs(process.argv.slice(2));

if (help) {
  console.log(
    "Usage: corepack pnpm phase7:staging:status [--brief] [phase7-staging-proof.txt]",
  );
  process.exit(0);
}

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
console.log(
  brief ? formatPhase7StagingStatusBrief(report) : JSON.stringify(report, null, 2),
);

if (report.proofChecked && !report.readyForPublicAlphaDemo) {
  process.exitCode = 1;
}

function parseCliArgs(args: readonly string[]): {
  brief: boolean;
  help: boolean;
  proofPath?: string;
} {
  let brief = false;
  let help = false;
  let proofPath: string | undefined;

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--brief") {
      brief = true;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (proofPath === undefined) {
      proofPath = arg;
    } else {
      throw new Error(
        "Usage: corepack pnpm phase7:staging:status [--brief] [phase7-staging-proof.txt]",
      );
    }
  }

  return {
    brief,
    help,
    proofPath: proofPath ?? process.env.SPLIT402_PHASE7_STAGING_PROOF,
  };
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
