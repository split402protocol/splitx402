import { describe, expect, it } from "vitest";

import {
  createSplit402ProductReadinessReport,
} from "../src/productReadinessStatus.js";
import {
  createSplit402LaunchChecklist,
  formatSplit402LaunchChecklistBrief,
} from "../src/productLaunchChecklist.js";

describe("Split402 launch checklist", () => {
  it("turns product readiness into an operator checklist", () => {
    const checklist = createSplit402LaunchChecklist(
      createSplit402ProductReadinessReport(),
    );

    expect(checklist).toMatchObject({
      schema: "split402.launch_checklist.v1",
      product: "Split402",
      repository: "split402protocol/splitx402",
      launchDecision: "no-go",
      readyForMainnet: false,
      workspace: {
        directory: "split402-launch-evidence",
        phase6EvidenceFile:
          "split402-launch-evidence/phase6-custody-evidence.txt",
        phase7ProofFile: "split402-launch-evidence/phase7-staging-proof.txt",
      },
    });
    expect(checklist.sections.map((section) => section.title)).toEqual([
      "Create launch evidence workspace",
      "Run local repository validation",
      "Collect Phase 7 hosted public-alpha proof",
      "Collect Phase 6 production custody evidence",
      "Check combined launch readiness",
    ]);
    expect(checklist.sections[2]?.externalEvidenceRequired).toBe(true);
    expect(checklist.sections[2]?.commands).toContain(
      "SPLIT402_PHASE7_MCP_GATEWAY_EXECUTE=1 corepack pnpm phase7:staging:collect-mcp-gateway",
    );
    expect(checklist.sections[3]?.commands).toContain(
      "corepack pnpm phase6:evidence:status split402-launch-evidence/phase6-custody-evidence.txt",
    );
    expect(checklist.nextCommand).toBe(
      "Create a combined launch evidence workspace with corepack pnpm product:evidence:init.",
    );
  });

  it("formats the launch checklist for humans without changing no-go posture", () => {
    const checklist = createSplit402LaunchChecklist(
      createSplit402ProductReadinessReport(),
    );

    expect(formatSplit402LaunchChecklistBrief(checklist)).toContain(
      "Split402 launch checklist: no-go",
    );
    expect(formatSplit402LaunchChecklistBrief(checklist)).toContain(
      "Mainnet ready: no",
    );
    expect(formatSplit402LaunchChecklistBrief(checklist)).toContain(
      "corepack pnpm product:evidence:init --force",
    );
    expect(formatSplit402LaunchChecklistBrief(checklist)).toContain(
      "The combined status remains no-go until both machine-checkable gates pass.",
    );
  });
});
