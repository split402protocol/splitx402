import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));

config({ path: path.join(workspaceRoot, ".env") });
