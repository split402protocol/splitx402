export interface Phase7DockerDoctorInput {
  composeFile?: string;
  envFile?: string;
  execFile: (
    file: string,
    args: readonly string[],
    options?: { cwd?: string },
  ) => string;
  exists: (path: string) => boolean;
  cwd?: string;
}

export interface Phase7DockerDoctorCheck {
  name:
    | "docker_cli"
    | "docker_compose_plugin"
    | "compose_file"
    | "compose_env_file"
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
  checks: Phase7DockerDoctorCheck[];
  nextActions: string[];
}

const defaultComposeFile = "deploy/phase7-staging/compose.yaml";
const defaultEnvFile = "deploy/phase7-staging/phase7-staging.env";

export function runPhase7DockerDoctor(
  input: Phase7DockerDoctorInput,
): Phase7DockerDoctorReport {
  const composeFile = input.composeFile ?? defaultComposeFile;
  const envFile = input.envFile ?? defaultEnvFile;
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
      : `${envFile} is missing. Copy deploy/phase7-staging/phase7-staging.env.example to ${envFile} and fill staging values.`,
  });

  const shouldValidateComposeConfig =
    dockerVersion.ok && composeVersion.ok && composeFileExists && envFileExists;
  const composeConfig = shouldValidateComposeConfig
    ? runCommand(input, "docker", createComposeConfigArgs(composeFile, envFile))
    : {
        ok: false as const,
        output: "",
        error: "Skipped until Docker, Compose, compose.yaml, and phase7-staging.env are available.",
      };
  checks.push({
    name: "compose_config",
    ok: composeConfig.ok,
    required: true,
    command: `docker ${createComposeConfigArgs(composeFile, envFile).join(" ")}`,
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
    checks,
    nextActions: createNextActions(checks, composeFile, envFile),
  };
}

function createComposeConfigArgs(
  composeFile: string,
  envFile: string,
): string[] {
  return [
    "compose",
    "--env-file",
    envFile,
    "-f",
    composeFile,
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
): string[] {
  const failed = new Set(
    checks.filter((check) => check.required && !check.ok).map((check) => check.name),
  );
  const actions: string[] = [];

  if (failed.has("docker_cli")) {
    actions.push("Install Docker Engine or Docker Desktop on the host that will run Phase 7 staging.");
  }
  if (failed.has("docker_compose_plugin")) {
    actions.push("Install Docker Compose v2 so `docker compose version` succeeds.");
  }
  if (failed.has("compose_env_file")) {
    actions.push(
      `Copy deploy/phase7-staging/phase7-staging.env.example to ${envFile} and fill the private staging values on the host.`,
    );
  }
  if (failed.has("compose_config")) {
    actions.push(
      `Rerun \`docker ${createComposeConfigArgs(composeFile, envFile).join(" ")}\` after Docker and ${envFile} are ready.`,
    );
  }
  if (actions.length === 0) {
    actions.push(
      `Run \`docker compose -f ${composeFile} up -d postgres control-plane dashboard\`, then wait for healthy services.`,
    );
  }

  return actions;
}
