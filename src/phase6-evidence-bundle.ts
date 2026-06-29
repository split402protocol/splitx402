import { execFileSync } from "node:child_process";

import {
  createPhase6CustodyEvidenceBundle,
  phase6CustodyEvidenceEnvName,
  type Phase6CustodyEvidenceBundleValues,
} from "./phase6CustodyBundle.js";
import { PHASE6_CUSTODY_REQUIRED_FIELDS } from "./phase6CustodyReview.js";
import { writeCliTextOutput } from "./cliOutput.js";

const values: Phase6CustodyEvidenceBundleValues = {};

for (const field of PHASE6_CUSTODY_REQUIRED_FIELDS) {
  const value = process.env[phase6CustodyEvidenceEnvName(field)];
  if (value !== undefined && value.trim().length > 0) {
    values[field] = value.trim();
  }
}

values.review_date ??= isoDate();
values.source_commit ??= readCurrentGitCommit();

writeCliTextOutput({
  text: createPhase6CustodyEvidenceBundle(values),
  outputPath: process.argv[2],
});

function readCurrentGitCommit(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

function isoDate(): string {
  return new Date().toISOString().slice(0, 10);
}
