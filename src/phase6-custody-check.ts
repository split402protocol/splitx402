import { readFileSync } from "node:fs";

import { validatePhase6CustodyEvidence } from "./phase6CustodyReview.js";

const evidencePath =
  process.argv[2] ?? process.env.SPLIT402_PHASE6_CUSTODY_EVIDENCE;

if (evidencePath === undefined || evidencePath.trim().length === 0) {
  console.error(
    "Usage: corepack pnpm phase6:custody:check <evidence-bundle.txt|->",
  );
  process.exitCode = 1;
} else {
  const input = evidencePath === "-" ? 0 : evidencePath;
  const result = validatePhase6CustodyEvidence(readFileSync(input, "utf8"));
  console.log(JSON.stringify(result, null, 2));
  if (!result.approved) {
    process.exitCode = 1;
  }
}
