import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  createSplit402LocalProofReport,
  formatSplit402LocalProofBrief,
  LOCAL_PROOF_USAGE,
  serializeSplit402LocalProofReport,
} from "./productLocalProof.js";

const { brief, help, json, outputPath } = readCliArgs();

if (help) {
  console.log(LOCAL_PROOF_USAGE);
  process.exit(0);
}

const report = createSplit402LocalProofReport();
if (outputPath !== undefined) {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, serializeSplit402LocalProofReport(report), {
    encoding: "utf8",
  });
}
console.log(
  json && !brief
    ? serializeSplit402LocalProofReport(report)
    : formatSplit402LocalProofBrief(report),
);

if (report.status !== "passed") {
  process.exitCode = 1;
}

function readArgs(args: readonly string[]): {
  brief: boolean;
  help: boolean;
  json: boolean;
  outputPath?: string;
} {
  let brief = false;
  let help = false;
  let json = false;
  let outputPath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--brief") {
      brief = true;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--output") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new Error(`${LOCAL_PROOF_USAGE}\n--output requires a file path.`);
      }
      outputPath = value;
      index += 1;
    } else if (arg.startsWith("--output=")) {
      const value = arg.slice("--output=".length);
      if (value.trim().length === 0) {
        throw new Error(`${LOCAL_PROOF_USAGE}\n--output requires a file path.`);
      }
      outputPath = value;
    } else {
      throw new Error(`${LOCAL_PROOF_USAGE}\nUnknown option: ${arg}`);
    }
  }

  return {
    brief,
    help,
    json,
    ...(outputPath === undefined ? {} : { outputPath }),
  };
}

function readCliArgs(): {
  brief: boolean;
  help: boolean;
  json: boolean;
  outputPath?: string;
} {
  try {
    return readArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
