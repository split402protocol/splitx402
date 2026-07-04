export const PHASE7_SEED_ENV_APPLY_USAGE =
  "Usage: corepack pnpm phase7:staging:apply-seed-env --seed-output <path> [--phase7-env <path>] [--docker-env <path>] [--dry-run]";

export const DEFAULT_PHASE7_SEED_ENV_APPLY_PHASE7_TARGET =
  "split402-launch-evidence/phase7-staging.env";
export const DEFAULT_PHASE7_SEED_ENV_APPLY_DOCKER_TARGET =
  "deploy/phase7-staging/phase7-staging.env";

export const PHASE7_SEED_ENV_APPLY_PHASE7_KEYS = [
  "SPLIT402_PHASE7_CONTROL_PLANE_TOKEN",
  "SPLIT402_PHASE7_MERCHANT_ID",
  "SPLIT402_PHASE7_REFERRER_WALLET",
  "SPLIT402_DASHBOARD_MERCHANT_ID",
  "SPLIT402_DASHBOARD_REFERRER_WALLET",
  "SPLIT402_MERCHANT_ORIGIN",
  "SPLIT402_MERCHANT_PUBLIC_KEY",
  "SPLIT402_MCP_CONTROL_PLANE_TOKEN",
  "SPLIT402_MCP_CAPABILITY",
  "SPLIT402_MCP_WALLET",
  "SPLIT402_MCP_MAX_AMOUNT_ATOMIC",
] as const;

export const PHASE7_SEED_ENV_APPLY_DOCKER_KEYS = [
  "SPLIT402_DASHBOARD_MERCHANT_ID",
  "SPLIT402_DASHBOARD_REFERRER_WALLET",
  "SPLIT402_DASHBOARD_CONTROL_PLANE_TOKEN",
  "SPLIT402_MERCHANT_PAY_TO",
] as const;

export type Phase7SeedEnvApplyKey =
  | (typeof PHASE7_SEED_ENV_APPLY_PHASE7_KEYS)[number]
  | (typeof PHASE7_SEED_ENV_APPLY_DOCKER_KEYS)[number];

export interface Phase7SeedEnvApplyArgs {
  seedOutput: string | undefined;
  phase7Env: string;
  dockerEnv: string;
  dryRun: boolean;
  help: boolean;
}

export interface Phase7SeedEnvApplyTargetResult {
  target: string;
  written: boolean;
  updatedKeys: string[];
  skippedKeys: string[];
}

export interface Phase7SeedEnvApplyResult {
  schema: "split402.phase7_seed_env_apply.v1";
  seedOutput: string;
  dryRun: boolean;
  targets: Phase7SeedEnvApplyTargetResult[];
  ignoredProofEnvKeys: string[];
  nextActions: string[];
}

export function parsePhase7SeedEnvApplyArgs(
  argv: readonly string[],
): Phase7SeedEnvApplyArgs {
  const parsed: Phase7SeedEnvApplyArgs = {
    seedOutput: undefined,
    phase7Env: DEFAULT_PHASE7_SEED_ENV_APPLY_PHASE7_TARGET,
    dockerEnv: DEFAULT_PHASE7_SEED_ENV_APPLY_DOCKER_TARGET,
    dryRun: false,
    help: false,
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
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (arg === "--seed-output") {
      parsed.seedOutput = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--phase7-env") {
      parsed.phase7Env = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--docker-env") {
      parsed.dockerEnv = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`${PHASE7_SEED_ENV_APPLY_USAGE}\nUnknown option: ${arg}`);
  }

  return parsed;
}

export function extractPhase7SeedProofEnv(seedOutputText: string): Record<string, string> {
  const parsed = parseSeedOutputJson(seedOutputText);
  if (!isRecord(parsed)) {
    throw new Error("seed output must be a JSON object");
  }
  const proofEnv = parsed.proofEnv;
  if (!isRecord(proofEnv)) {
    throw new Error("seed output must contain a proofEnv object");
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(proofEnv)) {
    if (typeof value !== "string") {
      throw new Error(`proofEnv.${key} must be a string`);
    }
    result[key] = value;
  }
  return result;
}

function parseSeedOutputJson(seedOutputText: string): unknown {
  try {
    return JSON.parse(seedOutputText) as unknown;
  } catch {
    const jsonText = extractJsonObjectAroundProofEnv(seedOutputText);
    return JSON.parse(jsonText) as unknown;
  }
}

