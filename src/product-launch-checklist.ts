import { readSplit402ProductReadinessCliInput } from "./productReadinessCli.js";
import { formatSplit402ProductReadinessBrief } from "./productReadinessStatus.js";
import {
  createSplit402LaunchChecklist,
  formatSplit402LaunchChecklistBrief,
} from "./productLaunchChecklist.js";

const { brief, report: readinessReport } =
  readSplit402ProductReadinessCliInput(process.argv.slice(2));
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
