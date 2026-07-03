import {
  formatPhase7DockerDoctorBrief,
  runPhase7DockerDoctor,
  type Phase7DockerDoctorReport,
  type Phase7DockerProfile,
} from "./phase7DockerDoctor.js";

export type Phase7DockerComposeAction = "up" | "ps" | "logs" | "down";

export interface Phase7DockerComposeInput {
  action: Phase7DockerComposeAction;
  composeFile?: string;
  envFile?: string;
  profiles?: readonly Phase7DockerProfile[];
  services?: readonly string[];
  follow?: boolean;
  volumes?: boolean;
  skipDoctor?: boolean;
  execFile: (
    file: string,
    args: readonly string[],
    options?: { cwd?: string },
  ) => string;
  exists: (path: string) => boolean;
  readText?: (path: string) => string;
  cwd?: string;
}

export interface Phase7DockerComposeReport {
  schema: "split402.phase7_docker_compose.v1";
  ok: boolean;
  action: Phase7DockerComposeAction;
  command: string;
  doctor?: Phase7DockerDoctorReport;
  output: string;
  error?: string;
  nextActions: string[];
}

const defaultComposeFile = "deploy/phase7-staging/compose.yaml";
const defaultEnvFile = "deploy/phase7-staging/phase7-staging.env";

export function runPhase7DockerCompose(
  input: Phase7DockerComposeInput,
): Phase7DockerComposeReport {
  const composeFile = input.composeFile ?? defaultComposeFile;
  const envFile = input.envFile ?? defaultEnvFile;
  const profiles = dedupeProfiles(input.profiles ?? []);
  const services = resolveServices(input.services ?? [], profiles);
  const args = createDockerComposeArgs({
    action: input.action,
    composeFile,
    envFile,
    profiles,
    services,
    follow: input.follow ?? false,
    volumes: input.volumes ?? false,
  });
  const command = `docker ${args.join(" ")}`;

  const doctor =
    input.skipDoctor === true
      ? undefined
      : runPhase7DockerDoctor({
          composeFile,
          envFile,
          profiles,
          execFile: input.execFile,
          exists: input.exists,
          readText: input.readText,
          cwd: input.cwd,
        });

  if (doctor !== undefined && !doctor.ready) {
    return {
      schema: "split402.phase7_docker_compose.v1",
      ok: false,
      action: input.action,
      command,
      doctor,
      output: formatPhase7DockerDoctorBrief(doctor),
      error: "Phase 7 Docker doctor is not ready; refusing to run compose command.",
      nextActions: doctor.nextActions,
    };
  }

  try {
    const output = input.execFile("docker", args, { cwd: input.cwd });
    return {
      schema: "split402.phase7_docker_compose.v1",
      ok: true,
      action: input.action,
      command,
      ...(doctor === undefined ? {} : { doctor }),
      output,
      nextActions: createSuccessActions(input.action, profiles),
    };
  } catch (error) {
    return {
      schema: "split402.phase7_docker_compose.v1",
      ok: false,
      action: input.action,
      command,
      ...(doctor === undefined ? {} : { doctor }),
      output: "",
      error: error instanceof Error ? error.message : String(error),
      nextActions: [
        "Inspect Docker Compose output, fix the runtime issue, then rerun the same command.",
      ],
    };
  }
}

interface DockerComposeArgsInput {
  action: Phase7DockerComposeAction;
  composeFile: string;
  envFile: string;
  profiles: readonly Phase7DockerProfile[];
  services: readonly string[];
  follow: boolean;
  volumes: boolean;
}

export function createDockerComposeArgs(input: DockerComposeArgsInput): string[] {
  const base = [
    "compose",
    "--env-file",
    input.envFile,
    "-f",
    input.composeFile,
    ...input.profiles.flatMap((profile) => ["--profile", profile]),
  ];

  if (input.action === "up") {
    return [...base, "up", "-d", ...input.services];
  }

  if (input.action === "ps") {
    return [...base, "ps", ...input.services];
  }

  if (input.action === "logs") {
    return [
      ...base,
      "logs",
      ...(input.follow ? ["--follow"] : []),
      ...input.services,
    ];
  }

  return [...base, "down", ...(input.volumes ? ["--volumes"] : [])];
}

function resolveServices(
  requested: readonly string[],
  profiles: readonly Phase7DockerProfile[],
): string[] {
  if (requested.length > 0) {
    return [...requested];
  }

  return [
    "postgres",
    "control-plane",
    "dashboard",
    ...(profiles.includes("demo") ? ["demo-merchant"] : []),
    ...(profiles.includes("workers")
      ? ["chain-worker", "webhook-worker", "payout-finality-worker"]
      : []),
  ];
}

function dedupeProfiles(
  profiles: readonly Phase7DockerProfile[],
): Phase7DockerProfile[] {
  return [...new Set(profiles)];
}

function createSuccessActions(
  action: Phase7DockerComposeAction,
  profiles: readonly Phase7DockerProfile[],
): string[] {
  if (action === "up") {
    return [
      "Wait for service healthchecks, then run Phase 7 hosted preflight and evidence collection from the same host.",
      `Run corepack pnpm phase7:docker:compose ps${
        profiles.length === 0
          ? ""
          : ` ${profiles.map((profile) => `--profile ${profile}`).join(" ")}`
      } to inspect service state.`,
    ];
  }

  if (action === "down") {
    return ["Rerun the Docker doctor before starting the staging stack again."];
  }

  return [];
}
