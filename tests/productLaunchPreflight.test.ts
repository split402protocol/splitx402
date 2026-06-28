import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createSplit402LaunchPreflightReport,
  formatSplit402LaunchPreflightBrief,
} from "../src/productLaunchPreflight.js";
import { createSplit402ProductEvidenceWorkspace } from "../src/productEvidenceWorkspace.js";

describe("Split402 launch preflight", () => {
  it("fails fast when the launch evidence workspace has not been created", () => {
    const report = createSplit402LaunchPreflightReport({
      exists: () => false,
      readText: () => "",
    });

    expect(report.readyToCollectEvidence).toBe(false);
    expect(report.readyForMainnet).toBe(false);
    expect(report.checks.find((check) => check.id === "launch_workspace_files"))
      .toMatchObject({
        ok: false,
        severity: "required",
      });
    expect(report.nextActions).toContain(
      "Run corepack pnpm product:evidence:init.",
    );
    expect(formatSplit402LaunchPreflightBrief(report)).toContain(
      "Split402 launch preflight: not ready",
    );
  });

  it("recognizes scaffold files but requires hosted Phase 7 env values", () => {
    const workspace = createSplit402ProductEvidenceWorkspace();
    const files = createWorkspaceFileMap(workspace.phase7.envText);
    const report = createSplit402LaunchPreflightReport({
      exists: (path) => files.has(path),
      readText: (path) => files.get(path) ?? "",
    });

    expect(report.readyToCollectEvidence).toBe(false);
    expect(report.checks.find((check) => check.id === "launch_workspace_files"))
      .toMatchObject({ ok: true });
    expect(
      report.checks.find(
        (check) => check.id === "phase7_attachment_env_mappings",
      ),
    ).toMatchObject({ ok: true });
    expect(report.checks.find((check) => check.id === "phase7_hosted_env_values"))
      .toMatchObject({ ok: false });
  });

  it("passes when scaffold and required hosted env values are filled", () => {
    const workspace = createSplit402ProductEvidenceWorkspace();
    const files = createWorkspaceFileMap(
      [
        workspace.phase7.envText,
        "SPLIT402_PHASE7_CONTROL_PLANE_URL=https://control.staging.example",
        "SPLIT402_PHASE7_DASHBOARD_URL=https://dashboard.staging.example",
        "SPLIT402_PHASE7_DEMO_MERCHANT_URL=https://merchant.staging.example",
        "SPLIT402_PHASE7_CONTROL_PLANE_TOKEN=merchant-session-token",
        "SPLIT402_PHASE7_MERCHANT_ID=mrc_123",
        "SPLIT402_PHASE7_REFERRER_WALLET=referrer-wallet",
        "SPLIT402_MCP_CONTROL_PLANE_URL=https://control.staging.example",
        "SPLIT402_MCP_CONTROL_PLANE_TOKEN=merchant-session-token",
        "SPLIT402_MCP_CAPABILITY=solana.wallet-risk",
        "SPLIT402_PHASE7_MCP_GATEWAY_EXECUTE=1",
        "SPLIT402_MCP_SVM_PRIVATE_KEY=funded-devnet-buyer-key",
      ].join("\n"),
    );

    const report = createSplit402LaunchPreflightReport({
      exists: (path) => files.has(path),
      readText: (path) => files.get(path) ?? "",
    });

    expect(report.readyToCollectEvidence).toBe(true);
    expect(report.checks.filter((check) => check.severity === "required"))
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "launch_workspace_files", ok: true }),
          expect.objectContaining({
            id: "phase7_attachment_env_mappings",
            ok: true,
          }),
          expect.objectContaining({ id: "phase7_hosted_env_values", ok: true }),
          expect.objectContaining({
            id: "phase7_mcp_live_execution_env",
            ok: true,
          }),
        ]),
      );
  });
});

function createWorkspaceFileMap(phase7EnvText: string): Map<string, string> {
  const workspace = createSplit402ProductEvidenceWorkspace();
  return new Map([
    [join(workspace.directory, workspace.readmeFileName), workspace.readmeText],
    [
      join(workspace.directory, workspace.phase6EvidenceFileName),
      workspace.phase6EvidenceText,
    ],
    [
      join(workspace.directory, workspace.phase7ProofFileName),
      workspace.phase7ProofText,
    ],
    [join(workspace.directory, workspace.phase7EnvFileName), phase7EnvText],
    [
      join(workspace.phase7.directory, workspace.phase7.readmeFileName),
      workspace.phase7.readmeText,
    ],
  ]);
}
