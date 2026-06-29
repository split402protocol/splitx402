import { join } from "node:path";

import type { Split402ProductEvidenceWorkspace } from "./productEvidenceWorkspace.js";

export interface ProductEvidenceInitArgs {
  directory: string;
  force: boolean;
  help: boolean;
  missing: boolean;
}

export interface ProductEvidenceInitWrite {
  path: string;
  contents: string;
}

export const PRODUCT_EVIDENCE_INIT_USAGE =
  "Usage: corepack pnpm product:evidence:init [--force|--missing] [directory]";

export function parseProductEvidenceInitArgs(
  args: readonly string[],
): ProductEvidenceInitArgs {
  const help = args.includes("--help") || args.includes("-h");
  const force = args.includes("--force");
  const missing = args.includes("--missing");
  const unknownOptions = args.filter(
    (arg) =>
      arg.startsWith("-") &&
      arg !== "--help" &&
      arg !== "-h" &&
      arg !== "--force" &&
      arg !== "--missing",
  );
  if (unknownOptions.length > 0) {
    throw new Error(
      `${PRODUCT_EVIDENCE_INIT_USAGE}\nUnknown option: ${unknownOptions[0]}`,
    );
  }

  const directoryArgs = args.filter(
    (arg) =>
      arg !== "--help" &&
      arg !== "-h" &&
      arg !== "--force" &&
      arg !== "--missing",
  );

  if (force && missing) {
    throw new Error(PRODUCT_EVIDENCE_INIT_USAGE);
  }

  if (directoryArgs.length > 1) {
    throw new Error(PRODUCT_EVIDENCE_INIT_USAGE);
  }

  return {
    directory: directoryArgs[0] ?? "split402-launch-evidence",
    force,
    help,
    missing,
  };
}

export function createProductEvidenceInitWrites(
  workspace: Split402ProductEvidenceWorkspace,
): ProductEvidenceInitWrite[] {
  return [
    {
      path: join(workspace.directory, workspace.readmeFileName),
      contents: workspace.readmeText,
    },
    {
      path: join(workspace.directory, workspace.phase6EvidenceFileName),
      contents: workspace.phase6EvidenceText,
    },
    {
      path: join(workspace.directory, workspace.phase6EnvFileName),
      contents: workspace.phase6EnvText,
    },
    {
      path: join(workspace.directory, workspace.phase7ProofFileName),
      contents: workspace.phase7ProofText,
    },
    {
      path: join(workspace.directory, workspace.phase7EnvFileName),
      contents: workspace.phase7.envText,
    },
    {
      path: join(workspace.phase7.directory, workspace.phase7.readmeFileName),
      contents: workspace.phase7.readmeText,
    },
  ];
}

export function findExistingProductEvidenceInitWrites(
  writes: readonly ProductEvidenceInitWrite[],
  exists: (path: string) => boolean,
): string[] {
  return writes.filter((write) => exists(write.path)).map((write) => write.path);
}
