import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import {
  formatPhase7DockerDoctorBrief,
  runPhase7DockerDoctor,
  type Phase7DockerProfile,
} from "./phase7DockerDoctor.js";

const PHASE7_DOCKER_DOCTOR_USAGE =
  "Usage: corepack pnpm phase7:docker:doctor [--brief] [--compose-file <path>] [--env-file <path>] [--profile demo|workers]";

const args = parseCliArgs(process.argv.slice(2));
if (args.help) {
  console.log(PHASE7_DOCKER_DOCTOR_USAGE);
  process.exit(0);
}

const report = runPhase7DockerDoctor({
  ...(args.composeFile === undefined ? {} : { composeFile: args.composeFile }),
  ...(args.envFile === undefined ? {} : { envFile: args.envFile }),
  profiles: args.profiles,
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

console.log(
  args.brief ? formatPhase7DockerDoctorBrief(report) : JSON.stringify(report, null, 2),
);

if (!report.ready) {
  process.exitCode = 1;
}

interface Phase7DockerDoctorCliArgs {
  brief: boolean;
  composeFile?: string;
  envFile?: string;
  help: boolean;
  profiles: Phase7DockerProfile[];
}

function parseCliArgs(argv: readonly string[]): Phase7DockerDoctorCliArgs {
  try {
    return parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function parseArgs(argv: readonly string[]): Phase7DockerDoctorCliArgs {
  const parsed: Phase7DockerDoctorCliArgs = {
    brief: false,
    help: false,
    profiles: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--brief") {
      parsed.brief = true;
    } else if (arg === "--compose-file") {
      parsed.composeFile = readOptionValue(argv, index, arg);
      index += 1;
    } else if (arg === "--env-file") {
      parsed.envFile = readOptionValue(argv, index, arg);
      index += 1;
    } else if (arg === "--profile") {
      parsed.profiles.push(readProfile(readOptionValue(argv, index, arg)));
      index += 1;
    } else {
      throw new Error(`${PHASE7_DOCKER_DOCTOR_USAGE}\nUnknown option: ${arg}`);
    }
  }

  return parsed;
}

function readOptionValue(
  argv: readonly string[],
  index: number,
  option: string,
): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("-")) {
    throw new Error(`${PHASE7_DOCKER_DOCTOR_USAGE}\n${option} requires a value`);
  }
  return value;
}

function readProfile(value: string): Phase7DockerProfile {
  if (value === "demo" || value === "workers") {
    return value;
  }
  throw new Error(
    `${PHASE7_DOCKER_DOCTOR_USAGE}\n--profile must be demo or workers`,
  );
}
