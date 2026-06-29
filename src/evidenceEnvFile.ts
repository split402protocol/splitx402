import { existsSync, readFileSync } from "node:fs";
import { delimiter } from "node:path";

import dotenv from "dotenv";

export interface EvidenceEnvFileLoadOptions {
  argv?: readonly string[];
  defaultEnvFiles?: readonly string[];
  env?: NodeJS.ProcessEnv;
}

export interface EvidenceEnvFileLoadResult {
  args: string[];
  loadedFiles: string[];
}

export function loadEvidenceEnvFiles(
  options: EvidenceEnvFileLoadOptions = {},
): EvidenceEnvFileLoadResult {
  const env = options.env ?? process.env;
  const { args, explicitEnvFiles } = parseEnvFileArgs(options.argv ?? []);
  const envFiles = [
    ...splitEnvFileList(env.SPLIT402_ENV_FILE),
    ...explicitEnvFiles,
    ...(options.defaultEnvFiles ?? []).filter((path) => existsSync(path)),
  ];

  const loadedFiles: string[] = [];
  for (const path of dedupe(envFiles)) {
    const parsed = dotenv.parse(readFileSync(path, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      if (env[key] === undefined) {
        env[key] = value;
      }
    }
    loadedFiles.push(path);
  }

  return { args, loadedFiles };
}

function parseEnvFileArgs(argv: readonly string[]): {
  args: string[];
  explicitEnvFiles: string[];
} {
  const args: string[] = [];
  const explicitEnvFiles: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--evidence-env-file" || arg === "--env-file") {
      const path = argv[index + 1];
      if (path === undefined || path.startsWith("--")) {
        throw new Error(`${arg} requires a path`);
      }
      explicitEnvFiles.push(path);
      index += 1;
      continue;
    }
    const envFileEqualsArg = readEnvFileEqualsArg(arg);
    if (envFileEqualsArg !== undefined) {
      const { flag, path } = envFileEqualsArg;
      if (path.trim().length === 0) {
        throw new Error(`${flag} requires a path`);
      }
      explicitEnvFiles.push(path);
      continue;
    }
    if (arg !== undefined) {
      args.push(arg);
    }
  }
  return { args, explicitEnvFiles };
}

function readEnvFileEqualsArg(
  arg: string | undefined,
): { flag: string; path: string } | undefined {
  for (const flag of ["--evidence-env-file", "--env-file"]) {
    const prefix = `${flag}=`;
    if (arg?.startsWith(prefix)) {
      return { flag, path: arg.slice(prefix.length) };
    }
  }
  return undefined;
}

function splitEnvFileList(value: string | undefined): string[] {
  if (value === undefined || value.trim().length === 0) {
    return [];
  }
  return value
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function dedupe(paths: readonly string[]): string[] {
  return [...new Set(paths)];
}