function extractJsonObjectAroundProofEnv(seedOutputText: string): string {
  const markerIndex = seedOutputText.indexOf('"proofEnv"');
  if (markerIndex < 0) {
    throw new Error(
      "seed output must contain a JSON object with a proofEnv object",
    );
  }

  for (
    let startIndex = seedOutputText.indexOf("{");
    startIndex >= 0 && startIndex < markerIndex;
    startIndex = seedOutputText.indexOf("{", startIndex + 1)
  ) {
    const candidate = extractJsonObjectFromStart(seedOutputText, startIndex);
    if (candidate === undefined) {
      continue;
    }
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (isRecord(parsed) && isRecord(parsed.proofEnv)) {
        return candidate;
      }
    } catch {
      continue;
    }
  }

  throw new Error(
    "seed output must contain a JSON object with a proofEnv object",
  );
}

function extractJsonObjectFromStart(
  seedOutputText: string,
  startIndex: number,
): string | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = startIndex; index < seedOutputText.length; index += 1) {
    const char = seedOutputText[index];
    if (char === undefined) {
      continue;
    }
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return seedOutputText.slice(startIndex, index + 1);
      }
    }
  }

  return undefined;
}

export function applyPhase7SeedProofEnvToText(input: {
  text: string;
  proofEnv: Record<string, string>;
  allowedKeys: readonly string[];
}): {
  text: string;
  updatedKeys: string[];
  skippedKeys: string[];
} {
  const allowedKeys = new Set(input.allowedKeys);
  const pending = new Map<string, string>();
  const skippedKeys: string[] = [];
  for (const key of input.allowedKeys) {
    const value = input.proofEnv[key];
    if (value === undefined || value.trim().length === 0) {
      skippedKeys.push(key);
      continue;
    }
    pending.set(key, value);
  }

  const updatedKeys = new Set<string>();
  const lines = input.text.split(/\r?\n/u);
  const nextLines = lines.map((line) => {
    const match = /^\s*#?\s*([A-Z0-9_]+)=(.*)$/u.exec(line);
    const key = match?.[1];
    if (key === undefined || !allowedKeys.has(key)) {
      return line;
    }
    const value = pending.get(key);
    if (value === undefined) {
      return line;
    }
    updatedKeys.add(key);
    return formatEnvAssignment(key, value);
  });

  const missingAssignments = [...pending.entries()]
    .filter(([key]) => !updatedKeys.has(key))
    .map(([key, value]) => formatEnvAssignment(key, value));
  if (missingAssignments.length > 0) {
    const insert = [
      "# Values copied from phase7:staging:seed proofEnv.",
      ...missingAssignments,
    ];
    if (nextLines.length > 0 && nextLines.at(-1) === "") {
      nextLines.splice(nextLines.length - 1, 0, ...insert);
    } else {
      nextLines.push(...insert);
    }
    for (const assignment of missingAssignments) {
      const key = assignment.slice(0, assignment.indexOf("="));
      updatedKeys.add(key);
    }
  }

  return {
    text: nextLines.join("\n"),
    updatedKeys: [...updatedKeys],
    skippedKeys,
  };
}

export function createPhase7SeedEnvApplyResult(input: {
  seedOutput: string;
  dryRun: boolean;
  proofEnv: Record<string, string>;
  phase7Target: Phase7SeedEnvApplyTargetResult;
  dockerTarget: Phase7SeedEnvApplyTargetResult;
}): Phase7SeedEnvApplyResult {
  const supportedKeys = new Set<string>([
    ...PHASE7_SEED_ENV_APPLY_PHASE7_KEYS,
    ...PHASE7_SEED_ENV_APPLY_DOCKER_KEYS,
  ]);
  const ignoredProofEnvKeys = Object.keys(input.proofEnv)
    .filter((key) => !supportedKeys.has(key))
    .sort();
  return {
    schema: "split402.phase7_seed_env_apply.v1",
    seedOutput: input.seedOutput,
    dryRun: input.dryRun,
    targets: [input.phase7Target, input.dockerTarget],
    ignoredProofEnvKeys,
    nextActions: [
      "Review the updated private env files locally; do not commit filled token or key values.",
      "Run corepack pnpm product:launch-preflight --brief --workspace split402-launch-evidence.",
      "Run corepack pnpm phase7:docker:doctor --brief.",
    ],
  };
}

function formatEnvAssignment(key: string, value: string): string {
  return `${key}=${formatEnvValue(value)}`;
}

function formatEnvValue(value: string): string {
  if (/^[^\s#"'\\]+$/u.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionValue(
  argv: readonly string[],
  index: number,
  option: string,
): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("-")) {
    throw new Error(`${PHASE7_SEED_ENV_APPLY_USAGE}\n${option} requires a value`);
  }
  return value;
}
