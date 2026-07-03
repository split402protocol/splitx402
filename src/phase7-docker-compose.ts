import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import {
  runPhase7DockerCompose,
  type Phase7DockerComposeAction,
} from "./phase7DockerCompose.js";
import type { Phase7DockerProfile } from "./phase7DockerDoctor.js";

const PHASE7_DOCKER_COMPOSE_USAGE =
  "Usage: corepack pnpm phase7:docker:compose <up|ps|logs|down> [--brief] [--compose-file <path>] [--env-file <path>] [--profile demo|workers] [--service <name>] [--follow] [--volumes] [--skip-doctor]";

const args = parseCliArgs(process.argv.slice(2));
if (args.help) {
  console.log(PHASE7_DOCKER_COMPOSE_USAGE);
  process.exit(0);
}

const report = runPhase7DockerCompose({
  action: args.action,
  ...(args.composeFile === undefined ? {} : { composeFile: args.composeFile }),
  ...(args.envFile === undefined ? {} : { envFile: args.envFile }),
  profiles: args.profiles,
  services: args.services,
  follow: args.follow,
  volumes: args.volumes,
  skipDoctor: args.skipDoctor,
  cwd: process.cwd(),
  exists: existsSync,
  readText: (path) => readFileSync(path, "utf8"),
  execFile: (file, commandArgs, options) =>
    execFileSync(file, [...commandArgs], {
      cwd: options?.cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
});

console.log(args.brief ? formatBrief(report) : JSON.stringify(report, null, 2));

if (!report.ok) {
  process.exitCode = 1;
}

interface Phase7DockerComposeCliArgs {
  action: Phase7DockerComposeAction;
  brief: boolean;
  composeFile?: string;
  envFile?: string;
  follow: boolean;
  help: boolean;
  profiles: Phase7DockerProfile[];
  services: string[];
  skipDoctor: boolean;
  volumes: boolean;
}

function parseCliArgs(argv: readonly string[]): Phase7DockerComposeCliArgs {
  try {
    return parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function parseArgs(argv: readonly string[]): Phase7DockerComposeCliArgs {
  const parsed: Phase7DockerComposeCliArgs = {
    action: "ps",
    brief: false,
    follow: false,
    help: false,
    profiles: [],
    services: [],
    skipDoctor: false,
    volumes: false,
  };

  if (argv.length === 0) {
    throw new Error(PHASE7_DOCKER_COMPOSE_USAGE);
  }

  const first = argv[0];
  const rest = argv.slice(1);
  if (first === undefined) {
    throw new Error(PHASE7_DOCKER_COMPOSE_USAGE);
  }
  if (first === "--help" || first === "-h") {
    parsed.help = true;
    return parsed;
  }
  parsed.action = readAction(first);

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--brief") {
      parsed.brief = true;
    } else if (arg === "--compose-file") {
      parsed.composeFile = readOptionValue(rest, index, arg);
      index += 1;
    } else if (arg === "--env-file") {
      parsed.envFile = readOptionValue(rest, index, arg);
      index += 1;
    } else if (arg === "--profile") {
      parsed.profiles.push(readProfile(readOptionValue(rest, index, arg)));
      index += 1;
    } else if (arg === "--service") {
      parsed.services.push(readOptionValue(rest, index, arg));
      index += 1;
    } else if (arg === "--follow") {
      parsed.follow = true;
    } else if (arg === "--volumes") {
      parsed.volumes = true;
    } else if (arg === "--skip-doctor") {
      parsed.skipDoctor = true;
    } else {
      throw new Error(`${PHASE7_DOCKER_COMPOSE_USAGE}\nUnknown option: ${arg}`);
    }
  }

  return parsed;
}

function readAction(value: string): Phase7DockerComposeAction {
  if (value === "up" || value === "ps" || value === "logs" || value === "down") {
    return value;
  }
  throw new Error(`${PHASE7_DOCKER_COMPOSE_USAGE}\nUnknown action: ${value}`);
}

function readOptionValue(
  argv: readonly string[],
  index: number,
  option: string,
): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("-")) {
    throw new Error(`${PHASE7_DOCKER_COMPOSE_USAGE}\n${option} requires a value`);
  }
  return value;
}

function readProfile(value: string): Phase7DockerProfile {
  if (value === "demo" || value === "workers") {
    return value;
  }
  throw new Error(
    `${PHASE7_DOCKER_COMPOSE_USAGE}\n--profile must be demo or workers`,
  );
}

function formatBrief(report: ReturnType<typeof runPhase7DockerCompose>): string {
  const lines = [
    `Split402 Phase 7 Docker compose ${report.action}: ${
      report.ok ? "ok" : "failed"
    }`,
    `Command: ${report.command}`,
  ];

  if (report.error !== undefined) {
    lines.push(`Error: ${report.error}`);
  }
  if (report.output.trim().length > 0) {
    lines.push("", report.output.trim());
  }
  if (report.nextActions.length > 0) {
    lines.push("", "Next actions:");
    lines.push(...report.nextActions.map((action) => `- ${action}`));
  }

  return `${lines.join("\n")}\n`;
}
