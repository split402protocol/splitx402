import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import { isPhase7SourceWorktreeDirty } from "./phase7GitStatus.js";
import {
  PHASE7_EVIDENCE_FIELDS,
  parsePhase7ProofRecord,
} from "./phase7StagingProof.js";
import {
  createSplit402ProductReadinessReport,
  type Split402ProductReadinessReport,
} from "./productReadinessStatus.js";

export interface Split402ProductReadinessCliInput {
  brief: boolean;
  help: boolean;
  phase6EvidencePath?: string;
  phase7ProofPath?: string;
  report: Split402ProductReadinessReport;
}

export const PRODUCT_STATUS_USAGE =
  "Usage: corepack pnpm product:status [--brief] [phase6-custody-evidence.txt] [phase7-staging-proof.txt]";

export const PRODUCT_LAUNCH_CHECKLIST_USAGE =
  "Usage: corepack pnpm product:launch-checklist [--brief] [phase6-custody-evidence.txt] [phase7-staging-proof.txt]";

export function readSplit402ProductReadinessCliInput(
  args: readonly string[],
  usage = PRODUCT_STATUS_USAGE,
): Split402ProductReadinessCliInput {
  const help = args.includes("--help") || args.includes("-h");
  const brief = args.includes("--brief");
  const unknownOptions = args.filter(
    (arg) =>
      arg.startsWith("-") &&
      arg !== "--help" &&
      arg !== "-h" &&
      arg !== "--brief",
  );
  if (unknownOptions.length > 0) {
    throw new Error(`${usage}\nUnknown option: ${unknownOptions[0]}`);
  }

  const positionalArgs = args.filter(
    (arg) => arg !== "--help" && arg !== "-h" && arg !== "--brief",
  );
  if (positionalArgs.length > 2) {
    throw new Error(usage);
  }

  const phase6EvidencePath =
    help
      ? undefined
      : positionalArgs[0] ?? process.env.SPLIT402_PHASE6_CUSTODY_EVIDENCE;
  const phase7ProofPath =
    help ? undefined : positionalArgs[1] ?? process.env.SPLIT402_PHASE7_STAGING_PROOF;
  const phase6EvidenceText = readOptionalText(phase6EvidencePath);
  const phase7ProofText = readOptionalText(phase7ProofPath);
  const phase7ArtifactBaseDir =
    phase7ProofPath === undefined || phase7ProofPath.trim().length === 0
      ? undefined
      : dirname(resolve(phase7ProofPath));

  return {
    brief,
    help,
    phase6EvidencePath,
    phase7ProofPath,
    report: createSplit402ProductReadinessReport({
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
    }),
  };
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
