import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { loadEvidenceEnvFiles } from "./evidenceEnvFile.js";
import { collectPhase6EvidenceRecords } from "./phase6EvidenceCollector.js";

const USAGE =
  "Usage: corepack pnpm phase6:evidence:collect [--force] [--evidence-env-file <path>]";

try {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help) {
    console.log(USAGE);
    process.exit(0);
  }

  loadEvidenceEnvFiles({
    argv: cli.evidenceEnvFileArgs,
    defaultEnvFiles: ["split402-launch-evidence/phase6-evidence.env"],
  });

  const report = collectPhase6EvidenceRecords({
    env: process.env,
    force: cli.force,
    exists: existsSync,
    writeText: (path, text) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text, "utf8");
    },
    runCommand: (file, args) => {
      const result = spawnSync(file, [...args], {
        encoding: "utf8",
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
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
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(USAGE);
  process.exitCode = 1;
}

interface Phase6EvidenceCollectCliArgs {
  evidenceEnvFileArgs: string[];
  force: boolean;
  help: boolean;
}

function parseArgs(argv: readonly string[]): Phase6EvidenceCollectCliArgs {
  const evidenceEnvFileArgs: string[] = [];
  let force = false;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--force") {
      force = true;
    } else if (arg === "--evidence-env-file") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new Error(`${USAGE}\n--evidence-env-file requires a value`);
      }
      evidenceEnvFileArgs.push(arg, value);
      index += 1;
    } else {
      throw new Error(`${USAGE}\nUnknown option: ${arg}`);
    }
  }

  return { evidenceEnvFileArgs, force, help };
}
