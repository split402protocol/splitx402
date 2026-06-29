import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

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
  localProofPath?: string;
  phase6EvidencePath?: string;
  phase7ProofPath?: string;
  report: Split402ProductReadinessReport;
  workspaceDirectory?: string;
}

export const PRODUCT_STATUS_USAGE =
  "Usage: corepack pnpm product:status [--brief] [--workspace directory] [phase6-custody-evidence.txt] [phase7-staging-proof.txt]";

export const PRODUCT_LAUNCH_CHECKLIST_USAGE =
  "Usage: corepack pnpm product:launch-checklist [--brief] [--workspace directory] [phase6-custody-evidence.txt] [phase7-staging-proof.txt]";

export function readSplit402ProductReadinessCliInput(
  args: readonly string[],
  usage = PRODUCT_STATUS_USAGE,
): Split402ProductReadinessCliInput {
  const parsed = parseReadinessCliArgs(args, usage);
  const { brief, help, positionalArgs, workspaceDirectory } = parsed;
  if (positionalArgs.length > 2) {
    throw new Error(usage);
  }
  if (workspaceDirectory !== undefined && positionalArgs.length > 0) {
    throw new Error(
      `${usage}\nDo not pass evidence file paths with --workspace.`,
    );
  }

  const workspaceEvidencePaths =
    help || workspaceDirectory === undefined
      ? undefined
      : createWorkspaceEvidencePaths(workspaceDirectory);

  const phase6EvidencePath =
    help
      ? undefined
      : positionalArgs[0] ??
        workspaceEvidencePaths?.phase6EvidencePath ??
        process.env.SPLIT402_PHASE6_CUSTODY_EVIDENCE;
  const phase7ProofPath =
    help
      ? undefined
      : positionalArgs[1] ??
        workspaceEvidencePaths?.phase7ProofPath ??
        process.env.SPLIT402_PHASE7_STAGING_PROOF;
  const localProofPath =
    help
      ? undefined
      : workspaceEvidencePaths?.localProofPath ??
        process.env.SPLIT402_LOCAL_PUBLIC_ALPHA_PROOF;
  const localProofText = readOptionalText(localProofPath);
  const phase6EvidenceText = readOptionalText(phase6EvidencePath);
  const phase7ProofText = readOptionalText(phase7ProofPath);
  const phase7ArtifactBaseDir =
    phase7ProofPath === undefined || phase7ProofPath.trim().length === 0
      ? undefined
      : dirname(resolve(phase7ProofPath));
  const currentSourceCommit = readCurrentGitCommit();
  const currentWorktreeDirty = readCurrentWorktreeDirty(
    phase7ProofPath,
    phase7ProofText,
  );

  return {
    brief,
    help,
    localProofPath,
    phase6EvidencePath,
    phase7ProofPath,
    workspaceDirectory,
    report: createSplit402ProductReadinessReport({
      currentSourceCommit,
      currentWorktreeDirty,
      localProofText,
      phase6EvidenceText,
      phase6Options: {
        currentSourceCommit,
      },
      phase7ProofText,
      phase7Options: {
        currentSourceCommit,
        currentWorktreeDirty,
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

interface ParsedReadinessCliArgs {
  brief: boolean;
  help: boolean;
  positionalArgs: string[];
  workspaceDirectory?: string;
}

function parseReadinessCliArgs(
  args: readonly string[],
  usage: string,
): ParsedReadinessCliArgs {
  const positionalArgs: string[] = [];
  let brief = false;
  let help = false;
  let workspaceDirectory: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--brief") {
      brief = true;
    } else if (arg === "--workspace") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new Error(`${usage}\n--workspace requires a directory.`);
      }
      workspaceDirectory = value;
      index += 1;
    } else if (arg.startsWith("--workspace=")) {
      const value = arg.slice("--workspace=".length);
      if (value.trim().length === 0) {
        throw new Error(`${usage}\n--workspace requires a directory.`);
      }
      workspaceDirectory = value;
    } else if (arg.startsWith("-")) {
      throw new Error(`${usage}\nUnknown option: ${arg}`);
    } else {
      positionalArgs.push(arg);
    }
  }

  return {
    brief,
    help,
    positionalArgs,
    ...(workspaceDirectory === undefined ? {} : { workspaceDirectory }),
  };
}

function createWorkspaceEvidencePaths(directory: string): {
  localProofPath: string;
  phase6EvidencePath: string;
  phase7ProofPath: string;
} {
  return {
    localProofPath: join(directory, "local-public-alpha-proof.json"),
    phase6EvidencePath: join(directory, "phase6-custody-evidence.txt"),
    phase7ProofPath: join(directory, "phase7-staging-proof.txt"),
  };
}

function readOptionalText(path: string | undefined): string | undefined {
  if (path === undefined || path.trim().length === 0) {
    return undefined;
  }
  if (!existsSync(path)) {
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
