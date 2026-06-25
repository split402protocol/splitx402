import { readFileSync } from "node:fs";

import { createPhase7StagingStatusReport } from "./phase7StagingStatus.js";

const proofPath =
  process.argv[2] ?? process.env.SPLIT402_PHASE7_STAGING_PROOF;

const proofText =
  proofPath === undefined || proofPath.trim().length === 0
    ? undefined
    : readFileSync(proofPath, "utf8");

const report = createPhase7StagingStatusReport(proofText);
console.log(JSON.stringify(report, null, 2));

if (report.proofChecked && !report.readyForPublicAlphaDemo) {
  process.exitCode = 1;
}
