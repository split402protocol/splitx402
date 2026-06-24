import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const WORKSPACE_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
export const WORKSPACE_ENV_PATH = path.join(WORKSPACE_ROOT, ".env");

config({ path: WORKSPACE_ENV_PATH });
