import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import type { Writable } from "node:stream";

export function writeCliTextOutput(input: {
  text: string;
  outputPath?: string;
  stdout?: Writable;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}): string | undefined {
  if (input.outputPath === undefined || input.outputPath.trim().length === 0) {
    (input.stdout ?? process.stdout).write(input.text);
    return undefined;
  }

  const resolvedOutputPath = resolveCliOutputPath({
    outputPath: input.outputPath,
    env: input.env,
    cwd: input.cwd,
  });
  mkdirSync(dirname(resolvedOutputPath), { recursive: true });
  writeFileSync(resolvedOutputPath, input.text, "utf8");
  return resolvedOutputPath;
}

export function resolveCliOutputPath(input: {
  outputPath: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}): string {
  return isAbsolute(input.outputPath)
    ? input.outputPath
    : resolve(input.env?.INIT_CWD ?? input.cwd ?? process.cwd(), input.outputPath);
}
