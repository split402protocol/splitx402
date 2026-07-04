import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  PHASE7_DOCKER_GENERATED_SECRET_KEYS,
  PHASE7_DOCKER_ENV_INIT_USAGE,
  createPhase7DockerEnvInitPlan,
  parsePhase7DockerEnvInitArgs,
  populatePhase7DockerGeneratedSecrets,
} from "./phase7DockerEnvInit.js";

const args = parseArgs();

if (args.help) {
  console.log(PHASE7_DOCKER_ENV_INIT_USAGE);
  process.exit(0);
}

const plan = createPhase7DockerEnvInitPlan({
  args,
  exists: existsSync,
});

if (plan.shouldWrite) {
  mkdirSync(dirname(plan.target), { recursive: true });
  const sourceText = readFileSync(plan.source, "utf8");
  writeFileSync(
    plan.target,
    args.generateSecrets
      ? populatePhase7DockerGeneratedSecrets(sourceText, generateRuntimeSecret)
      : sourceText,
  );
}

console.log(
  JSON.stringify(
    {
      schema: "split402.phase7_docker_env_init.v1",
      source: plan.source,
      target: plan.target,
      written: plan.shouldWrite,
      refused: plan.refused,
      generatedSecretKeys:
        plan.shouldWrite && args.generateSecrets
          ? PHASE7_DOCKER_GENERATED_SECRET_KEYS
          : [],
      message: plan.message,
      nextActions: plan.nextActions,
    },
    null,
    2,
  ),
);

if (plan.refused) {
  process.exitCode = 1;
}

function generateRuntimeSecret(): string {
  return `s402_${randomBytes(32).toString("base64url")}`;
}

function parseArgs() {
  try {
    return parsePhase7DockerEnvInitArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
