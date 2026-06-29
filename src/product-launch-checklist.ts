import {
  PRODUCT_LAUNCH_CHECKLIST_USAGE,
  readSplit402ProductReadinessCliInput,
} from "./productReadinessCli.js";
import { formatSplit402ProductReadinessBrief } from "./productReadinessStatus.js";
import {
  createSplit402LaunchChecklist,
  formatSplit402LaunchChecklistBrief,
} from "./productLaunchChecklist.js";

const { brief, help, report: readinessReport } = readArgs();

if (help) {
  console.log(PRODUCT_LAUNCH_CHECKLIST_USAGE);
  process.exit(0);
}

const checklist = createSplit402LaunchChecklist(readinessReport);

console.log(
  brief
    ? formatSplit402LaunchChecklistBrief(checklist)
    : JSON.stringify(
        {
          ...checklist,
          currentReadiness: formatSplit402ProductReadinessBrief(readinessReport),
        },
        null,
        2,
      ),
);

function readArgs() {
  try {
    return readSplit402ProductReadinessCliInput(
      process.argv.slice(2),
      PRODUCT_LAUNCH_CHECKLIST_USAGE,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
