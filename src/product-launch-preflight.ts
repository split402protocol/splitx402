import { existsSync, readFileSync } from "node:fs";

import {
  PRODUCT_LAUNCH_PREFLIGHT_USAGE,
  createSplit402LaunchPreflightReport,
  formatSplit402LaunchPreflightBrief,
  parseSplit402LaunchPreflightCliArgs,
} from "./productLaunchPreflight.js";

const { brief, directory, help } = parseArgs();
if (help) {
  console.log(PRODUCT_LAUNCH_PREFLIGHT_USAGE);
  process.exit(0);
}

const report = createSplit402LaunchPreflightReport({
  ...(directory === undefined ? {} : { directory }),
  exists: existsSync,
  readText: (path) => readFileSync(path, "utf8"),
});

console.log(
  brief ? formatSplit402LaunchPreflightBrief(report) : JSON.stringify(report, null, 2),
);

if (!report.readyToCollectEvidence) {
  process.exitCode = 1;
}

function parseArgs() {
  try {
    return parseSplit402LaunchPreflightCliArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
