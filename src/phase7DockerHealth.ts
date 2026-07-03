import {
  formatPhase7DockerDoctorBrief,
  runPhase7DockerDoctor,
  type Phase7DockerDoctorReport,
  type Phase7DockerProfile,
} from "./phase7DockerDoctor.js";

export interface Phase7DockerHealthInput {
  composeFile?: string;
  envFile?: string;
  profiles?: readonly Phase7DockerProfile[];
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

export interface Phase7DockerHealthService {
  service: string;
  required: boolean;
  state: string;
  health: string;
  ok: boolean;
  detail: string;
}

export interface Phase7DockerHealthReport {
  schema: "split402.phase7_docker_health.v1";
  ready: boolean;
  composeFile: string;
  envFile: string;
  profiles: Phase7DockerProfile[];
  command: string;
  doctor?: Phase7DockerDoctorReport;
  services: Phase7DockerHealthService[];
  errors: string[];
  nextActions: string[];
}

interface DockerComposePsService {
  Service?: unknown;
  Name?: unknown;
  State?: unknown;
  Health?: unknown;
  ExitCode?: unknown;
}

const defaultComposeFile = "deploy/phase7-staging/compose.yaml";
const defaultEnvFile = "deploy/phase7-staging/phase7-staging.env";
const healthcheckedServices = new Set([
  "postgres",
  "control-plane",
  "dashboard",
  "demo-merchant",
]);

export function runPhase7DockerHealth(
  input: Phase7DockerHealthInput,
): Phase7DockerHealthReport {
  const composeFile = input.composeFile ?? defaultComposeFile;
  const envFile = input.envFile ?? defaultEnvFile;
  const profiles = dedupeProfiles(input.profiles ?? []);
  const commandArgs = createDockerComposePsArgs(composeFile, envFile, profiles);
  const command = `docker ${commandArgs.join(" ")}`;

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
      schema: "split402.phase7_docker_health.v1",
      ready: false,
      composeFile,
      envFile,
      profiles,
      command,
      doctor,
      services: [],
      errors: ["Phase 7 Docker doctor is not ready; refusing to trust compose health."],
      nextActions: doctor.nextActions,
    };
  }

  let output: string;
  try {
    output = input.execFile("docker", commandArgs, { cwd: input.cwd });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      schema: "split402.phase7_docker_health.v1",
      ready: false,
      composeFile,
      envFile,
      profiles,
      command,
      ...(doctor === undefined ? {} : { doctor }),
      services: [],
      errors: [`Docker compose ps failed: ${message}`],
      nextActions: [
        "Start the Phase 7 Docker stack, then rerun the health check from the same host.",
      ],
    };
  }

  const parsed = parseDockerComposePsJson(output);
  if (!parsed.ok) {
    return {
      schema: "split402.phase7_docker_health.v1",
      ready: false,
      composeFile,
      envFile,
      profiles,
      command,
      ...(doctor === undefined ? {} : { doctor }),
      services: [],
      errors: [parsed.error],
      nextActions: [
        "Rerun `docker compose ps --format json` and keep the raw output for debugging.",
      ],
    };
  }

  const services = evaluateServices(parsed.services, profiles);
  const errors = services.filter((service) => !service.ok).map((service) => service.detail);
  return {
    schema: "split402.phase7_docker_health.v1",
    ready: errors.length === 0,
    composeFile,
    envFile,
    profiles,
    command,
    ...(doctor === undefined ? {} : { doctor }),
    services,
    errors,
    nextActions:
      errors.length === 0
        ? ["Collect Phase 7 hosted proof artifacts from this same running stack."]
        : [
            "Inspect container logs, wait for healthchecks to pass, then rerun the Docker health check.",
          ],
  };
}

export function createDockerComposePsArgs(
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
    "ps",
    "--format",
    "json",
  ];
}

export function formatPhase7DockerHealthBrief(
  report: Phase7DockerHealthReport,
): string {
  const lines = [
    `Split402 Phase 7 Docker health: ${report.ready ? "ready" : "not ready"}`,
    `Compose file: ${report.composeFile}`,
    `Env file: ${report.envFile}`,
    `Profiles: ${report.profiles.length === 0 ? "base" : report.profiles.join(", ")}`,
    `Command: ${report.command}`,
    "",
    "Services:",
    ...report.services.map(
      (service) =>
        `- ${service.ok ? "pass" : "fail"}: ${service.service} - ${service.detail}`,
    ),
  ];

  if (report.doctor !== undefined && !report.doctor.ready) {
    lines.push("", formatPhase7DockerDoctorBrief(report.doctor).trim());
  }
  if (report.errors.length > 0) {
    lines.push("", "Errors:", ...report.errors.map((error) => `- ${error}`));
  }
  if (report.nextActions.length > 0) {
    lines.push(
      "",
      "Next actions:",
      ...report.nextActions.map((action) => `- ${action}`),
    );
  }

  return `${lines.join("\n")}\n`;
}

function parseDockerComposePsJson(
  output: string,
):
  | { ok: true; services: DockerComposePsService[] }
  | { ok: false; error: string } {
  const trimmed = output.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "Docker compose ps returned empty output." };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return { ok: true, services: parsed as DockerComposePsService[] };
    }
    if (isRecord(parsed)) {
      return { ok: true, services: [parsed as DockerComposePsService] };
    }
    return { ok: false, error: "Docker compose ps JSON was not an object or array." };
  } catch {
    const services: DockerComposePsService[] = [];
    for (const line of trimmed.split(/\r?\n/u)) {
      try {
        const parsedLine = JSON.parse(line) as unknown;
        if (!isRecord(parsedLine)) {
          return { ok: false, error: "Docker compose ps JSON line was not an object." };
        }
        services.push(parsedLine as DockerComposePsService);
      } catch (error) {
        return {
          ok: false,
          error: `Docker compose ps JSON could not be parsed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
    }
    return { ok: true, services };
  }
}

function evaluateServices(
  services: readonly DockerComposePsService[],
  profiles: readonly Phase7DockerProfile[],
): Phase7DockerHealthService[] {
  const byService = new Map<string, DockerComposePsService>();
  for (const service of services) {
    const name = stringify(service.Service);
    if (name.length > 0) {
      byService.set(name, service);
    }
  }

  return expectedServices(profiles).map((service) => {
    const record = byService.get(service);
    if (record === undefined) {
      return {
        service,
        required: true,
        state: "missing",
        health: "missing",
        ok: false,
        detail: `${service} is missing from docker compose ps output.`,
      };
    }

    const state = stringify(record.State).toLowerCase();
    const health = stringify(record.Health).toLowerCase();
    const exitCode = stringify(record.ExitCode);
    const needsHealth = healthcheckedServices.has(service);
    const stateOk = state === "running";
    const healthOk = needsHealth ? health === "healthy" : health.length === 0 || health === "healthy";
    const ok = stateOk && healthOk;
    return {
      service,
      required: true,
      state: state.length === 0 ? "unknown" : state,
      health: health.length === 0 ? "none" : health,
      ok,
      detail: ok
        ? `${service} is running${needsHealth ? " and healthy" : ""}.`
        : `${service} is not ready (state=${state || "unknown"}, health=${
            health || "none"
          }${exitCode.length === 0 ? "" : `, exitCode=${exitCode}`}).`,
    };
  });
}

function expectedServices(profiles: readonly Phase7DockerProfile[]): string[] {
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

function stringify(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
