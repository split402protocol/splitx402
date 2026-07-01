import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { createPhase6EvidenceStatusReport } from "./phase6EvidenceStatus.js";

const evidencePath =
  process.argv[2] ?? process.env.SPLIT402_PHASE6_CUSTODY_EVIDENCE;

if (evidencePath === undefined || evidencePath.trim().length === 0) {
  console.error(
    "Usage: corepack pnpm phase6:custody:check <evidence-bundle.txt|->",
  );
  process.exitCode = 1;
} else {
  const input = evidencePath === "-" ? 0 : evidencePath;
  const report = createPhase6EvidenceStatusReport(readFileSync(input, "utf8"), {
    ...(evidencePath === "-"
      ? {}
      : {
          artifactBaseDir: dirname(resolve(evidencePath)),
          artifactExists: existsSync,
          resolveArtifactPath: (artifactPath, baseDir) =>
            resolve(baseDir, artifactPath),
        }),
    currentSourceCommit: readCurrentGitCommit(),
  });
  console.log(JSON.stringify(report, null, 2));
  if (!report.readyForCustody) {
    process.exitCode = 1;
  }
}

function readCurrentGitCommit(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}
