import { readFileSync } from "node:fs";

import { createPhase6EvidenceStatusReport } from "./phase6EvidenceStatus.js";

const evidencePath =
  process.argv[2] ?? process.env.SPLIT402_PHASE6_CUSTODY_EVIDENCE;

const evidenceText =
  evidencePath === undefined || evidencePath.trim().length === 0
    ? undefined
    : readFileSync(evidencePath, "utf8");

const report = createPhase6EvidenceStatusReport(evidenceText);
console.log(JSON.stringify(report, null, 2));

if (report.evidenceBundleChecked && !report.readyForCustody) {
  process.exitCode = 1;
}
