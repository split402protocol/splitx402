import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createSplit402LaunchPreflightReport,
  formatSplit402LaunchPreflightBrief,
  parseSplit402LaunchPreflightCliArgs,
} from "../src/productLaunchPreflight.js";
import { createSplit402ProductEvidenceWorkspace } from "../src/productEvidenceWorkspace.js";

describe("Split402 launch preflight", () => {
  it("parses help and rejects unknown CLI flags", () => {
    expect(parseSplit402LaunchPreflightCliArgs(["--help", "--brief"])).toEqual({
      brief: true,
      help: true,
    });
    expect(parseSplit402LaunchPreflightCliArgs(["--brief", "evidence/launch"]))
      .toEqual({
        brief: true,
        directory: "evidence/launch",
        help: false,
      });
    expect(() =>
      parseSplit402LaunchPreflightCliArgs(["--brieff"]),
    ).toThrowErrorMatchingInlineSnapshot(`
      [Error: Usage: corepack pnpm product:launch-preflight [--brief] [directory]
      Unknown option: --brieff]
    `);
    expect(() =>
      parseSplit402LaunchPreflightCliArgs(["one", "two"]),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: Usage: corepack pnpm product:launch-preflight [--brief] [directory]]`,
    );
  });

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
    expect(report.nextActions).not.toContain(
      "Fill SPLIT402_PHASE6_EVIDENCE_REVIEW_ID in split402-launch-evidence\\phase6-evidence.env.",
    );
    expect(report.nextActions).not.toContain(
      "Set SPLIT402_PHASE6_ASSEMBLE_IMAGE_PROVENANCE_RECORD=split402-launch-evidence/phase6-image-provenance.txt",
    );
    expect(formatSplit402LaunchPreflightBrief(report)).toContain(
      "Split402 launch preflight: not ready",
    );
  });

  it("guides operators safely when the launch evidence workspace is partial", () => {
    const report = createSplit402LaunchPreflightReport({
      exists: (path) =>
        path === join("split402-launch-evidence", "phase7-staging-proof.txt"),
      readText: () => "",
    });

    expect(report.readyToCollectEvidence).toBe(false);
    expect(report.nextActions).toEqual([
      "Review the existing partial launch evidence workspace, then run corepack pnpm product:evidence:init --missing to create only absent scaffold files or --force only if intentionally replacing scaffold files.",
    ]);
    expect(report.checks.find((check) => check.id === "launch_workspace_files"))
      .toMatchObject({
        ok: false,
        details: expect.arrayContaining([
          "Missing split402-launch-evidence\\README.md",
          "Existing split402-launch-evidence\\phase7-staging-proof.txt",
        ]),
      });
  });

  it("recognizes scaffold files but requires Phase 6 and hosted Phase 7 env values", () => {
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
    expect(report.checks.find((check) => check.id === "phase6_evidence_env_values"))
      .toMatchObject({ ok: false });
    expect(
      report.checks.find(
        (check) => check.id === "phase6_evidence_env_mappings",
      ),
    ).toMatchObject({ ok: false });
    expect(report.nextActions).toContain(
      "Fill SPLIT402_PHASE6_EVIDENCE_REVIEW_ID in split402-launch-evidence\\phase6-evidence.env.",
    );
    expect(report.nextActions).toContain(
      "Set SPLIT402_PHASE6_ASSEMBLE_IMAGE_PROVENANCE_RECORD=split402-launch-evidence/phase6-image-provenance.txt",
    );
    expect(report.checks.find((check) => check.id === "phase7_hosted_env_values"))
      .toMatchObject({ ok: false });
  });

  it("passes when scaffold and required Phase 6 and hosted Phase 7 env values are filled", () => {
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
      createFilledPhase6EnvText(workspace.phase6EnvText),
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
            id: "phase6_evidence_env_values",
            ok: true,
          }),
          expect.objectContaining({
            id: "phase6_evidence_env_mappings",
            ok: true,
          }),
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

  it("uses custom launch workspace paths for Phase 6 env checks", () => {
    const workspace = createSplit402ProductEvidenceWorkspace({
      directory: "evidence/launch",
    });
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
      createFilledPhase6EnvText(workspace.phase6EnvText),
      workspace,
    );

    const report = createSplit402LaunchPreflightReport({
      directory: "evidence/launch",
      exists: (path) => files.has(path),
      readText: (path) => files.get(path) ?? "",
    });

    expect(report.readyToCollectEvidence).toBe(true);
    expect(report.checks.find((check) => check.id === "phase6_evidence_env_mappings"))
      .toMatchObject({ ok: true });
  });
});

function createWorkspaceFileMap(
  phase7EnvText: string,
  phase6EnvText?: string,
  workspace = createSplit402ProductEvidenceWorkspace(),
): Map<string, string> {
  return new Map([
    [join(workspace.directory, workspace.readmeFileName), workspace.readmeText],
    [
      join(workspace.directory, workspace.phase6EvidenceFileName),
      workspace.phase6EvidenceText,
    ],
    [
      join(workspace.directory, workspace.phase6EnvFileName),
      phase6EnvText ?? workspace.phase6EnvText,
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

function createFilledPhase6EnvText(template: string): string {
  return template
    .replaceAll("# SPLIT402_PHASE6_", "SPLIT402_PHASE6_")
    .replace(
      "SPLIT402_PHASE6_EVIDENCE_REVIEW_ID=phase6-custody-YYYY-MM-DD",
      "SPLIT402_PHASE6_EVIDENCE_REVIEW_ID=phase6-custody-2026-06-29",
    );
}
