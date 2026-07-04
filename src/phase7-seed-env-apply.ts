import { existsSync, readFileSync, writeFileSync } from "node:fs";

import {
  PHASE7_SEED_ENV_APPLY_DOCKER_KEYS,
  PHASE7_SEED_ENV_APPLY_PHASE7_KEYS,
  PHASE7_SEED_ENV_APPLY_USAGE,
  applyPhase7SeedProofEnvToText,
  createPhase7SeedEnvApplyResult,
  extractPhase7SeedProofEnv,
  parsePhase7SeedEnvApplyArgs,
  type Phase7SeedEnvApplyTargetResult,
} from "./phase7SeedEnvApply.js";

const args = parseArgs();

if (args.help) {
  console.log(PHASE7_SEED_ENV_APPLY_USAGE);
  process.exit(0);
}

if (args.seedOutput === undefined) {
  console.error(`${PHASE7_SEED_ENV_APPLY_USAGE}\n--seed-output is required`);
  process.exit(1);
}

const proofEnv = extractPhase7SeedProofEnv(readTextFile(args.seedOutput));
const phase7Target = applyToTarget({
  path: args.phase7Env,
  dryRun: args.dryRun,
  proofEnv,
  allowedKeys: PHASE7_SEED_ENV_APPLY_PHASE7_KEYS,
});
const dockerTarget = applyToTarget({
  path: args.dockerEnv,
  dryRun: args.dryRun,
  proofEnv,
  allowedKeys: PHASE7_SEED_ENV_APPLY_DOCKER_KEYS,
});

console.log(
  JSON.stringify(
    createPhase7SeedEnvApplyResult({
      seedOutput: args.seedOutput,
      dryRun: args.dryRun,
      proofEnv,
      phase7Target,
      dockerTarget,
    }),
    null,
    2,
  ),
);

function applyToTarget(input: {
  path: string;
  dryRun: boolean;
  proofEnv: Record<string, string>;
  allowedKeys: readonly string[];
}): Phase7SeedEnvApplyTargetResult {
  if (!existsSync(input.path)) {
    throw new Error(`${input.path} does not exist; create it before applying seed env values`);
  }
  const current = readTextFile(input.path);
  const applied = applyPhase7SeedProofEnvToText({
    text: current,
    proofEnv: input.proofEnv,
    allowedKeys: input.allowedKeys,
  });
  if (!input.dryRun && applied.text !== current) {
    writeFileSync(input.path, applied.text);
  }
  return {
    target: input.path,
    written: !input.dryRun && applied.text !== current,
    updatedKeys: applied.updatedKeys,
    skippedKeys: applied.skippedKeys,
  };
}

function parseArgs() {
  try {
    return parsePhase7SeedEnvApplyArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function readTextFile(path: string): string {
  const buffer = readFileSync(path);
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString("utf16le").replace(/^\uFEFF/u, "");
  }
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    throw new Error(`${path} uses UTF-16BE; save it as UTF-8 or UTF-16LE`);
  }
  return buffer.toString("utf8").replace(/^\uFEFF/u, "");
}
