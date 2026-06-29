import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { createPhase6EvidenceStatusReport } from "./phase6EvidenceStatus.js";

const evidencePath =
  process.argv[2] ?? process.env.SPLIT402_PHASE6_CUSTODY_EVIDENCE;

const evidenceText =
  evidencePath === undefined || evidencePath.trim().length === 0
    ? undefined
    : readFileSync(evidencePath, "utf8");

const report = createPhase6EvidenceStatusReport(evidenceText, {
  currentSourceCommit: readCurrentGitCommit(),
});
console.log(JSON.stringify(report, null, 2));

if (report.evidenceBundleChecked && !report.readyForCustody) {
  process.exitCode = 1;
}

function readCurrentGitCommit(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}
