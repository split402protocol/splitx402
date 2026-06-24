import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createTestVectorBundle } from "../src/sample.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "..", "test-vectors", "fixtures");

mkdirSync(fixturesDir, { recursive: true });

const bundle = createTestVectorBundle();
const files: Record<string, unknown> = {
  "referral-claim-valid.json": bundle.vectors["referral-claim-valid"],
  "referral-claim-invalid-signature.json":
    bundle.vectors["referral-claim-invalid-signature"],
  "offer-valid.json": bundle.vectors["offer-valid"],
  "attribution-valid.json": bundle.vectors["attribution-valid"],
  "receipt-valid.json": bundle.vectors["receipt-valid"],
  "request-digest-cases.json": bundle.requestDigestCases,
  "commission-cases.json": bundle.commissionCases
};

for (const [filename, value] of Object.entries(files)) {
  writeFileSync(join(fixturesDir, filename), `${JSON.stringify(value, null, 2)}\n`);
}

console.log(`Wrote ${Object.keys(files).length} test-vector files to ${fixturesDir}`);

