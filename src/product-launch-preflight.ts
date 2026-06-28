import { existsSync, readFileSync } from "node:fs";

import {
  createSplit402LaunchPreflightReport,
  formatSplit402LaunchPreflightBrief,
} from "./productLaunchPreflight.js";

const args = process.argv.slice(2);
const brief = args.includes("--brief");
const directory = args.filter((arg) => arg !== "--brief")[0];
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
