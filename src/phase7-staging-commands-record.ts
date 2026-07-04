import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";

import { recordPhase7LocalCommandEvidence } from "./phase7CommandRecorder.js";

const USAGE =
  "Usage: corepack pnpm phase7:staging:commands-record [--output <path>] [--force] [--include-preflight]";

const args = parseCliArgs(process.argv.slice(2));
if (args.help) {
  console.log(USAGE);
  process.exit(0);
}

const report = recordPhase7LocalCommandEvidence({
  outputPath: args.outputPath,
  force: args.force,
  includePreflight: args.includePreflight,
  exists: existsSync,
  writeText: (path, text) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, "utf8");
  },
  runCommand: (file, commandArgs) => {
    const result = spawnSync(file, [...commandArgs], {
      encoding: "utf8",
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      exitCode:
        typeof result.status === "number"
          ? result.status
          : result.error === undefined
            ? 1
            : 127,
      stdout: result.stdout ?? "",
      stderr:
        result.stderr ??
        (result.error === undefined ? "" : result.error.message),
    };
  },
});

console.log(JSON.stringify(report, null, 2));

if (!report.ok) {
  process.exitCode = 1;
}

interface CliArgs {
  force: boolean;
  help: boolean;
  includePreflight: boolean;
  outputPath: string;
}

function parseCliArgs(argv: readonly string[]): CliArgs {
  const parsed: CliArgs = {
    force: false,
    help: false,
    includePreflight: false,
    outputPath: "split402-launch-evidence/phase7-staging-evidence/commands.log",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--force") {
      parsed.force = true;
    } else if (arg === "--include-preflight") {
      parsed.includePreflight = true;
    } else if (arg === "--output") {
      parsed.outputPath = readOptionValue(argv, index, arg);
      index += 1;
    } else {
      throw new Error(`${USAGE}\nUnknown option: ${arg}`);
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
    throw new Error(`${USAGE}\n${option} requires a value`);
  }
  return value;
}
