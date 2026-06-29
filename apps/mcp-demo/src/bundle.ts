import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createMcpDemoBundle } from "./index.js";

export function renderMcpDemoBundleJson(): string {
  return JSON.stringify(createMcpDemoBundle(), null, 2);
}

export function writeMcpDemoBundleOutput(outputPath?: string): void {
  const json = `${renderMcpDemoBundleJson()}\n`;
  if (outputPath === undefined || outputPath.trim().length === 0) {
    process.stdout.write(json);
    return;
  }

  const resolvedOutputPath = resolveOutputPath(outputPath);
  mkdirSync(dirname(resolvedOutputPath), { recursive: true });
  writeFileSync(resolvedOutputPath, json, "utf8");
}

function resolveOutputPath(outputPath: string): string {
  return isAbsolute(outputPath)
    ? outputPath
    : resolve(process.env.INIT_CWD ?? process.cwd(), outputPath);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeMcpDemoBundleOutput(process.argv[2]);
}
