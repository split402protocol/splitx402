import { readSplit402ProductReadinessCliInput } from "./productReadinessCli.js";
import { formatSplit402ProductReadinessBrief } from "./productReadinessStatus.js";

const { brief, report } = readSplit402ProductReadinessCliInput(
  process.argv.slice(2),
);

console.log(
  brief
    ? formatSplit402ProductReadinessBrief(report)
    : JSON.stringify(report, null, 2),
);

if (
  (report.phase6.evidenceBundleChecked || report.phase7.proofChecked) &&
  report.launchDecision !== "go"
) {
  process.exitCode = 1;
}
