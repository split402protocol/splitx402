export const PHASE7_DOCKER_ENV_INIT_USAGE =
  "Usage: corepack pnpm phase7:docker:env:init [--force] [--source <path>] [--target <path>]";

export const DEFAULT_PHASE7_DOCKER_ENV_SOURCE =
  "deploy/phase7-staging/phase7-staging.env.example";
export const DEFAULT_PHASE7_DOCKER_ENV_TARGET =
  "deploy/phase7-staging/phase7-staging.env";

export interface Phase7DockerEnvInitArgs {
  force: boolean;
  help: boolean;
  source: string;
  target: string;
}

export interface Phase7DockerEnvInitPlan {
  source: string;
  target: string;
  shouldWrite: boolean;
  refused: boolean;
  message: string;
  nextActions: string[];
}

export function parsePhase7DockerEnvInitArgs(
  argv: readonly string[],
): Phase7DockerEnvInitArgs {
  const parsed: Phase7DockerEnvInitArgs = {
    force: false,
    help: false,
    source: DEFAULT_PHASE7_DOCKER_ENV_SOURCE,
    target: DEFAULT_PHASE7_DOCKER_ENV_TARGET,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--force") {
      parsed.force = true;
      continue;
    }
    if (arg === "--source") {
      parsed.source = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--target") {
      parsed.target = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`${PHASE7_DOCKER_ENV_INIT_USAGE}\nUnknown option: ${arg}`);
  }

  return parsed;
}

export function createPhase7DockerEnvInitPlan(input: {
  args: Phase7DockerEnvInitArgs;
  exists: (path: string) => boolean;
}): Phase7DockerEnvInitPlan {
  const sourceExists = input.exists(input.args.source);
  const targetExists = input.exists(input.args.target);
  if (!sourceExists) {
    return {
      source: input.args.source,
      target: input.args.target,
      shouldWrite: false,
      refused: true,
      message: `${input.args.source} is missing.`,
      nextActions: [
        "Restore the Phase 7 Docker env example before creating the private runtime env file.",
      ],
    };
  }
  if (targetExists && !input.args.force) {
    return {
      source: input.args.source,
      target: input.args.target,
      shouldWrite: false,
      refused: true,
      message: `${input.args.target} already exists; refusing to overwrite private runtime values.`,
      nextActions: [
        `Review ${input.args.target}, or rerun with --force only if intentionally replacing the private Docker runtime env scaffold.`,
      ],
    };
  }
  return {
    source: input.args.source,
    target: input.args.target,
    shouldWrite: true,
    refused: false,
    message: targetExists
      ? `${input.args.target} will be replaced from ${input.args.source}.`
      : `${input.args.target} will be created from ${input.args.source}.`,
    nextActions: [
      `Fill private Docker runtime values in ${input.args.target}.`,
      "Run corepack pnpm phase7:docker:doctor --brief.",
    ],
  };
}

function readOptionValue(
  argv: readonly string[],
  index: number,
  option: string,
): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("-")) {
    throw new Error(`${PHASE7_DOCKER_ENV_INIT_USAGE}\n${option} requires a value`);
  }
  return value;
}
