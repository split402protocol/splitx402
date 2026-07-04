import { config } from "dotenv";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const WORKSPACE_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
export const WORKSPACE_ENV_PATH = path.join(WORKSPACE_ROOT, ".env");

config({ path: WORKSPACE_ENV_PATH });

export function loadOptionalWorkspaceEnv(relativePath: string): boolean {
  const envPath = path.isAbsolute(relativePath)
    ? relativePath
    : path.join(WORKSPACE_ROOT, relativePath);
  if (!existsSync(envPath)) {
    return false;
  }
  config({ path: envPath });
  return true;
}
