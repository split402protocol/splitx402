import { describe, expect, it } from "vitest";

import {
  PRODUCT_LAUNCH_CHECKLIST_USAGE,
  PRODUCT_STATUS_USAGE,
  readSplit402ProductReadinessCliInput,
} from "../src/productReadinessCli.js";

describe("Split402 product readiness CLI parsing", () => {
  it("parses help and brief flags without treating help as an evidence path", () => {
    const input = readSplit402ProductReadinessCliInput([
      "--help",
      "--brief",
    ]);

    expect(input.help).toBe(true);
    expect(input.brief).toBe(true);
    expect(input.phase6EvidencePath).toBeUndefined();
    expect(input.phase7ProofPath).toBeUndefined();
    expect(input.report.launchDecision).toBe("no-go");
  });

  it("rejects unknown readiness CLI options", () => {
    expect(() =>
      readSplit402ProductReadinessCliInput(["--brieff"], PRODUCT_STATUS_USAGE),
    ).toThrowErrorMatchingInlineSnapshot(`
      [Error: Usage: corepack pnpm product:status [--brief] [phase6-custody-evidence.txt] [phase7-staging-proof.txt]
      Unknown option: --brieff]
    `);
  });

  it("uses caller-specific usage text", () => {
    expect(() =>
      readSplit402ProductReadinessCliInput(
        ["one", "two", "three"],
        PRODUCT_LAUNCH_CHECKLIST_USAGE,
      ),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: Usage: corepack pnpm product:launch-checklist [--brief] [phase6-custody-evidence.txt] [phase7-staging-proof.txt]]`,
    );
  });
});
