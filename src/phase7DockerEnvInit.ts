export const PHASE7_DOCKER_ENV_INIT_USAGE =
  "Usage: corepack pnpm phase7:docker:env:init [--force] [--generate-secrets] [--source <path>] [--target <path>]";

export const DEFAULT_PHASE7_DOCKER_ENV_SOURCE =
  "deploy/phase7-staging/phase7-staging.env.example";
export const DEFAULT_PHASE7_DOCKER_ENV_TARGET =
  "deploy/phase7-staging/phase7-staging.env";

export interface Phase7DockerEnvInitArgs {
  force: boolean;
  generateSecrets: boolean;
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

export const PHASE7_DOCKER_GENERATED_SECRET_KEYS = [
  "SPLIT402_DASHBOARD_VIEWER_TOKEN",
  "SPLIT402_WEBHOOK_WORKER_SECRET",
] as const;

export function parsePhase7DockerEnvInitArgs(
  argv: readonly string[],
): Phase7DockerEnvInitArgs {
  const parsed: Phase7DockerEnvInitArgs = {
    force: false,
    generateSecrets: false,
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
    if (arg === "--generate-secrets") {
      parsed.generateSecrets = true;
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

export function populatePhase7DockerGeneratedSecrets(
  text: string,
  generateSecret: () => string,
): string {
  return text
    .split(/\r?\n/u)
    .map((line) => populateGeneratedSecretLine(line, generateSecret))
    .join("\n");
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
      input.args.generateSecrets
        ? `Generated private runtime secrets in ${input.args.target}; fill the remaining URLs, wallets, control-plane tokens, and keys manually.`
        : `Fill private Docker runtime values in ${input.args.target}, or rerun with --generate-secrets to create local runtime secrets automatically.`,
      "Run corepack pnpm phase7:docker:doctor --brief.",
    ],
  };
}

function populateGeneratedSecretLine(
  line: string,
  generateSecret: () => string,
): string {
  const match = /^([A-Z0-9_]+)=(.*)$/u.exec(line);
  if (match === null) {
    return line;
  }
  const key = match[1];
  const value = match[2];
  if (key === undefined || value === undefined) {
    return line;
  }
  if (
    !PHASE7_DOCKER_GENERATED_SECRET_KEYS.includes(
      key as (typeof PHASE7_DOCKER_GENERATED_SECRET_KEYS)[number],
    ) ||
    !shouldReplaceGeneratedSecretValue(value)
  ) {
    return line;
  }
  return `${key}=${generateSecret()}`;
}

function shouldReplaceGeneratedSecretValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.length === 0 ||
    normalized === "replace-me" ||
    normalized.includes("replace-with")
  );
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
