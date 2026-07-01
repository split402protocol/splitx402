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
    expect(
      parseSplit402LaunchPreflightCliArgs([
        "--brief",
        "--workspace",
        "split402-launch-evidence",
      ]),
    ).toEqual({
      brief: true,
      directory: "split402-launch-evidence",
      help: false,
    });
    expect(
      parseSplit402LaunchPreflightCliArgs([
        "--workspace=evidence/launch",
      ]),
    ).toEqual({
      brief: false,
      directory: "evidence/launch",
      help: false,
    });
    expect(() =>
      parseSplit402LaunchPreflightCliArgs(["--brieff"]),
    ).toThrowErrorMatchingInlineSnapshot(`
      [Error: Usage: corepack pnpm product:launch-preflight [--brief] [--workspace directory] [directory]
      Unknown option: --brieff]
    `);
    expect(() =>
      parseSplit402LaunchPreflightCliArgs(["--workspace"]),
    ).toThrowErrorMatchingInlineSnapshot(`
      [Error: Usage: corepack pnpm product:launch-preflight [--brief] [--workspace directory] [directory]
      --workspace requires a directory.]
    `);
    expect(() =>
      parseSplit402LaunchPreflightCliArgs([
        "--workspace=split402-launch-evidence",
        "other-evidence",
      ]),
    ).toThrowErrorMatchingInlineSnapshot(`
      [Error: Usage: corepack pnpm product:launch-preflight [--brief] [--workspace directory] [directory]
      Do not pass a directory path with --workspace.]
    `);
    expect(() =>
      parseSplit402LaunchPreflightCliArgs(["one", "two"]),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: Usage: corepack pnpm product:launch-preflight [--brief] [--workspace directory] [directory]]`,
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
      "Fill SPLIT402_PHASE6_EVIDENCE_REVIEW_ID in split402-launch-evidence/phase6-evidence.env.",
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
          "Missing split402-launch-evidence/README.md",
          "Existing split402-launch-evidence/phase7-staging-proof.txt",
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
        (check) => check.id === "mainnet_canary_private_evidence_scaffold",
      ),
    ).toMatchObject({
      ok: true,
      severity: "advisory",
      details: [
        "Mainnet canary env references the private dry-run and rollback evidence templates.",
      ],
    });
    expect(
      report.checks.find(
        (check) => check.id === "phase7_attachment_env_mappings",
      ),
    ).toMatchObject({ ok: true });
    expect(report.checks.find((check) => check.id === "phase6_evidence_env_values"))
      .toMatchObject({ ok: false });
    expect(report.checks.find((check) => check.id === "phase6_redacted_env_summary"))
      .toMatchObject({
        ok: true,
        severity: "advisory",
        details: expect.arrayContaining([
          "Env file: split402-launch-evidence/phase6-evidence.env",
          "SPLIT402_PHASE6_EVIDENCE_REVIEW_ID: missing",
          "SPLIT402_PHASE6_EVIDENCE_FUNDING_WALLET: missing",
          "SPLIT402_PHASE6_EVIDENCE_APPROVAL_DECISION: unset",
        ]),
      });
    expect(
      report.checks.find(
        (check) => check.id === "phase6_evidence_env_mappings",
      ),
    ).toMatchObject({ ok: true });
    expect(report.nextActions).toContain(
      "Fill Phase 6 custody env values in split402-launch-evidence/phase6-evidence.env: SPLIT402_PHASE6_EVIDENCE_REVIEW_ID, SPLIT402_PHASE6_EVIDENCE_REVIEWERS, SPLIT402_PHASE6_EVIDENCE_STAGING_ENVIRONMENT, SPLIT402_PHASE6_EVIDENCE_FUNDING_WALLET, SPLIT402_PHASE6_EVIDENCE_NETWORK=solana:devnet, SPLIT402_PHASE6_EVIDENCE_APPROVAL_NOTES.",
    );
    expect(report.nextActions).toContain(
      "Fill Phase 7 hosted proof env values in split402-launch-evidence/phase7-staging.env: SPLIT402_PHASE7_PROOF_ID, SPLIT402_PHASE7_PROOF_REVIEWERS, SPLIT402_PHASE7_STAGING_ENVIRONMENT, SPLIT402_PHASE7_CONTROL_PLANE_URL, SPLIT402_PHASE7_DASHBOARD_URL, SPLIT402_PHASE7_DEMO_MERCHANT_URL, SPLIT402_PHASE7_WEBHOOK_RECEIVER_URL, SPLIT402_PHASE7_CONTROL_PLANE_TOKEN, SPLIT402_PHASE7_MERCHANT_ID, SPLIT402_PHASE7_REFERRER_WALLET.",
    );
    expect(report.nextActions).toContain(
      "Fill Phase 7 MCP live execution env values in split402-launch-evidence/phase7-staging.env: SPLIT402_MCP_CONTROL_PLANE_URL, SPLIT402_MCP_CONTROL_PLANE_TOKEN, SPLIT402_MCP_CAPABILITY=solana.wallet-risk, SPLIT402_PHASE7_MCP_GATEWAY_EXECUTE=1, SPLIT402_MCP_SVM_PRIVATE_KEY or SVM_PRIVATE_KEY.",
    );
    expect(report.nextActions).not.toContain(
      "Run corepack pnpm product:github-settings-review --from-github --output split402-launch-evidence/github-settings-review.txt to generate the live no-go GitHub API snapshot; use --template only for a blank manual form, and keep review_decision=no-go until human review approves the live GitHub settings evidence.",
    );
    expect(report.nextActions).not.toContain(
      "Set SPLIT402_PHASE6_ASSEMBLE_IMAGE_PROVENANCE_RECORD=split402-launch-evidence/phase6-image-provenance.txt",
    );
    expect(report.checks.find((check) => check.id === "phase7_hosted_env_values"))
      .toMatchObject({ ok: false });
  });

  it("surfaces stale mainnet canary env wiring as advisory preflight guidance", () => {
    const workspace = createSplit402ProductEvidenceWorkspace();
    const files = createWorkspaceFileMap(
      workspace.phase7.envText,
      undefined,
      workspace,
    );
    files.set(
      join(workspace.directory, workspace.mainnetCanaryEnvFileName),
      workspace.mainnetCanaryEnvText
        .replace(
          "SPLIT402_MAINNET_CANARY_DRY_RUN_EVIDENCE=attached: mainnet-canary-dry-run.txt",
          "SPLIT402_MAINNET_CANARY_DRY_RUN_EVIDENCE=",
        )
        .replace(
          "SPLIT402_MAINNET_CANARY_ROLLBACK_PLAN=attached: mainnet-canary-rollback-plan.txt",
          "SPLIT402_MAINNET_CANARY_ROLLBACK_PLAN=",
        ),
    );

    const report = createSplit402LaunchPreflightReport({
      exists: (path) => files.has(path),
      readText: (path) => files.get(path) ?? "",
    });

    expect(
      report.checks.find(
        (check) => check.id === "mainnet_canary_private_evidence_scaffold",
      ),
    ).toMatchObject({
      ok: false,
      severity: "advisory",
      details: [
        "Set SPLIT402_MAINNET_CANARY_DRY_RUN_EVIDENCE=attached: mainnet-canary-dry-run.txt in split402-launch-evidence/mainnet-canary.env.",
        "Set SPLIT402_MAINNET_CANARY_ROLLBACK_PLAN=attached: mainnet-canary-rollback-plan.txt in split402-launch-evidence/mainnet-canary.env.",
      ],
    });
  });

  it("passes when scaffold and required Phase 6 and hosted Phase 7 env values are filled", () => {
    const workspace = createSplit402ProductEvidenceWorkspace({
      reviewDate: "2026-06-29",
      sourceCommit: "abc1234",
    });
    const files = createWorkspaceFileMap(
      [
        workspace.phase7.envText,
        "SPLIT402_PHASE7_PROOF_ID=phase7-staging-2026-06-29",
        "SPLIT402_PHASE7_PROOF_REVIEWERS=Split402 operators",
        "SPLIT402_PHASE7_STAGING_ENVIRONMENT=hosted-devnet-public-alpha",
        "SPLIT402_PHASE7_CONTROL_PLANE_URL=https://control.staging.example",
        "SPLIT402_PHASE7_DASHBOARD_URL=https://dashboard.staging.example",
        "SPLIT402_PHASE7_DEMO_MERCHANT_URL=https://merchant.staging.example",
        "SPLIT402_PHASE7_WEBHOOK_RECEIVER_URL=https://webhook.staging.example",
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
      currentSourceCommit: "abc1234",
      exists: (path) => files.has(path),
      readText: (path) => files.get(path) ?? "",
    });

    expect(report.readyToCollectEvidence).toBe(true);
    expect(report.nextActions).toContain(
      "Run corepack pnpm product:github-settings-review --from-github --output split402-launch-evidence/github-settings-review.txt to generate the live no-go GitHub API snapshot; use --template only for a blank manual form, and keep review_decision=no-go until human review approves the live GitHub settings evidence.",
    );
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
          expect.objectContaining({
            id: "phase7_mcp_matches_hosted_env",
            ok: true,
          }),
          expect.objectContaining({
            id: "pre_collection_approval_decisions",
            ok: true,
          }),
          expect.objectContaining({
            id: "launch_workspace_source_commit",
            ok: true,
          }),
        ]),
      );
    expect(
      report.checks.find(
        (check) => check.id === "public_private_license_review",
      ),
    ).toMatchObject({
      ok: true,
      severity: "advisory",
      details: expect.arrayContaining([
        "Keep the public repository as the Apache-2.0 protocol foundation.",
        "Do not reintroduce MIT in README, package metadata, GitHub About text, release notes, or package manifests.",
      ]),
    });
    const phase6RedactedSummary = report.checks.find(
      (check) => check.id === "phase6_redacted_env_summary",
    );
    expect(phase6RedactedSummary).toMatchObject({
      ok: true,
      severity: "advisory",
      details: expect.arrayContaining([
        "Env file: split402-launch-evidence/phase6-evidence.env",
        "SPLIT402_PHASE6_EVIDENCE_REVIEW_ID: configured",
        "SPLIT402_PHASE6_EVIDENCE_FUNDING_WALLET: configured",
        "SPLIT402_PHASE6_EVIDENCE_APPROVAL_DECISION: configured",
      ]),
    });
    expect(phase6RedactedSummary?.details.join("\n")).not.toContain(
      "merchant-funding-wallet",
    );
    const redactedSummary = report.checks.find(
      (check) => check.id === "phase7_redacted_env_summary",
    );
    expect(redactedSummary).toMatchObject({
      ok: true,
      severity: "advisory",
      details: expect.arrayContaining([
        "Env file: split402-launch-evidence/phase7-staging.env",
        "SPLIT402_PHASE7_CONTROL_PLANE_URL: configured (https://control.staging.example)",
        "SPLIT402_PHASE7_CONTROL_PLANE_TOKEN: configured (redacted)",
        "SPLIT402_MCP_CONTROL_PLANE_TOKEN: configured (redacted)",
        "SPLIT402_PHASE7_MCP_GATEWAY_EXECUTE: enabled",
        "SPLIT402_MCP_SVM_PRIVATE_KEY/SVM_PRIVATE_KEY: configured via SPLIT402_MCP_SVM_PRIVATE_KEY (redacted)",
      ]),
    });
    expect(redactedSummary?.details.join("\n")).not.toContain(
      "merchant-session-token",
    );
    expect(redactedSummary?.details.join("\n")).not.toContain(
      "funded-devnet-buyer-key",
    );
  });

  it("accepts quoted env values consistently with the evidence collectors", () => {
    const workspace = createSplit402ProductEvidenceWorkspace({
      reviewDate: "2026-06-29",
      sourceCommit: "abc1234",
    });
    const files = createWorkspaceFileMap(
      [
        workspace.phase7.envText,
        'SPLIT402_PHASE7_PROOF_ID="phase7-staging-2026-06-29"',
        'SPLIT402_PHASE7_PROOF_REVIEWERS="Split402 operators"',
        "SPLIT402_PHASE7_STAGING_ENVIRONMENT='hosted-devnet-public-alpha'",
        'SPLIT402_PHASE7_CONTROL_PLANE_URL="https://control.staging.example" # hosted API',
        'SPLIT402_PHASE7_DASHBOARD_URL="https://dashboard.staging.example"',
        "SPLIT402_PHASE7_DEMO_MERCHANT_URL='https://merchant.staging.example'",
        "SPLIT402_PHASE7_WEBHOOK_RECEIVER_URL='https://webhook.staging.example'",
        'SPLIT402_PHASE7_CONTROL_PLANE_TOKEN="merchant-session-token"',
        "SPLIT402_PHASE7_MERCHANT_ID='mrc_123'",
        "SPLIT402_PHASE7_REFERRER_WALLET='referrer-wallet'",
        'SPLIT402_MCP_CONTROL_PLANE_URL="https://control.staging.example"',
        'SPLIT402_MCP_CONTROL_PLANE_TOKEN="merchant-session-token"',
        'SPLIT402_MCP_CAPABILITY="solana.wallet-risk"',
        "SPLIT402_PHASE7_MCP_GATEWAY_EXECUTE='1'",
        'SPLIT402_MCP_SVM_PRIVATE_KEY="funded-devnet-buyer-key"',
      ].join("\n"),
      quotePhase6DirectEnvValues(
        createFilledPhase6EnvText(workspace.phase6EnvText),
      ),
      workspace,
    );

    const report = createSplit402LaunchPreflightReport({
      currentSourceCommit: "abc1234",
      exists: (path) => files.has(path),
      readText: (path) => files.get(path) ?? "",
    });

    expect(report.readyToCollectEvidence).toBe(true);
    expect(
      report.checks.find((check) => check.id === "phase7_hosted_env_values"),
    ).toMatchObject({ ok: true });
    expect(
      report.checks.find(
        (check) => check.id === "phase7_mcp_matches_hosted_env",
      ),
    ).toMatchObject({ ok: true });
    expect(
      report.checks.find((check) => check.id === "phase6_evidence_env_values"),
    ).toMatchObject({ ok: true });
  });

  it("rejects approval decisions before launch evidence collection", () => {
    const workspace = createSplit402ProductEvidenceWorkspace({
      sourceCommit: "abc1234",
    });
    const phase6EnvText = createFilledPhase6EnvText(
      workspace.phase6EnvText,
    ).replace(
      "SPLIT402_PHASE6_EVIDENCE_APPROVAL_DECISION=no-go",
      "SPLIT402_PHASE6_EVIDENCE_APPROVAL_DECISION=approved",
    );
    const files = createWorkspaceFileMap(
      [
        workspace.phase7.envText,
        "SPLIT402_PHASE7_PROOF_ID=phase7-staging-2026-06-29",
        "SPLIT402_PHASE7_PROOF_REVIEWERS=Split402 operators",
        "SPLIT402_PHASE7_STAGING_ENVIRONMENT=hosted-devnet-public-alpha",
        "SPLIT402_PHASE7_CONTROL_PLANE_URL=https://control.staging.example",
        "SPLIT402_PHASE7_DASHBOARD_URL=https://dashboard.staging.example",
        "SPLIT402_PHASE7_DEMO_MERCHANT_URL=https://merchant.staging.example",
        "SPLIT402_PHASE7_WEBHOOK_RECEIVER_URL=https://webhook.staging.example",
        "SPLIT402_PHASE7_CONTROL_PLANE_TOKEN=merchant-session-token",
        "SPLIT402_PHASE7_MERCHANT_ID=mrc_123",
        "SPLIT402_PHASE7_REFERRER_WALLET=referrer-wallet",
        "SPLIT402_MCP_CONTROL_PLANE_URL=https://control.staging.example",
        "SPLIT402_MCP_CONTROL_PLANE_TOKEN=merchant-session-token",
        "SPLIT402_MCP_CAPABILITY=solana.wallet-risk",
        "SPLIT402_PHASE7_MCP_GATEWAY_EXECUTE=1",
        "SPLIT402_MCP_SVM_PRIVATE_KEY=funded-devnet-buyer-key",
        "SPLIT402_PHASE7_APPROVAL_DECISION=approved",
      ].join("\n"),
      phase6EnvText,
      workspace,
    );

    const report = createSplit402LaunchPreflightReport({
      currentSourceCommit: "abc1234",
      exists: (path) => files.has(path),
      readText: (path) => files.get(path) ?? "",
    });

    expect(report.readyToCollectEvidence).toBe(false);
    expect(
      report.checks.find(
        (check) => check.id === "pre_collection_approval_decisions",
      ),
    ).toMatchObject({
      ok: false,
      details: [
        "Set SPLIT402_PHASE6_EVIDENCE_APPROVAL_DECISION=no-go in split402-launch-evidence/phase6-evidence.env until Phase 6 custody status gates pass.",
        "Set SPLIT402_PHASE7_APPROVAL_DECISION=no-go in split402-launch-evidence/phase7-staging.env until Phase 7 hosted proof status gates pass.",
      ],
    });
    expect(report.nextActions).toContain(
      "Set SPLIT402_PHASE6_EVIDENCE_APPROVAL_DECISION=no-go in split402-launch-evidence/phase6-evidence.env until Phase 6 custody status gates pass.",
    );
    expect(report.nextActions).toContain(
      "Set SPLIT402_PHASE7_APPROVAL_DECISION=no-go in split402-launch-evidence/phase7-staging.env until Phase 7 hosted proof status gates pass.",
    );
  });

  it("rejects Phase 6 launch preflight when custody evidence network is mainnet", () => {
    const workspace = createSplit402ProductEvidenceWorkspace({
      sourceCommit: "abc1234",
    });
    const files = createWorkspaceFileMap(
      [
        workspace.phase7.envText,
        "SPLIT402_PHASE7_PROOF_ID=phase7-staging-2026-06-29",
        "SPLIT402_PHASE7_PROOF_REVIEWERS=Split402 operators",
        "SPLIT402_PHASE7_STAGING_ENVIRONMENT=hosted-devnet-public-alpha",
        "SPLIT402_PHASE7_CONTROL_PLANE_URL=https://control.staging.example",
        "SPLIT402_PHASE7_DASHBOARD_URL=https://dashboard.staging.example",
        "SPLIT402_PHASE7_DEMO_MERCHANT_URL=https://merchant.staging.example",
        "SPLIT402_PHASE7_WEBHOOK_RECEIVER_URL=https://webhook.staging.example",
        "SPLIT402_PHASE7_CONTROL_PLANE_TOKEN=merchant-session-token",
        "SPLIT402_PHASE7_MERCHANT_ID=mrc_123",
        "SPLIT402_PHASE7_REFERRER_WALLET=referrer-wallet",
        "SPLIT402_MCP_CONTROL_PLANE_URL=https://control.staging.example",
        "SPLIT402_MCP_CONTROL_PLANE_TOKEN=merchant-session-token",
        "SPLIT402_MCP_CAPABILITY=solana.wallet-risk",
        "SPLIT402_PHASE7_MCP_GATEWAY_EXECUTE=1",
        "SPLIT402_MCP_SVM_PRIVATE_KEY=funded-devnet-buyer-key",
      ].join("\n"),
      createFilledPhase6EnvText(workspace.phase6EnvText).replace(
        "SPLIT402_PHASE6_EVIDENCE_NETWORK=solana:devnet",
        "SPLIT402_PHASE6_EVIDENCE_NETWORK=solana:mainnet",
      ),
      workspace,
    );

    const report = createSplit402LaunchPreflightReport({
      currentSourceCommit: "abc1234",
      exists: (path) => files.has(path),
      readText: (path) => files.get(path) ?? "",
    });

    expect(report.readyToCollectEvidence).toBe(false);
    expect(report.checks.find((check) => check.id === "phase6_evidence_env_values"))
      .toMatchObject({
        ok: false,
        details: expect.arrayContaining([
          "Set SPLIT402_PHASE6_EVIDENCE_NETWORK=solana:devnet in split402-launch-evidence/phase6-evidence.env for launch evidence collection; launch evidence remains devnet-only until separate mainnet approval.",
        ]),
      });
    expect(report.nextActions).toContain(
      "Fill Phase 6 custody env values in split402-launch-evidence/phase6-evidence.env: SPLIT402_PHASE6_EVIDENCE_NETWORK=solana:devnet.",
    );
  });

  it("rejects copied Phase 7 env template placeholders", () => {
    const workspace = createSplit402ProductEvidenceWorkspace({
      sourceCommit: "abc1234",
    });
    const files = createWorkspaceFileMap(
      [
        workspace.phase7.envText,
        "SPLIT402_PHASE7_PROOF_ID=phase7-staging-YYYY-MM-DD",
        "SPLIT402_PHASE7_PROOF_REVIEWERS=Split402 operators",
        "SPLIT402_PHASE7_STAGING_ENVIRONMENT=hosted-devnet-public-alpha",
        "SPLIT402_PHASE7_CONTROL_PLANE_URL=https://control.staging.example",
        "SPLIT402_PHASE7_DASHBOARD_URL=https://dashboard.staging.example",
        "SPLIT402_PHASE7_DEMO_MERCHANT_URL=https://merchant.staging.example",
        "SPLIT402_PHASE7_WEBHOOK_RECEIVER_URL=https://webhook.staging.example",
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
      currentSourceCommit: "abc1234",
      exists: (path) => files.has(path),
      readText: (path) => files.get(path) ?? "",
    });

    expect(report.readyToCollectEvidence).toBe(false);
    expect(report.nextActions).toContain(
      "Fill Phase 7 hosted proof env values in split402-launch-evidence/phase7-staging.env: SPLIT402_PHASE7_PROOF_ID.",
    );
  });

  it("rejects stale launch evidence source commits before collection", () => {
    const workspace = createSplit402ProductEvidenceWorkspace({
      sourceCommit: "abc1234",
    });
    const files = createWorkspaceFileMap(
      [
        workspace.phase7.envText,
        "SPLIT402_PHASE7_PROOF_ID=phase7-staging-2026-06-29",
        "SPLIT402_PHASE7_PROOF_REVIEWERS=Split402 operators",
        "SPLIT402_PHASE7_STAGING_ENVIRONMENT=hosted-devnet-public-alpha",
        "SPLIT402_PHASE7_CONTROL_PLANE_URL=https://control.staging.example",
        "SPLIT402_PHASE7_DASHBOARD_URL=https://dashboard.staging.example",
        "SPLIT402_PHASE7_DEMO_MERCHANT_URL=https://merchant.staging.example",
        "SPLIT402_PHASE7_WEBHOOK_RECEIVER_URL=https://webhook.staging.example",
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
      currentSourceCommit: "def5678",
      exists: (path) => files.has(path),
      readText: (path) => files.get(path) ?? "",
    });

    expect(report.readyToCollectEvidence).toBe(false);
    expect(
      report.checks.find(
        (check) => check.id === "launch_workspace_source_commit",
      ),
    ).toMatchObject({
      ok: false,
      details: expect.arrayContaining([
        "Regenerate split402-launch-evidence/github-settings-review.txt from checkout def5678 before collecting evidence, or recollect evidence from the current checkout if real artifacts already exist; found source_commit abc1234.",
        "Regenerate split402-launch-evidence/phase6-custody-evidence.txt from checkout def5678 before collecting evidence, or recollect evidence from the current checkout if real artifacts already exist; found source_commit abc1234.",
        "Regenerate split402-launch-evidence/phase7-staging-proof.txt from checkout def5678 before collecting evidence, or recollect evidence from the current checkout if real artifacts already exist; found source_commit abc1234.",
      ]),
    });
    expect(report.nextActions).toContain(
      "Regenerate split402-launch-evidence/github-settings-review.txt from checkout def5678 before collecting evidence, or recollect evidence from the current checkout if real artifacts already exist; found source_commit abc1234.",
    );
  });

  it("rejects malformed GitHub settings review records before collection", () => {
    const workspace = createSplit402ProductEvidenceWorkspace({
      sourceCommit: "abc1234",
    });
    const files = createWorkspaceFileMap(
      [
        workspace.phase7.envText,
        "SPLIT402_PHASE7_PROOF_ID=phase7-staging-2026-06-29",
        "SPLIT402_PHASE7_PROOF_REVIEWERS=Split402 operators",
        "SPLIT402_PHASE7_STAGING_ENVIRONMENT=hosted-devnet-public-alpha",
        "SPLIT402_PHASE7_CONTROL_PLANE_URL=https://control.staging.example",
        "SPLIT402_PHASE7_DASHBOARD_URL=https://dashboard.staging.example",
        "SPLIT402_PHASE7_DEMO_MERCHANT_URL=https://merchant.staging.example",
        "SPLIT402_PHASE7_WEBHOOK_RECEIVER_URL=https://webhook.staging.example",
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
    files.set(
      join(workspace.directory, workspace.githubSettingsReviewFileName),
      workspace.githubSettingsReviewText
        .replace("repository: split402protocol/splitx402", "repository: other/project")
        .replace("requires_status_checks: no", "requires_status_checks: maybe"),
    );

    const report = createSplit402LaunchPreflightReport({
      currentSourceCommit: "abc1234",
      exists: (path) => files.has(path),
      readText: (path) => files.get(path) ?? "",
    });

    expect(report.readyToCollectEvidence).toBe(false);
    expect(
      report.checks.find(
        (check) => check.id === "github_settings_review_record",
      ),
    ).toMatchObject({
      ok: false,
      details: expect.arrayContaining([
        "Fix split402-launch-evidence/github-settings-review.txt: repository must be split402protocol/splitx402.",
        "Fix split402-launch-evidence/github-settings-review.txt: requires_status_checks must be yes or no.",
      ]),
    });
    expect(report.nextActions).toContain(
      "Fix split402-launch-evidence/github-settings-review.txt: repository must be split402protocol/splitx402.",
    );
  });

  it("rejects approved GitHub settings review records with incomplete protections", () => {
    const workspace = createSplit402ProductEvidenceWorkspace({
      reviewDate: "2026-06-29",
      sourceCommit: "abc1234",
    });
    const files = createWorkspaceFileMap(
      [
        workspace.phase7.envText,
        "SPLIT402_PHASE7_PROOF_ID=phase7-staging-2026-06-29",
        "SPLIT402_PHASE7_PROOF_REVIEWERS=Split402 operators",
        "SPLIT402_PHASE7_STAGING_ENVIRONMENT=hosted-devnet-public-alpha",
        "SPLIT402_PHASE7_CONTROL_PLANE_URL=https://control.staging.example",
        "SPLIT402_PHASE7_DASHBOARD_URL=https://dashboard.staging.example",
        "SPLIT402_PHASE7_DEMO_MERCHANT_URL=https://merchant.staging.example",
        "SPLIT402_PHASE7_WEBHOOK_RECEIVER_URL=https://webhook.staging.example",
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
    files.set(
      join(workspace.directory, workspace.githubSettingsReviewFileName),
      workspace.githubSettingsReviewText.replace(
        "review_decision: no-go",
        "review_decision: approved",
      ),
    );

    const report = createSplit402LaunchPreflightReport({
      currentSourceCommit: "abc1234",
      exists: (path) => files.has(path),
      readText: (path) => files.get(path) ?? "",
    });

    expect(
      report.checks.find(
        (check) => check.id === "github_settings_review_record",
      ),
    ).toMatchObject({
      ok: false,
      details: expect.arrayContaining([
        "Fix split402-launch-evidence/github-settings-review.txt: branch_protection_enabled must be yes before approval.",
      ]),
    });
  });

  it("accepts short scaffold source commits matching the full checkout SHA", () => {
    const workspace = createSplit402ProductEvidenceWorkspace({
      sourceCommit: "abc1234",
    });
    const files = createWorkspaceFileMap(
      [
        workspace.phase7.envText,
        "SPLIT402_PHASE7_PROOF_ID=phase7-staging-2026-06-29",
        "SPLIT402_PHASE7_PROOF_REVIEWERS=Split402 operators",
        "SPLIT402_PHASE7_STAGING_ENVIRONMENT=hosted-devnet-public-alpha",
        "SPLIT402_PHASE7_CONTROL_PLANE_URL=https://control.staging.example",
        "SPLIT402_PHASE7_DASHBOARD_URL=https://dashboard.staging.example",
        "SPLIT402_PHASE7_DEMO_MERCHANT_URL=https://merchant.staging.example",
        "SPLIT402_PHASE7_WEBHOOK_RECEIVER_URL=https://webhook.staging.example",
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
      currentSourceCommit: "abc1234000000000000000000000000000000000",
      exists: (path) => files.has(path),
      readText: (path) => files.get(path) ?? "",
    });

    expect(
      report.checks.find(
        (check) => check.id === "launch_workspace_source_commit",
      ),
    ).toMatchObject({
      ok: true,
      details: ["Launch evidence source_commit values match the current checkout."],
    });
    expect(report.nextActions.join("\n")).not.toContain("Regenerate");
  });

  it("rejects MCP proof preflight when live execution is explicitly disabled", () => {
    const workspace = createSplit402ProductEvidenceWorkspace();
    const files = createWorkspaceFileMap(
      [
        workspace.phase7.envText,
        "SPLIT402_PHASE7_PROOF_ID=phase7-staging-2026-06-29",
        "SPLIT402_PHASE7_PROOF_REVIEWERS=Split402 operators",
        "SPLIT402_PHASE7_STAGING_ENVIRONMENT=hosted-devnet-public-alpha",
        "SPLIT402_PHASE7_CONTROL_PLANE_URL=https://control.staging.example",
        "SPLIT402_PHASE7_DASHBOARD_URL=https://dashboard.staging.example",
        "SPLIT402_PHASE7_DEMO_MERCHANT_URL=https://merchant.staging.example",
        "SPLIT402_PHASE7_WEBHOOK_RECEIVER_URL=https://webhook.staging.example",
        "SPLIT402_PHASE7_CONTROL_PLANE_TOKEN=merchant-session-token",
        "SPLIT402_PHASE7_MERCHANT_ID=mrc_123",
        "SPLIT402_PHASE7_REFERRER_WALLET=referrer-wallet",
        "SPLIT402_MCP_CONTROL_PLANE_URL=https://control.staging.example",
        "SPLIT402_MCP_CONTROL_PLANE_TOKEN=merchant-session-token",
        "SPLIT402_MCP_CAPABILITY=solana.wallet-risk",
        "SPLIT402_PHASE7_MCP_GATEWAY_EXECUTE=0",
        "SPLIT402_MCP_SVM_PRIVATE_KEY=funded-devnet-buyer-key",
      ].join("\n"),
      createFilledPhase6EnvText(workspace.phase6EnvText),
    );

    const report = createSplit402LaunchPreflightReport({
      exists: (path) => files.has(path),
      readText: (path) => files.get(path) ?? "",
    });

    expect(report.readyToCollectEvidence).toBe(false);
    expect(
      report.checks.find(
        (check) => check.id === "phase7_mcp_live_execution_env",
      ),
    ).toMatchObject({
      ok: false,
      details: expect.arrayContaining([
        "Set SPLIT402_PHASE7_MCP_GATEWAY_EXECUTE=1 in split402-launch-evidence/phase7-staging.env for live router execution.",
      ]),
    });
  });

  it("rejects MCP proof preflight when capability does not match the Phase 7 demo target", () => {
    const workspace = createSplit402ProductEvidenceWorkspace({
      sourceCommit: "abc1234",
    });
    const files = createWorkspaceFileMap(
      [
        workspace.phase7.envText,
        "SPLIT402_PHASE7_PROOF_ID=phase7-staging-2026-06-29",
        "SPLIT402_PHASE7_PROOF_REVIEWERS=Split402 operators",
        "SPLIT402_PHASE7_STAGING_ENVIRONMENT=hosted-devnet-public-alpha",
        "SPLIT402_PHASE7_CONTROL_PLANE_URL=https://control.staging.example",
        "SPLIT402_PHASE7_DASHBOARD_URL=https://dashboard.staging.example",
        "SPLIT402_PHASE7_DEMO_MERCHANT_URL=https://merchant.staging.example",
        "SPLIT402_PHASE7_WEBHOOK_RECEIVER_URL=https://webhook.staging.example",
        "SPLIT402_PHASE7_CONTROL_PLANE_TOKEN=merchant-session-token",
        "SPLIT402_PHASE7_MERCHANT_ID=mrc_123",
        "SPLIT402_PHASE7_REFERRER_WALLET=referrer-wallet",
        "SPLIT402_MCP_CONTROL_PLANE_URL=https://control.staging.example",
        "SPLIT402_MCP_CONTROL_PLANE_TOKEN=merchant-session-token",
        "SPLIT402_MCP_CAPABILITY=evm.wallet-risk",
        "SPLIT402_PHASE7_MCP_GATEWAY_EXECUTE=1",
        "SPLIT402_MCP_SVM_PRIVATE_KEY=funded-devnet-buyer-key",
      ].join("\n"),
      createFilledPhase6EnvText(workspace.phase6EnvText),
      workspace,
    );

    const report = createSplit402LaunchPreflightReport({
      currentSourceCommit: "abc1234",
      exists: (path) => files.has(path),
      readText: (path) => files.get(path) ?? "",
    });

    expect(report.readyToCollectEvidence).toBe(false);
    expect(
      report.checks.find(
        (check) => check.id === "phase7_mcp_live_execution_env",
      ),
    ).toMatchObject({
      ok: false,
      details: expect.arrayContaining([
        "Set SPLIT402_MCP_CAPABILITY=solana.wallet-risk in split402-launch-evidence/phase7-staging.env for the Phase 7 public-alpha MCP proof.",
      ]),
    });
    expect(report.nextActions).toContain(
      "Fill Phase 7 MCP live execution env values in split402-launch-evidence/phase7-staging.env: SPLIT402_MCP_CAPABILITY=solana.wallet-risk.",
    );
  });

  it("rejects MCP proof preflight when live execution points at a different hosted control plane", () => {
    const workspace = createSplit402ProductEvidenceWorkspace({
      sourceCommit: "abc1234",
    });
    const files = createWorkspaceFileMap(
      [
        workspace.phase7.envText,
        "SPLIT402_PHASE7_PROOF_ID=phase7-staging-2026-06-29",
        "SPLIT402_PHASE7_PROOF_REVIEWERS=Split402 operators",
        "SPLIT402_PHASE7_STAGING_ENVIRONMENT=hosted-devnet-public-alpha",
        "SPLIT402_PHASE7_CONTROL_PLANE_URL=https://control.staging.example",
        "SPLIT402_PHASE7_DASHBOARD_URL=https://dashboard.staging.example",
        "SPLIT402_PHASE7_DEMO_MERCHANT_URL=https://merchant.staging.example",
        "SPLIT402_PHASE7_WEBHOOK_RECEIVER_URL=https://webhook.staging.example",
        "SPLIT402_PHASE7_CONTROL_PLANE_TOKEN=merchant-session-token",
        "SPLIT402_PHASE7_MERCHANT_ID=mrc_123",
        "SPLIT402_PHASE7_REFERRER_WALLET=referrer-wallet",
        "SPLIT402_MCP_CONTROL_PLANE_URL=https://other-control.staging.example",
        "SPLIT402_MCP_CONTROL_PLANE_TOKEN=other-token",
        "SPLIT402_MCP_CAPABILITY=solana.wallet-risk",
        "SPLIT402_PHASE7_MCP_GATEWAY_EXECUTE=1",
        "SPLIT402_MCP_SVM_PRIVATE_KEY=funded-devnet-buyer-key",
      ].join("\n"),
      createFilledPhase6EnvText(workspace.phase6EnvText),
      workspace,
    );

    const report = createSplit402LaunchPreflightReport({
      currentSourceCommit: "abc1234",
      exists: (path) => files.has(path),
      readText: (path) => files.get(path) ?? "",
    });

    expect(report.readyToCollectEvidence).toBe(false);
    expect(
      report.checks.find(
        (check) => check.id === "phase7_mcp_matches_hosted_env",
      ),
    ).toMatchObject({
      ok: false,
      details: [
        "Set SPLIT402_MCP_CONTROL_PLANE_URL to match SPLIT402_PHASE7_CONTROL_PLANE_URL in split402-launch-evidence/phase7-staging.env so MCP evidence uses the same hosted control plane.",
        "Set SPLIT402_MCP_CONTROL_PLANE_TOKEN to match SPLIT402_PHASE7_CONTROL_PLANE_TOKEN in split402-launch-evidence/phase7-staging.env so MCP evidence uses the same hosted control-plane auth context.",
      ],
    });
    expect(report.nextActions).toContain(
      "Set SPLIT402_MCP_CONTROL_PLANE_URL to match SPLIT402_PHASE7_CONTROL_PLANE_URL in split402-launch-evidence/phase7-staging.env so MCP evidence uses the same hosted control plane.",
    );
  });

  it("rejects filled hosted proof URL values that are not http URLs", () => {
    const workspace = createSplit402ProductEvidenceWorkspace({
      sourceCommit: "abc1234",
    });
    const files = createWorkspaceFileMap(
      [
        workspace.phase7.envText,
        "SPLIT402_PHASE7_PROOF_ID=phase7-staging-2026-06-29",
        "SPLIT402_PHASE7_PROOF_REVIEWERS=Split402 operators",
        "SPLIT402_PHASE7_STAGING_ENVIRONMENT=hosted-devnet-public-alpha",
        "SPLIT402_PHASE7_CONTROL_PLANE_URL=not-a-url",
        "SPLIT402_PHASE7_DASHBOARD_URL=ftp://dashboard.staging.example",
        "SPLIT402_PHASE7_DEMO_MERCHANT_URL=https://merchant.staging.example",
        "SPLIT402_PHASE7_WEBHOOK_RECEIVER_URL=webhook.staging.example",
        "SPLIT402_PHASE7_CONTROL_PLANE_TOKEN=merchant-session-token",
        "SPLIT402_PHASE7_MERCHANT_ID=mrc_123",
        "SPLIT402_PHASE7_REFERRER_WALLET=referrer-wallet",
        "SPLIT402_MCP_CONTROL_PLANE_URL=not-a-url",
        "SPLIT402_MCP_CONTROL_PLANE_TOKEN=merchant-session-token",
        "SPLIT402_MCP_CAPABILITY=solana.wallet-risk",
        "SPLIT402_PHASE7_MCP_GATEWAY_EXECUTE=1",
        "SPLIT402_MCP_SVM_PRIVATE_KEY=funded-devnet-buyer-key",
      ].join("\n"),
      createFilledPhase6EnvText(workspace.phase6EnvText),
      workspace,
    );

    const report = createSplit402LaunchPreflightReport({
      currentSourceCommit: "abc1234",
      exists: (path) => files.has(path),
      readText: (path) => files.get(path) ?? "",
    });

    expect(report.readyToCollectEvidence).toBe(false);
    expect(
      report.checks.find((check) => check.id === "phase7_hosted_env_values"),
    ).toMatchObject({
      ok: false,
      details: expect.arrayContaining([
        "Set SPLIT402_PHASE7_CONTROL_PLANE_URL to an http(s) URL in split402-launch-evidence/phase7-staging.env.",
        "Set SPLIT402_PHASE7_DASHBOARD_URL to an http(s) URL in split402-launch-evidence/phase7-staging.env.",
        "Set SPLIT402_PHASE7_WEBHOOK_RECEIVER_URL to an http(s) URL in split402-launch-evidence/phase7-staging.env.",
      ]),
    });
    expect(
      report.checks.find(
        (check) => check.id === "phase7_mcp_live_execution_env",
      ),
    ).toMatchObject({
      ok: false,
      details: expect.arrayContaining([
        "Set SPLIT402_MCP_CONTROL_PLANE_URL to an http(s) URL in split402-launch-evidence/phase7-staging.env.",
      ]),
    });
    expect(report.nextActions).toContain(
      "Set SPLIT402_PHASE7_CONTROL_PLANE_URL to an http(s) URL in split402-launch-evidence/phase7-staging.env.",
    );
    const redactedSummary = report.checks.find(
      (check) => check.id === "phase7_redacted_env_summary",
    );
    expect(redactedSummary?.details).toEqual(
      expect.arrayContaining([
        "SPLIT402_PHASE7_CONTROL_PLANE_URL: configured (invalid URL redacted)",
        "SPLIT402_PHASE7_WEBHOOK_RECEIVER_URL: configured (invalid URL redacted)",
        "SPLIT402_PHASE7_CONTROL_PLANE_TOKEN: configured (redacted)",
      ]),
    );
    expect(redactedSummary?.details.join("\n")).not.toContain("not-a-url");
    expect(redactedSummary?.details.join("\n")).not.toContain(
      "merchant-session-token",
    );
  });

  it("uses custom launch workspace paths for Phase 6 env checks", () => {
    const workspace = createSplit402ProductEvidenceWorkspace({
      directory: "evidence/launch",
      reviewDate: "2026-06-29",
    });
    const files = createWorkspaceFileMap(
      [
        workspace.phase7.envText,
        "SPLIT402_PHASE7_PROOF_ID=phase7-staging-2026-06-29",
        "SPLIT402_PHASE7_PROOF_REVIEWERS=Split402 operators",
        "SPLIT402_PHASE7_STAGING_ENVIRONMENT=hosted-devnet-public-alpha",
        "SPLIT402_PHASE7_CONTROL_PLANE_URL=https://control.staging.example",
        "SPLIT402_PHASE7_DASHBOARD_URL=https://dashboard.staging.example",
        "SPLIT402_PHASE7_DEMO_MERCHANT_URL=https://merchant.staging.example",
        "SPLIT402_PHASE7_WEBHOOK_RECEIVER_URL=https://webhook.staging.example",
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
      join(workspace.directory, workspace.githubSettingsReviewFileName),
      workspace.githubSettingsReviewText,
    ],
    [
      join(workspace.directory, workspace.mainnetCanaryEnvFileName),
      workspace.mainnetCanaryEnvText,
    ],
    [
      join(workspace.directory, workspace.mainnetCanaryDryRunFileName),
      workspace.mainnetCanaryDryRunText,
    ],
    [
      join(workspace.directory, workspace.mainnetCanaryRollbackPlanFileName),
      workspace.mainnetCanaryRollbackPlanText,
    ],
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
    )
    .replace(
      "SPLIT402_PHASE6_EVIDENCE_REVIEW_DATE=YYYY-MM-DD",
      "SPLIT402_PHASE6_EVIDENCE_REVIEW_DATE=2026-06-29",
    )
    .replace(
      "SPLIT402_PHASE6_EVIDENCE_FUNDING_WALLET=<merchant-funding-wallet>",
      "SPLIT402_PHASE6_EVIDENCE_FUNDING_WALLET=merchant-funding-wallet",
    );
}

function quotePhase6DirectEnvValues(text: string): string {
  return text
    .replace(
      "SPLIT402_PHASE6_EVIDENCE_REVIEW_ID=phase6-custody-2026-06-29",
      'SPLIT402_PHASE6_EVIDENCE_REVIEW_ID="phase6-custody-2026-06-29"',
    )
    .replace(
      "SPLIT402_PHASE6_EVIDENCE_REVIEW_DATE=2026-06-29",
      'SPLIT402_PHASE6_EVIDENCE_REVIEW_DATE="2026-06-29"',
    )
    .replace(
      "SPLIT402_PHASE6_EVIDENCE_REVIEWERS=Split402 security, operations, protocol",
      'SPLIT402_PHASE6_EVIDENCE_REVIEWERS="Split402 security, operations, protocol"',
    )
    .replace(
      "SPLIT402_PHASE6_EVIDENCE_STAGING_ENVIRONMENT=hosted-devnet-public-alpha",
      "SPLIT402_PHASE6_EVIDENCE_STAGING_ENVIRONMENT='hosted-devnet-public-alpha'",
    )
    .replace(
      "SPLIT402_PHASE6_EVIDENCE_FUNDING_WALLET=merchant-funding-wallet",
      'SPLIT402_PHASE6_EVIDENCE_FUNDING_WALLET="merchant-funding-wallet"',
    )
    .replace(
      "SPLIT402_PHASE6_EVIDENCE_NETWORK=solana:devnet",
      "SPLIT402_PHASE6_EVIDENCE_NETWORK='solana:devnet'",
    )
    .replace(
      "SPLIT402_PHASE6_EVIDENCE_APPROVAL_NOTES=human approval pending",
      'SPLIT402_PHASE6_EVIDENCE_APPROVAL_NOTES="human approval pending"',
    )
    .replace(
      "SPLIT402_PHASE6_EVIDENCE_APPROVAL_DECISION=no-go",
      'SPLIT402_PHASE6_EVIDENCE_APPROVAL_DECISION="no-go"',
    );
}
