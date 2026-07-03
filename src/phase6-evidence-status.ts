import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  createPhase6EvidenceStatusReport,
  formatPhase6EvidenceStatusBrief,
} from "./phase6EvidenceStatus.js";

const { brief, evidencePath, help } = parseCliArgs(process.argv.slice(2));

if (help) {
  console.log(
    "Usage: corepack pnpm phase6:evidence:status [--brief] [evidence-bundle.txt]",
  );
  process.exit(0);
}

const evidenceText =
  evidencePath === undefined || evidencePath.trim().length === 0
    ? undefined
    : readFileSync(evidencePath, "utf8");

const report = createPhase6EvidenceStatusReport(evidenceText, {
  ...(evidencePath === undefined
    ? {}
    : {
        artifactBaseDir: dirname(resolve(evidencePath)),
        artifactExists: existsSync,
        resolveArtifactPath: (artifactPath, baseDir) =>
          resolve(baseDir, artifactPath),
      }),
  currentSourceCommit: readCurrentGitCommit(),
});
console.log(
  brief ? formatPhase6EvidenceStatusBrief(report) : JSON.stringify(report, null, 2),
);

if (report.evidenceBundleChecked && !report.readyForCustody) {
  process.exitCode = 1;
}

function parseCliArgs(args: readonly string[]): {
  brief: boolean;
  evidencePath?: string;
  help: boolean;
} {
  let brief = false;
  let help = false;
  let evidencePath: string | undefined;

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--brief") {
      brief = true;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (evidencePath === undefined) {
      evidencePath = arg;
    } else {
      throw new Error(
        "Usage: corepack pnpm phase6:evidence:status [--brief] [evidence-bundle.txt]",
      );
    }
  }

  return {
    brief,
    help,
    evidencePath: evidencePath ?? process.env.SPLIT402_PHASE6_CUSTODY_EVIDENCE,
  };
}

function readCurrentGitCommit(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}
