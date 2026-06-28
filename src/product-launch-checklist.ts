import {
  createSplit402ProductReadinessReport,
  formatSplit402ProductReadinessBrief,
} from "./productReadinessStatus.js";
import {
  createSplit402LaunchChecklist,
  formatSplit402LaunchChecklistBrief,
} from "./productLaunchChecklist.js";

const args = process.argv.slice(2);
const brief = args.includes("--brief");
const readinessReport = createSplit402ProductReadinessReport();
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
