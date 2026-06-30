import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import dotenv from "dotenv";

export function createMainnetCanaryEnv(input: {
  processEnv?: NodeJS.ProcessEnv;
  workspaceDirectory?: string;
}): NodeJS.ProcessEnv {
  const workspaceEnv =
    input.workspaceDirectory === undefined
      ? {}
      : readOptionalEnvFile(join(input.workspaceDirectory, "mainnet-canary.env"));
  return {
    ...workspaceEnv,
    ...(input.processEnv ?? process.env),
  };
}

function readOptionalEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) {
    return {};
  }
  return dotenv.parse(readFileSync(path, "utf8"));
}
