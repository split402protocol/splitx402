import { describe, expect, it } from "vitest";

import {
  createSplit402LocalProofReport,
  formatSplit402LocalProofBrief,
  LOCAL_PUBLIC_ALPHA_PROOF_CHECKS,
  type Split402LocalProofCheck,
} from "../src/productLocalProof.js";

describe("local public-alpha product proof", () => {
  it("runs the adoption-critical local checks", () => {
    const commands: string[] = [];
    const report = createSplit402LocalProofReport({
      runCommand: (check) => {
        commands.push(check.command.join(" "));
        return pass(check);
      },
    });

    expect(report.status).toBe("passed");
    expect(report.launchApproval).toBe("not_approved");
    expect(commands).toEqual([
      "corepack pnpm repo:guard",
      "corepack pnpm vectors:check",
      "corepack pnpm --filter @split402/router test",
      "corepack pnpm demo:mcp-gateway:smoke",
    ]);
  });

  it("fails closed when any local proof check fails", () => {
    const report = createSplit402LocalProofReport({
      runCommand: (check) =>
        check.id === "router_alpha"
          ? {
              ...check,
              durationMs: 12,
              exitCode: 1,
              output: "router test failed",
              status: "failed",
            }
          : pass(check),
    });

    expect(report.status).toBe("failed");
    expect(report.checks.find((check) => check.id === "router_alpha")).toMatchObject({
      output: "router test failed",
      status: "failed",
    });
  });

  it("formats an honest brief report without launch approval", () => {
    const report = createSplit402LocalProofReport({
      runCommand: pass,
    });

    const brief = formatSplit402LocalProofBrief(report);

    expect(brief).toContain("Split402 local public-alpha proof: passed");
    expect(brief).toContain("Launch approval: not approved");
    expect(brief).toContain("does not approve hosted Phase 7 staging");
    for (const check of LOCAL_PUBLIC_ALPHA_PROOF_CHECKS) {
      expect(brief).toContain(check.label);
    }
  });
});

function pass(check: Split402LocalProofCheck) {
  return {
    ...check,
    durationMs: 10,
    exitCode: 0,
    output: "ok",
    status: "passed" as const,
  };
}
