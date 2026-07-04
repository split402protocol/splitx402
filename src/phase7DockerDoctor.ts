import dotenv from "dotenv";

import { PHASE7_DOCKER_GENERATED_SECRET_KEYS } from "./phase7DockerEnvInit.js";

export interface Phase7DockerDoctorInput {
  composeFile?: string;
  envFile?: string;
  profiles?: readonly Phase7DockerProfile[];
  execFile: (
    file: string,
    args: readonly string[],
    options?: { cwd?: string },
  ) => string;
  exists: (path: string) => boolean;
  readText?: (path: string) => string;
  cwd?: string;
}

export interface Phase7DockerDoctorCheck {
  name:
    | "docker_cli"
    | "docker_daemon"
    | "docker_compose_plugin"
    | "compose_file"
    | "compose_env_file"
    | "compose_env_values"
    | "compose_config";
  ok: boolean;
  required: boolean;
  command?: string;
  detail: string;
}

export interface Phase7DockerDoctorReport {
  schema: "split402.phase7_docker_doctor.v1";
  ready: boolean;
  composeFile: string;
  envFile: string;
  profiles: Phase7DockerProfile[];
  checks: Phase7DockerDoctorCheck[];
  nextActions: string[];
}

export type Phase7DockerProfile = "demo" | "workers";

const defaultComposeFile = "deploy/phase7-staging/compose.yaml";
const defaultEnvFile = "deploy/phase7-staging/phase7-staging.env";
const requiredBaseEnvKeys = [
  "SPLIT402_DASHBOARD_VIEWER_TOKEN",
  "SPLIT402_DASHBOARD_CONTROL_PLANE_TOKEN",
] as const;
const requiredProfileEnvKeys: Record<Phase7DockerProfile, readonly string[]> = {
  demo: [
    "SPLIT402_MERCHANT_PAY_TO",
    "SPLIT402_SERVICE_SEED_HEX",
  ],
  workers: [
    "SPLIT402_WEBHOOK_WORKER_URL",
    "SPLIT402_WEBHOOK_WORKER_SECRET",
  ],
};

export function runPhase7DockerDoctor(
  input: Phase7DockerDoctorInput,
): Phase7DockerDoctorReport {
  const composeFile = input.composeFile ?? defaultComposeFile;
  const envFile = input.envFile ?? defaultEnvFile;
  const profiles = dedupeProfiles(input.profiles ?? []);
  const checks: Phase7DockerDoctorCheck[] = [];

  const dockerVersion = runCommand(input, "docker", ["--version"]);
  checks.push({
    name: "docker_cli",
    ok: dockerVersion.ok,
    required: true,
    command: "docker --version",
    detail: dockerVersion.ok
      ? dockerVersion.output
      : formatCommandFailure("Docker CLI is not available", dockerVersion.error),
  });

  const dockerDaemon = dockerVersion.ok
    ? runCommand(input, "docker", ["info", "--format", "{{.ServerVersion}}"])
    : {
        ok: false as const,
        output: "",
        error: "Docker CLI check failed first.",
      };
  checks.push({
    name: "docker_daemon",
    ok: dockerDaemon.ok,
    required: true,
    command: "docker info --format {{.ServerVersion}}",
    detail: dockerDaemon.ok
      ? `Docker daemon is running (server ${dockerDaemon.output}).`
      : formatCommandFailure(
          "Docker daemon is not reachable; start Docker Desktop or Docker Engine",
          dockerDaemon.error,
        ),
  });

  const composeVersion = dockerVersion.ok
    ? runCommand(input, "docker", ["compose", "version"])
    : {
        ok: false as const,
        output: "",
        error: "Docker CLI check failed first.",
      };
  checks.push({
    name: "docker_compose_plugin",
    ok: composeVersion.ok,
    required: true,
    command: "docker compose version",
    detail: composeVersion.ok
      ? composeVersion.output
      : formatCommandFailure(
          "Docker Compose v2 plugin is not available",
          composeVersion.error,
        ),
  });

  const composeFileExists = input.exists(composeFile);
  checks.push({
    name: "compose_file",
    ok: composeFileExists,
    required: true,
    detail: composeFileExists
      ? `${composeFile} exists.`
      : `${composeFile} is missing.`,
  });

  const envFileExists = input.exists(envFile);
  checks.push({
    name: "compose_env_file",
    ok: envFileExists,
    required: true,
    detail: envFileExists
      ? `${envFile} exists.`
      : `${envFile} is missing. Run corepack pnpm phase7:docker:env:init --generate-secrets${
          envFile === defaultEnvFile ? "" : ` --target ${envFile}`
        }, then fill remaining staging values.`,
  });

  const envValues = envFileExists
    ? validateEnvValues(input, envFile, profiles)
    : {
        ok: false,
        detail: `Skipped until ${envFile} exists.`,
        generatedSecretPlaceholders: [],
      };
  checks.push({
    name: "compose_env_values",
    ok: envValues.ok,
    required: true,
    detail: envValues.detail,
  });

  const shouldValidateComposeConfig =
    dockerVersion.ok &&
    dockerDaemon.ok &&
    composeVersion.ok &&
    composeFileExists &&
    envFileExists &&
    envValues.ok;
  const composeConfig = shouldValidateComposeConfig
    ? runCommand(
        input,
        "docker",
        createComposeConfigArgs(composeFile, envFile, profiles),
      )
    : {
        ok: false as const,
        output: "",
        error:
          "Skipped until Docker CLI, Docker daemon, Compose, compose.yaml, phase7-staging.env, and required env values are ready.",
      };
  checks.push({
    name: "compose_config",
    ok: composeConfig.ok,
    required: true,
    command: `docker ${createComposeConfigArgs(composeFile, envFile, profiles).join(" ")}`,
    detail: composeConfig.ok
      ? "Compose configuration is valid."
      : formatCommandFailure(
          "Compose configuration could not be validated",
          composeConfig.error,
        ),
  });

  const ready = checks.every((check) => !check.required || check.ok);
  return {
    schema: "split402.phase7_docker_doctor.v1",
    ready,
    composeFile,
    envFile,
    profiles,
    checks,
    nextActions: createNextActions(checks, composeFile, envFile, profiles, envValues),
  };
}

