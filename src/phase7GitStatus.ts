export interface Phase7SourceDirtyInput {
  porcelainStatus: string;
  proofPath?: string;
  allowedArtifactPaths?: readonly string[];
}

export function listPhase7SourceWorktreeChanges(
  input: Phase7SourceDirtyInput,
): string[] {
  const allowedPaths = new Set(
    [input.proofPath, ...(input.allowedArtifactPaths ?? [])]
      .map((path) => (path === undefined ? undefined : normalizeGitPath(path)))
      .filter((path): path is string => path !== undefined && path.length > 0),
  );
  const allowedDirectories = new Set(
    [
      "phase7-staging-evidence",
      ...(input.allowedArtifactPaths ?? []).map((path) =>
        readDirectoryName(normalizeGitPath(path)),
      ),
    ].filter((path): path is string => path !== undefined && path.length > 0),
  );
  return input.porcelainStatus
    .split(/\r?\n/u)
    .map((line) => readPorcelainPath(line))
    .filter((path): path is string => path !== undefined)
    .filter(
      (path) =>
        !allowedPaths.has(path) &&
        ![...allowedDirectories].some(
          (directory) => path === directory || path.startsWith(`${directory}/`),
        ),
    );
}

export function isPhase7SourceWorktreeDirty(
  input: Phase7SourceDirtyInput,
): boolean {
  return listPhase7SourceWorktreeChanges(input).length > 0;
}

function readPorcelainPath(line: string): string | undefined {
  if (line.trim().length === 0 || line.length < 4) {
    return undefined;
  }
  const value = line.slice(3).trim();
  if (value.length === 0) {
    return undefined;
  }
  const renameParts = value.split(" -> ");
  return normalizeGitPath(renameParts[renameParts.length - 1] ?? value);
}

function normalizeGitPath(path: string): string {
  return path.replace(/\\/gu, "/").replace(/^\.\/+/u, "").replace(/\/+$/u, "");
}

function readDirectoryName(path: string): string | undefined {
  const index = path.lastIndexOf("/");
  return index <= 0 ? undefined : path.slice(0, index);
}
