import {
  createSplit402LocalProofReport,
  formatSplit402LocalProofBrief,
  LOCAL_PROOF_USAGE,
} from "./productLocalProof.js";

const { brief, help, json } = readCliArgs();

if (help) {
  console.log(LOCAL_PROOF_USAGE);
  process.exit(0);
}

const report = createSplit402LocalProofReport();
console.log(
  json && !brief
    ? JSON.stringify(report, null, 2)
    : formatSplit402LocalProofBrief(report),
);

if (report.status !== "passed") {
  process.exitCode = 1;
}

function readArgs(args: readonly string[]): {
  brief: boolean;
  help: boolean;
  json: boolean;
} {
  let brief = false;
  let help = false;
  let json = false;

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--brief") {
      brief = true;
    } else if (arg === "--json") {
      json = true;
    } else {
      throw new Error(`${LOCAL_PROOF_USAGE}\nUnknown option: ${arg}`);
    }
  }

  return { brief, help, json };
}

function readCliArgs(): { brief: boolean; help: boolean; json: boolean } {
  try {
    return readArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
