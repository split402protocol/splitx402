import {
  PRODUCT_STATUS_USAGE,
  readSplit402ProductReadinessCliInput,
} from "./productReadinessCli.js";
import { formatSplit402ProductReadinessBrief } from "./productReadinessStatus.js";

const { brief, help, report } = readArgs();

if (help) {
  console.log(PRODUCT_STATUS_USAGE);
  process.exit(0);
}

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

function readArgs() {
  try {
    return readSplit402ProductReadinessCliInput(
      process.argv.slice(2),
      PRODUCT_STATUS_USAGE,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
