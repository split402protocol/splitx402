import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createTestVectorBundle } from "../src/sample.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "..", "test-vectors", "fixtures");
const bundle = createTestVectorBundle();

const expectedFiles: Record<string, unknown> = {
  "referral-claim-valid.json": bundle.vectors["referral-claim-valid"],
  "referral-claim-invalid-signature.json":
    bundle.vectors["referral-claim-invalid-signature"],
  "offer-valid.json": bundle.vectors["offer-valid"],
  "attribution-valid.json": bundle.vectors["attribution-valid"],
  "receipt-valid.json": bundle.vectors["receipt-valid"],
  "request-digest-cases.json": bundle.requestDigestCases,
  "commission-cases.json": bundle.commissionCases
};

const mismatches: string[] = [];

for (const [filename, expected] of Object.entries(expectedFiles)) {
  const path = join(fixturesDir, filename);
  const expectedJson = `${JSON.stringify(expected, null, 2)}\n`;

  if (!existsSync(path)) {
    mismatches.push(`${filename}: missing`);
    continue;
  }

  const actualJson = readFileSync(path, "utf8");
  if (actualJson !== expectedJson) {
    mismatches.push(`${filename}: stale`);
  }
}

if (mismatches.length > 0) {
  console.error(`Test vectors are not current:\n${mismatches.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log("Test vectors are current");
}

