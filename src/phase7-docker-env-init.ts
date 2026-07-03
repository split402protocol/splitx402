import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  PHASE7_DOCKER_ENV_INIT_USAGE,
  createPhase7DockerEnvInitPlan,
  parsePhase7DockerEnvInitArgs,
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
  writeFileSync(plan.target, readFileSync(plan.source, "utf8"));
}

console.log(
  JSON.stringify(
    {
      schema: "split402.phase7_docker_env_init.v1",
      source: plan.source,
      target: plan.target,
      written: plan.shouldWrite,
      refused: plan.refused,
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

function parseArgs() {
  try {
    return parsePhase7DockerEnvInitArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
