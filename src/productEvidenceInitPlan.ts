import { join } from "node:path";

import type { Split402ProductEvidenceWorkspace } from "./productEvidenceWorkspace.js";

export interface ProductEvidenceInitArgs {
  directory: string;
  force: boolean;
}

export interface ProductEvidenceInitWrite {
  path: string;
  contents: string;
}

export function parseProductEvidenceInitArgs(
  args: readonly string[],
): ProductEvidenceInitArgs {
  const force = args.includes("--force");
  const directoryArgs = args.filter((arg) => arg !== "--force");

  if (directoryArgs.length > 1) {
    throw new Error(
      "Usage: corepack pnpm product:evidence:init [--force] [directory]",
    );
  }

  return {
    directory: directoryArgs[0] ?? "split402-launch-evidence",
    force,
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