function createComposeConfigArgs(
  composeFile: string,
  envFile: string,
  profiles: readonly Phase7DockerProfile[],
): string[] {
  return [
    "compose",
    "--env-file",
    envFile,
    "-f",
    composeFile,
    ...profiles.flatMap((profile) => ["--profile", profile]),
    "config",
    "--quiet",
  ];
}

export function formatPhase7DockerDoctorBrief(
  report: Phase7DockerDoctorReport,
): string {
  const lines = [
    `Split402 Phase 7 Docker doctor: ${report.ready ? "ready" : "not ready"}`,
    `Compose file: ${report.composeFile}`,
    `Env file: ${report.envFile}`,
    `Profiles: ${report.profiles.length === 0 ? "base" : report.profiles.join(", ")}`,
    "",
    "Checks:",
    ...report.checks.map(
      (check) => `- ${check.ok ? "pass" : "fail"}: ${check.name} - ${check.detail}`,
    ),
  ];

  if (report.nextActions.length > 0) {
    lines.push("", "Next actions:");
    lines.push(...report.nextActions.map((action) => `- ${action}`));
  }

  return `${lines.join("\n")}\n`;
}

interface CommandResult {
  ok: boolean;
  output: string;
  error: string;
}

function runCommand(
  input: Phase7DockerDoctorInput,
  file: string,
  args: readonly string[],
): CommandResult {
  try {
    const output = input.execFile(file, args, { cwd: input.cwd }).trim();
    return { ok: true, output, error: "" };
  } catch (error) {
    return {
      ok: false,
      output: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function formatCommandFailure(message: string, error: string): string {
  const trimmed = error.trim();
  return trimmed.length === 0 ? `${message}.` : `${message}: ${trimmed}`;
}

function createNextActions(
  checks: readonly Phase7DockerDoctorCheck[],
  composeFile: string,
  envFile: string,
  profiles: readonly Phase7DockerProfile[],
  envValues: EnvValidationResult,
): string[] {
  const failed = new Set(
    checks.filter((check) => check.required && !check.ok).map((check) => check.name),
  );
  const actions: string[] = [];
  const dockerCliFailed = failed.has("docker_cli");

  if (dockerCliFailed) {
    actions.push("Install Docker Engine or Docker Desktop on the host that will run Phase 7 staging.");
  }
  if (!dockerCliFailed && failed.has("docker_daemon")) {
    actions.push(
      "Start Docker Desktop or Docker Engine, then rerun `corepack pnpm phase7:docker:doctor --brief`.",
    );
  }
  if (!dockerCliFailed && failed.has("docker_compose_plugin")) {
    actions.push("Install Docker Compose v2 so `docker compose version` succeeds.");
  }
  if (failed.has("compose_env_file")) {
    actions.push(
      `Run corepack pnpm phase7:docker:env:init --generate-secrets${
        envFile === defaultEnvFile ? "" : ` --target ${envFile}`
      }, then fill remaining ${envFile} values on the host.`,
    );
  }
  if (failed.has("compose_env_values")) {
    if (envValues.generatedSecretPlaceholders.length > 0) {
      actions.push(
        `Regenerate local Docker runtime secrets with \`corepack pnpm phase7:docker:env:init --generate-secrets${
          envFile === defaultEnvFile ? "" : ` --target ${envFile}`
        }\`; this replaces generated placeholders for ${envValues.generatedSecretPlaceholders.join(
          ", ",
        )} while preserving existing filled values, but still requires hosted URLs, wallets, control-plane tokens, and keys to be filled privately.`,
      );
    }
    actions.push(
      `Fill missing private runtime values and replace template placeholders in ${envFile}; do not commit this file.`,
    );
  }
  if (failed.has("compose_config")) {
    actions.push(
      `Rerun \`docker ${createComposeConfigArgs(composeFile, envFile, profiles).join(" ")}\` after Docker and ${envFile} are ready.`,
    );
  }
  if (actions.length === 0) {
    actions.push(
      `Run \`${createComposeUpCommand(composeFile, profiles)}\`, then wait for healthy services.`,
    );
  }

  return actions;
}

interface EnvValidationResult {
  ok: boolean;
  detail: string;
  generatedSecretPlaceholders: string[];
}

function validateEnvValues(
  input: Phase7DockerDoctorInput,
  envFile: string,
  profiles: readonly Phase7DockerProfile[],
): EnvValidationResult {
  if (input.readText === undefined) {
    return {
      ok: false,
      detail: `${envFile} exists, but env values could not be inspected by this runner.`,
      generatedSecretPlaceholders: [],
    };
  }

  let parsed: Record<string, string>;
  try {
    parsed = dotenv.parse(input.readText(envFile));
  } catch (error) {
    return {
      ok: false,
      detail: `${envFile} could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
      generatedSecretPlaceholders: [],
    };
  }

  const requiredKeys = [
    ...requiredBaseEnvKeys,
    ...profiles.flatMap((profile) => requiredProfileEnvKeys[profile]),
  ];
  const missingRequired = requiredKeys.filter(
    (key) => !hasConfiguredEnvValue(parsed[key]),
  );
  const placeholderKeys = Object.entries(parsed)
    .filter(([, value]) => value.trim().length > 0 && isPlaceholderEnvValue(value))
    .map(([key]) => key)
    .sort();
  const generatedSecretPlaceholders = placeholderKeys.filter((key) =>
    PHASE7_DOCKER_GENERATED_SECRET_KEYS.includes(
      key as (typeof PHASE7_DOCKER_GENERATED_SECRET_KEYS)[number],
    ),
  );

  if (missingRequired.length > 0 || placeholderKeys.length > 0) {
    const details = [
      ...(missingRequired.length === 0
        ? []
        : [`missing required values: ${missingRequired.join(", ")}`]),
      ...(placeholderKeys.length === 0
        ? []
        : [`replace template placeholders: ${placeholderKeys.join(", ")}`]),
    ];
    return {
      ok: false,
      detail: `${envFile} is not ready (${details.join("; ")}).`,
      generatedSecretPlaceholders,
    };
  }

  return {
    ok: true,
    detail: `${envFile} has required ${describeProfileSet(profiles)} runtime values and no obvious template placeholders.`,
    generatedSecretPlaceholders: [],
  };
}

function dedupeProfiles(
  profiles: readonly Phase7DockerProfile[],
): Phase7DockerProfile[] {
  return [...new Set(profiles)];
}

function createComposeUpCommand(
  composeFile: string,
  profiles: readonly Phase7DockerProfile[],
): string {
  const profileArgs = profiles
    .map((profile) => `--profile ${profile}`)
    .join(" ");
  const services = [
    "postgres",
    "control-plane",
    "dashboard",
    ...(profiles.includes("demo") ? ["demo-merchant"] : []),
    ...(profiles.includes("workers")
      ? ["chain-worker", "webhook-worker", "payout-finality-worker"]
      : []),
  ].join(" ");
  return `docker compose -f ${composeFile}${
    profileArgs.length === 0 ? "" : ` ${profileArgs}`
  } up -d ${services}`;
}

function describeProfileSet(profiles: readonly Phase7DockerProfile[]): string {
  return profiles.length === 0 ? "base" : `base+${profiles.join("+")}`;
}

function hasConfiguredEnvValue(value: string | undefined): boolean {
  return value !== undefined && !isPlaceholderEnvValue(value);
}

function isPlaceholderEnvValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.length === 0 ||
    normalized === "todo" ||
    normalized === "tbd" ||
    normalized === "pending" ||
    normalized === "replace-me" ||
    normalized.startsWith("<") ||
    normalized.includes("...") ||
    normalized.includes("replace-with") ||
    normalized.includes("yyyy")
  );
}
