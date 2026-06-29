import { describe, expect, it } from "vitest";

import { createPhase7StagingArtifactManifest } from "../src/phase7StagingArtifactManifest.js";
import {
  createPhase7StagingProofRecord,
  validatePhase7StagingProof,
} from "../src/phase7StagingProof.js";
import {
  PHASE7_STAGING_COMMANDS,
  createPhase7StagingStatusReport,
  formatPhase7StagingStatusBrief,
} from "../src/phase7StagingStatus.js";

describe("Phase 7 staging proof", () => {
  it("scaffolds a no-go proof record", () => {
    const record = createPhase7StagingProofRecord({
      proof_id: "phase7-staging-2026-06-26",
      proof_date: "2026-06-26",
    });

    expect(record).toContain("proof_id: phase7-staging-2026-06-26");
    expect(record).toContain("proof_date: 2026-06-26");
    expect(record).toContain("approval_decision: no-go");
    expect(record).toContain("dashboard_summary_evidence:");
    expect(record).toContain("funding_balance_evidence:");
    expect(record).toContain("mcp_gateway_evidence:");
  });

  it("keeps status command guidance aligned with local evidence capture", () => {
    const commands: string[] = PHASE7_STAGING_COMMANDS.map(
      (command) => command.command,
    );

    expect(commands).toContain("corepack pnpm phase7:hosted:preflight");
    expect(commands).toContain("corepack pnpm phase7:staging:collect-reads");
    expect(commands).toContain(
      "corepack pnpm demo:mcp-bundle phase7-staging-evidence/mcp-bundle.json",
    );
    expect(commands).toContain(
      "corepack pnpm demo:paid-suite phase7-staging-evidence/paid-suite.log",
    );
    expect(commands).toContain(
      "corepack pnpm phase7:staging:derive-receipt-verification phase7-staging-evidence/paid-suite.log phase7-staging-evidence/receipt-verification.json",
    );
    const expectedCaptureOrder = [
      "corepack pnpm phase7:hosted:preflight",
      "corepack pnpm phase7:staging:collect-reads",
      "run the payout-obligations read with SPLIT402_FUNDING_BALANCE_PROVIDER=solana-rpc and attach covered/deficit evidence",
      "corepack pnpm phase7:staging:collect-mcp-gateway",
      "corepack pnpm demo:mcp-gateway:smoke",
      "corepack pnpm demo:mcp-bundle phase7-staging-evidence/mcp-bundle.json",
      "corepack pnpm demo:paid-suite phase7-staging-evidence/paid-suite.log",
      "corepack pnpm phase7:staging:derive-receipt-verification phase7-staging-evidence/paid-suite.log phase7-staging-evidence/receipt-verification.json",
      "corepack pnpm phase7:staging:manifest <phase7-staging-proof.txt> phase7-staging-evidence/artifact-manifest.json",
      "corepack pnpm phase7:staging:assemble",
    ];
    const commandPositions = expectedCaptureOrder.map((command) =>
      commands.indexOf(command),
    );
    expect(commandPositions.every((position) => position >= 0)).toBe(true);
    expect([...commandPositions].sort((left, right) => left - right)).toEqual(
      commandPositions,
    );
    expect(commands).not.toContain("corepack pnpm dashboard");
    expect(
      commands.some((command) => command.startsWith("curl the Phase 7")),
    ).toBe(false);
  });

  it("reports missing and placeholder fields", () => {
    const validation = validatePhase7StagingProof(`proof_id: pending
approval_decision: no-go
`);

    expect(validation.approved).toBe(false);
    expect(validation.missingFields).toContain("proof_date");
    expect(validation.placeholderFields).toContain("proof_id");
    expect(validation.invalidFields).toContain(
      "approval_decision must be approved before Phase 7 staging proof can close",
    );
  });

  it("rejects copied template placeholders", () => {
    const validation = validatePhase7StagingProof(
      createPhase7StagingProofRecord({
        proof_id: "phase7-staging-YYYY-MM-DD",
        proof_date: "YYYY-MM-DD",
        reviewers: "Split402 operators",
        source_commit: "fd88024",
        staging_environment: "hosted-devnet-public-alpha",
        control_plane_url: "https://control.staging.example",
        dashboard_url: "https://dashboard.staging.example",
        demo_merchant_url: "https://merchant.staging.example",
        webhook_receiver_url: "https://webhook.staging.example",
        hosted_preflight_evidence: "attached: hosted-preflight.json",
        agent_discovery_evidence: "attached: agent-discovery.json",
        paid_request_evidence: "attached: paid-suite.log",
        receipt_verification_evidence: "attached: receipt-verification.json",
        referrer_balance_evidence: "attached: referrer-balances.json",
        dashboard_summary_evidence: "attached: dashboard-summary.json",
        webhook_delivery_evidence: "attached: webhook-events.json",
        payout_obligation_evidence: "attached: payout-obligations.json",
        funding_balance_evidence: "attached: funding-balance.json",
        mcp_bundle_evidence: "attached: mcp-bundle.json",
        mcp_gateway_evidence: "attached: mcp-gateway.jsonl",
        artifact_manifest_evidence: "attached: artifact-manifest.json",
        commands_run: "attached: commands.log",
        approval_decision: "approved",
      }),
    );

    expect(validation.approved).toBe(false);
    expect(validation.placeholderFields).toContain("proof_id");
    expect(validation.placeholderFields).toContain("proof_date");
    expect(validation.invalidFields).toContain("proof_date must use YYYY-MM-DD");
  });

  it("approves a complete staging proof record", () => {
    const validation = validatePhase7StagingProof(
      createPhase7StagingProofRecord({
        proof_id: "phase7-staging-2026-06-26",
        proof_date: "2026-06-26",
        reviewers: "Split402 operators",
        source_commit: "fd88024",
        staging_environment: "staging-us",
        control_plane_url: "https://control.staging.example",
        dashboard_url: "https://dashboard.staging.example",
        demo_merchant_url: "https://merchant.staging.example",
        webhook_receiver_url: "https://webhook.staging.example",
        hosted_preflight_evidence: "attached: hosted-preflight.json",
        agent_discovery_evidence: "attached: agent-discovery.json",
        paid_request_evidence: "attached: paid-suite.log",
        receipt_verification_evidence: "attached: receipt-verification.json",
        referrer_balance_evidence: "attached: referrer-balances.json",
        dashboard_summary_evidence: "attached: dashboard-summary.json",
        webhook_delivery_evidence: "attached: webhook-events.json",
        payout_obligation_evidence: "attached: payout-obligations.json",
        funding_balance_evidence: "attached: funding-balance.json",
        mcp_bundle_evidence: "attached: mcp-bundle.json",
        mcp_gateway_evidence: "attached: mcp-gateway.jsonl",
        artifact_manifest_evidence: "attached: artifact-manifest.json",
        commands_run: "attached: commands.log",
        approval_decision: "approved",
      }),
    );

    expect(validation).toMatchObject({
      approved: true,
      missingFields: [],
      placeholderFields: [],
      invalidFields: [],
    });
  });

  it("rejects malformed proof metadata and weak evidence references", () => {
    const validation = validatePhase7StagingProof(
      createPhase7StagingProofRecord({
        proof_id: "phase7-staging-2026-06-26",
        proof_date: "2026-02-31",
        reviewers: "Split402 operators",
        source_commit: "not-a-sha",
        staging_environment: "staging-us",
        control_plane_url: "control.staging.example",
        dashboard_url: "https://dashboard.staging.example",
        demo_merchant_url: "https://merchant.staging.example",
        webhook_receiver_url: "https://webhook.staging.example",
        hosted_preflight_evidence: "attached: hosted-preflight.json",
        agent_discovery_evidence: "agent-discovery.json",
        paid_request_evidence: "attached: paid-suite.log",
        receipt_verification_evidence: "attached: receipt-verification.json",
        referrer_balance_evidence: "attached: referrer-balances.json",
        dashboard_summary_evidence: "attached: dashboard-summary.json",
        webhook_delivery_evidence: "attached: webhook-events.json",
        payout_obligation_evidence: "attached: payout-obligations.json",
        funding_balance_evidence: "attached: funding-balance.json",
        mcp_bundle_evidence: "attached: mcp-bundle.json",
        mcp_gateway_evidence: "attached: mcp-gateway.jsonl",
        artifact_manifest_evidence: "attached: artifact-manifest.json",
        commands_run: "attached: commands.log",
        approval_decision: "approved",
      }),
    );

    expect(validation.approved).toBe(false);
    expect(validation.invalidFields).toContain("proof_date must use YYYY-MM-DD");
    expect(validation.invalidFields).toContain(
      "source_commit must be a 7-40 character git SHA",
    );
    expect(validation.invalidFields).toContain(
      "control_plane_url must be an http(s) URL",
    );
    expect(validation.invalidFields).toContain(
      "agent_discovery_evidence must be an attached local artifact",
    );
  });

  it("rejects remote evidence references at the proof validation layer", () => {
    const validation = validatePhase7StagingProof(
      createPhase7StagingProofRecord({
        proof_id: "phase7-staging-2026-06-26",
        proof_date: "2026-06-26",
        reviewers: "Split402 operators",
        source_commit: "fd88024",
        staging_environment: "staging-us",
        control_plane_url: "https://control.staging.example",
        dashboard_url: "https://dashboard.staging.example",
        demo_merchant_url: "https://merchant.staging.example",
        webhook_receiver_url: "https://webhook.staging.example",
        hosted_preflight_evidence:
          "https://artifacts.example/hosted-preflight.json",
        agent_discovery_evidence: "attached: agent-discovery.json",
        paid_request_evidence: "attached: paid-suite.log",
        receipt_verification_evidence: "attached: receipt-verification.json",
        referrer_balance_evidence: "attached: referrer-balances.json",
        dashboard_summary_evidence: "attached: dashboard-summary.json",
        webhook_delivery_evidence: "attached: webhook-events.json",
        payout_obligation_evidence: "attached: payout-obligations.json",
        funding_balance_evidence: "attached: funding-balance.json",
        mcp_bundle_evidence: "attached: mcp-bundle.json",
        mcp_gateway_evidence: "attached: mcp-gateway.jsonl",
        artifact_manifest_evidence: "attached: artifact-manifest.json",
        commands_run: "attached: commands.log",
        approval_decision: "approved",
      }),
    );

    expect(validation.approved).toBe(false);
    expect(validation.invalidFields).toContain(
      "hosted_preflight_evidence must be an attached local artifact",
    );
  });

  it("lists staging proof commands before proof exists", () => {
    const report = createPhase7StagingStatusReport();

    expect(report).toMatchObject({
      schema: "split402.phase7_staging_status.v1",
      readyForPublicAlphaDemo: false,
      proofChecked: false,
    });
    expect(report.commands).toBe(PHASE7_STAGING_COMMANDS);
    expect(report.commands.map((item) => item.command)).toContain(
      "corepack pnpm phase7:staging:init",
    );
    expect(report.commands.map((item) => item.command)).toContain(
      "corepack pnpm phase7:staging:seed",
    );
    expect(report.commands.map((item) => item.command)).toContain(
      "corepack pnpm phase7:staging-proof",
    );
    expect(report.commands.map((item) => item.command)).toContain(
      "corepack pnpm phase7:staging:collect-reads",
    );
    expect(report.commands.map((item) => item.command)).toContain(
      "corepack pnpm phase7:hosted:preflight",
    );
    expect(report.commands.map((item) => item.command)).toContain(
      "corepack pnpm phase7:staging:assemble",
    );
    expect(report.commands.map((item) => item.command)).toContain(
      "corepack pnpm phase7:staging:manifest <phase7-staging-proof.txt> phase7-staging-evidence/artifact-manifest.json",
    );
    expect(report.commands.map((item) => item.evidenceField)).toContain(
      "funding_balance_evidence",
    );
    expect(report.commands.map((item) => item.evidenceField)).toContain(
      "mcp_gateway_evidence",
    );
    expect(report.commands.map((item) => item.command)).toContain(
      "corepack pnpm demo:mcp-gateway:smoke",
    );
    expect(report.gateStatuses.every((item) => item.status === "not_checked")).toBe(
      true,
    );
    expect(report.nextActions).toContain(
      "Create the evidence workspace with corepack pnpm phase7:staging:init.",
    );
    expect(report.nextActions).toContain(
      "Seed the hosted staging demo state with SPLIT402_PHASE7_SEED_CONFIRM=seed-hosted-staging corepack pnpm phase7:staging:seed.",
    );
    expect(report.nextActions).toContain(
      "Generate a proof scaffold with corepack pnpm phase7:staging-proof.",
    );
    expect(report.nextActions).toContain(
      "Run the hosted staging preflight with corepack pnpm phase7:hosted:preflight.",
    );
    expect(report.nextActions).toContain(
      "Capture funding-balance evidence by running corepack pnpm phase7:staging:collect-reads with SPLIT402_FUNDING_BALANCE_PROVIDER=solana-rpc.",
    );
    expect(report.nextActions).toContain(
      "Capture MCP bundle evidence with corepack pnpm demo:mcp-bundle phase7-staging-evidence/mcp-bundle.json.",
    );
    expect(report.nextActions).toContain(
      "Capture paid-suite evidence with corepack pnpm demo:paid-suite phase7-staging-evidence/paid-suite.log.",
    );
    expect(report.nextActions).toContain(
      "Derive receipt-verification evidence with corepack pnpm phase7:staging:derive-receipt-verification phase7-staging-evidence/paid-suite.log phase7-staging-evidence/receipt-verification.json.",
    );
    expect(report.nextActions).not.toContain(
      "Run the dashboard, MCP bundle, paid-suite, control-plane read checks, and funding-balance check against staging.",
    );
    expect(formatPhase7StagingStatusBrief(report)).toContain(
      "Phase 7 hosted staging proof: not checked",
    );
  });

  it("reports gate-level blockers for incomplete proof evidence", () => {
    const report = createPhase7StagingStatusReport(`proof_id: pending
proof_date: 2026-06-26
approval_decision: no-go
funding_balance_evidence: funding.json
`);

    expect(report.proofChecked).toBe(true);
    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.gateStatuses).toContainEqual({
      gate: "proof_scaffold",
      evidenceField: "proof_id",
      status: "placeholder",
      blockers: ["proof_id is a placeholder"],
    });
    expect(report.gateStatuses).toContainEqual({
      gate: "funding_balance",
      evidenceField: "funding_balance_evidence",
      status: "invalid",
      blockers: [
        "funding_balance_evidence must be an attached local artifact",
      ],
    });
    expect(report.gateStatuses).toContainEqual({
      gate: "mcp_bundle",
      evidenceField: "mcp_bundle_evidence",
      status: "missing",
      blockers: ["mcp_bundle_evidence is missing"],
    });
    expect(report.nextActions.join("\n")).not.toContain(
      "Replace placeholder fields: approval_decision",
    );
    expect(report.nextActions.join("\n")).toContain(
      "Fill hosted proof identity fields in split402-launch-evidence/phase7-staging.env",
    );
    expect(report.nextActions.join("\n")).toContain(
      "Fill hosted endpoint URL fields in split402-launch-evidence/phase7-staging.env",
    );
    expect(report.nextActions.join("\n")).toContain(
      "Capture hosted_preflight_evidence with corepack pnpm phase7:hosted:preflight",
    );
    expect(report.nextActions.join("\n")).toContain(
      "Capture mcp_gateway_evidence with SPLIT402_PHASE7_MCP_GATEWAY_EXECUTE=1 corepack pnpm phase7:staging:collect-mcp-gateway",
    );
    expect(report.nextActions.join("\n")).toContain(
      "Reassemble with corepack pnpm phase7:staging:assemble",
    );
    expect(report.validation?.invalidFields).toContain(
      "approval_decision must be approved before Phase 7 staging proof can close",
    );
    expect(report.nextActions.join("\n")).toContain(
      "Keep approval_decision=no-go until every Phase 7 hosted proof gate passes",
    );
    const brief = formatPhase7StagingStatusBrief(report);
    expect(brief).toContain("Phase 7 hosted staging proof: checked, blocked");
    expect(brief).toContain("Ready gates:");
    expect(brief).toContain(
      "Launch posture: public-alpha approval remains no-go until hosted proof gates pass.",
    );
    expect(report.gateStatuses).toContainEqual({
      gate: "mcp_gateway",
      evidenceField: "mcp_gateway_evidence",
      status: "missing",
      blockers: ["mcp_gateway_evidence is missing"],
    });
  });

  it("blocks approved proof records when attached artifacts are missing", () => {
    const report = createPhase7StagingStatusReport(
      createPhase7StagingProofRecord({
        proof_id: "phase7-staging-2026-06-26",
        proof_date: "2026-06-26",
        reviewers: "Split402 operators",
        source_commit: "fd88024",
        staging_environment: "staging-us",
        control_plane_url: "https://control.staging.example",
        dashboard_url: "https://dashboard.staging.example",
        demo_merchant_url: "https://merchant.staging.example",
        webhook_receiver_url: "https://webhook.staging.example",
        hosted_preflight_evidence: "attached: hosted-preflight.json",
        agent_discovery_evidence: "attached: agent-discovery.json",
        paid_request_evidence: "attached: paid-suite.log",
        receipt_verification_evidence: "attached: receipt-verification.json",
        referrer_balance_evidence: "attached: referrer-balances.json",
        dashboard_summary_evidence: "attached: dashboard-summary.json",
        webhook_delivery_evidence: "attached: webhook-events.json",
        payout_obligation_evidence: "attached: payout-obligations.json",
        funding_balance_evidence: "attached: missing-funding-balance.json",
        mcp_bundle_evidence: "attached: mcp-bundle.json",
        mcp_gateway_evidence: "attached: mcp-gateway.jsonl",
        artifact_manifest_evidence: "attached: artifact-manifest.json",
        commands_run: "attached: commands.log",
        approval_decision: "approved",
      }),
      {
        artifactBaseDir: "evidence",
        artifactExists: (path) => !path.endsWith("missing-funding-balance.json"),
        resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
      },
    );

    expect(report.validation?.approved).toBe(true);
    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.artifactStatuses).toContainEqual({
      evidenceField: "agent_discovery_evidence",
      reference: "attached: agent-discovery.json",
      artifactPath: "evidence/agent-discovery.json",
      status: "present",
      blockers: [],
    });
    expect(report.artifactStatuses).toContainEqual({
      evidenceField: "funding_balance_evidence",
      reference: "attached: missing-funding-balance.json",
      artifactPath: "evidence/missing-funding-balance.json",
      status: "missing",
      blockers: [
        "funding_balance_evidence artifact is missing: evidence/missing-funding-balance.json",
      ],
    });
    expect(report.gateStatuses).toContainEqual({
      gate: "funding_balance",
      evidenceField: "funding_balance_evidence",
      status: "invalid",
      blockers: [
        "funding_balance_evidence artifact is missing: evidence/missing-funding-balance.json",
      ],
    });
    expect(report.nextActions).toContain(
      "Capture funding_balance_evidence with SPLIT402_FUNDING_BALANCE_PROVIDER=solana-rpc corepack pnpm phase7:staging:collect-reads --evidence-env-file split402-launch-evidence/phase7-staging.env.",
    );
    expect(report.nextActions.join("\n")).not.toContain(
      "funding_balance_evidence artifact is missing:",
    );
  });

  it("groups missing control-plane read artifacts into one capture action", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) =>
        !path.endsWith("agent-discovery.json") &&
        !path.endsWith("dashboard-summary.json") &&
        artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.nextActions).toContain(
      "Capture read evidence (agent_discovery_evidence, dashboard_summary_evidence) with corepack pnpm phase7:staging:collect-reads --evidence-env-file split402-launch-evidence/phase7-staging.env.",
    );
    expect(report.nextActions.join("\n")).not.toContain(
      "agent_discovery_evidence artifact is missing:",
    );
  });

  it("blocks approved proof records when hosted preflight checks failed", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/hosted-preflight.json",
      encode(
        JSON.stringify({
          schema: "split402.phase7_hosted_staging_preflight.v1",
          controlPlaneUrl: "https://control.staging.example",
          dashboardUrl: "https://dashboard.staging.example",
          sourceCommit: "fd88024",
          checks: [
            {
              name: "control_plane_health",
              status: 200,
              expectedStatus: 200,
              ok: true,
            },
            {
              name: "dashboard_health",
              status: 200,
              expectedStatus: 200,
              ok: true,
            },
            {
              name: "dashboard_session",
              status: 200,
              expectedStatus: 200,
              ok: true,
            },
            {
              name: "dashboard_config_without_viewer",
              status: 200,
              expectedStatus: 401,
              ok: false,
            },
            {
              name: "dashboard_config_with_viewer",
              status: 200,
              expectedStatus: 200,
              ok: true,
            },
          ],
        }),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.hostedPreflightStatus).toEqual({
      status: "invalid",
      blockers: ["hosted_preflight_evidence has 1 failed checks"],
    });
    expect(report.gateStatuses).toContainEqual({
      gate: "hosted_staging_preflight",
      evidenceField: "hosted_preflight_evidence",
      status: "invalid",
      blockers: ["hosted_preflight_evidence has 1 failed checks"],
    });
  });

  it("blocks approved proof records when hosted preflight targets different URLs", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/hosted-preflight.json",
      encode(
        JSON.stringify({
          schema: "split402.phase7_hosted_staging_preflight.v1",
          controlPlaneUrl: "https://other-control.staging.example",
          dashboardUrl: "https://dashboard.staging.example",
          sourceCommit: "fd88024",
          checks: createPassingHostedPreflightChecks(),
        }),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.hostedPreflightStatus.blockers).toContain(
      "hosted_preflight_evidence controlPlaneUrl does not match proof",
    );
  });

  it("blocks approved proof records when hosted preflight omits source commit", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/hosted-preflight.json",
      encode(
        JSON.stringify({
          schema: "split402.phase7_hosted_staging_preflight.v1",
          controlPlaneUrl: "https://control.staging.example",
          dashboardUrl: "https://dashboard.staging.example",
          checks: createPassingHostedPreflightChecks(),
        }),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.hostedPreflightStatus.blockers).toContain(
      "hosted_preflight_evidence sourceCommit is missing",
    );
  });

  it("blocks approved proof records when hosted preflight source commit differs", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/hosted-preflight.json",
      encode(
        JSON.stringify({
          schema: "split402.phase7_hosted_staging_preflight.v1",
          controlPlaneUrl: "https://control.staging.example",
          dashboardUrl: "https://dashboard.staging.example",
          sourceCommit: "abc1234",
          checks: createPassingHostedPreflightChecks(),
        }),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.hostedPreflightStatus.blockers).toContain(
      "hosted_preflight_evidence sourceCommit does not match proof",
    );
  });

  it("blocks approved proof status when the proof source commit is stale", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
      currentSourceCommit: "abc1234000000000000000000000000000000000",
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.sourceCommitStatus).toEqual({
      status: "invalid",
      proofSourceCommit: "fd88024",
      currentSourceCommit: "abc1234000000000000000000000000000000000",
      blockers: ["source_commit does not match current checkout"],
    });
    expect(report.gateStatuses).toContainEqual({
      gate: "hosted_staging_preflight",
      evidenceField: "hosted_preflight_evidence",
      status: "invalid",
      blockers: ["source_commit does not match current checkout"],
    });
  });

  it("blocks approved proof status when the current checkout is dirty", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
      currentSourceCommit: "fd88024000000000000000000000000000000000",
      currentWorktreeDirty: true,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.sourceCommitStatus).toEqual({
      status: "invalid",
      proofSourceCommit: "fd88024",
      currentSourceCommit: "fd88024000000000000000000000000000000000",
      currentWorktreeDirty: true,
      blockers: ["current checkout has uncommitted changes"],
    });
    expect(report.gateStatuses).toContainEqual({
      gate: "hosted_staging_preflight",
      evidenceField: "hosted_preflight_evidence",
      status: "invalid",
      blockers: ["current checkout has uncommitted changes"],
    });
  });

  it("approves staged proof status when local artifacts match the manifest", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(true);
    expect(report.manifestStatus).toEqual({
      status: "valid",
      blockers: [],
    });
    expect(report.controlPlaneReadStatus).toEqual({
      status: "valid",
      blockers: [],
    });
    expect(report.paidRequestStatus).toEqual({
      status: "valid",
      blockers: [],
    });
    expect(report.fundingBalanceStatus).toEqual({
      status: "valid",
      blockers: [],
    });
    expect(report.mcpBundleStatus).toEqual({
      status: "valid",
      blockers: [],
    });
    expect(report.mcpGatewayStatus).toEqual({
      status: "valid",
      blockers: [],
    });
    expect(report.commandEvidenceStatus).toEqual({
      status: "valid",
      blockers: [],
    });
  });

  it("blocks staged proof status when paid-suite evidence did not pass", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/paid-suite.log",
      encode(
        [
          "--- valid paid request ---",
          JSON.stringify(
            {
              paidSuitePassed: false,
              validReceipt: {
                receiptId: "rcp_valid",
                paymentId: "pay_valid",
                commissionBps: 0,
                commissionAmountAtomic: "0",
                referrerCreditAtomic: "0",
                settlementTxSignature: "tx_valid",
              },
              invalidReceipt: {
                receiptId: "rcp_invalid",
                paymentId: "pay_invalid",
                commissionBps: 0,
                commissionAmountAtomic: "0",
                referrerCreditAtomic: "0",
                settlementTxSignature: "tx_invalid",
              },
            },
            null,
            2,
          ),
          "",
        ].join("\n"),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.paidRequestStatus.blockers).toContain(
      "paid_request_evidence paidSuitePassed must be true",
    );
    expect(report.paidRequestStatus.blockers).toContain(
      "paid_request_evidence validReceipt.commissionBps must be positive",
    );
  });

  it("blocks staged proof status when receipt verification differs from paid-suite valid receipt", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/receipt-verification.json",
      encode(
        JSON.stringify(
          createValidReceiptVerificationEvidence({
            validReceipt: { receiptId: "rcp_other" },
          }),
        ),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.paidRequestStatus.blockers).toContain(
      "receipt_verification_evidence validReceipt does not match paid_request_evidence validReceipt",
    );
  });

  it("blocks staged proof status when receipt verification differs from paid-suite invalid claim receipt", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/receipt-verification.json",
      encode(
        JSON.stringify(
          createValidReceiptVerificationEvidence({
            invalidClaimReceipt: { settlementTxSignature: "tx_other" },
          }),
        ),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.paidRequestStatus.blockers).toContain(
      "receipt_verification_evidence invalidClaimReceipt does not match paid_request_evidence invalidReceipt",
    );
  });

  it("blocks staged proof status when receipt verification top-level receipt id drifts", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/receipt-verification.json",
      encode(
        JSON.stringify(createValidReceiptVerificationEvidence({ receiptId: "rcp_other" })),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.paidRequestStatus.blockers).toContain(
      "receipt_verification_evidence receiptId does not match validReceipt.receiptId",
    );
  });

  it("blocks staged proof status when command evidence omits required validation", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/commands.log",
      encode(
        [
          "corepack pnpm phase7:staging:init",
          "corepack pnpm phase7:staging-proof phase7-staging-proof.txt",
          "corepack pnpm demo:paid-suite",
          "corepack pnpm phase7:staging:status phase7-staging-proof.txt",
          "",
        ].join("\n"),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.commandEvidenceStatus.blockers).toContain(
      "commands_run missing required command: corepack pnpm lint",
    );
    expect(report.commandEvidenceStatus.blockers).toContain(
      "commands_run missing required command: corepack pnpm phase7:staging:seed",
    );
    expect(report.commandEvidenceStatus.blockers).toContain(
      "commands_run missing required command: corepack pnpm audit --audit-level high",
    );
    expect(report.commandEvidenceStatus.blockers).toContain(
      "commands_run missing required command: git rev-parse HEAD",
    );
    expect(report.commandEvidenceStatus.blockers).toContain(
      "commands_run missing required command: git status --short --branch",
    );
    expect(report.nextActions.join("\n")).toContain(
      "Replace split402-launch-evidence/phase7-staging-evidence/commands.log with a real command transcript",
    );
    expect(report.nextActions.join("\n")).toContain(
      "Missing commands include: git rev-parse HEAD",
    );
    expect(report.nextActions).not.toContain(
      "commands_run missing required command: corepack pnpm lint",
    );
  });

  it("blocks staged proof status when command evidence only mentions commands in prose", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/commands.log",
      encode(
        [
          "The operator reported running git rev-parse HEAD and git status --short --branch.",
          "The notes mention corepack pnpm lint, corepack pnpm test, corepack pnpm build, and corepack pnpm audit --audit-level high.",
          "The checklist also names corepack pnpm phase7:staging:init, corepack pnpm phase7:staging:seed, corepack pnpm phase7:staging-proof, corepack pnpm phase7:hosted:preflight, corepack pnpm phase7:staging:collect-reads, corepack pnpm phase7:staging:collect-mcp-gateway, corepack pnpm demo:mcp-gateway:smoke, corepack pnpm demo:mcp-bundle, corepack pnpm demo:paid-suite, corepack pnpm phase7:staging:derive-receipt-verification, corepack pnpm phase7:staging:manifest, corepack pnpm phase7:staging:assemble, corepack pnpm phase7:staging:status, corepack pnpm typecheck, and corepack pnpm vectors:check.",
          "",
        ].join("\n"),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.commandEvidenceStatus.blockers).toContain(
      "commands_run artifact must include shell command lines, not only prose",
    );
    expect(report.commandEvidenceStatus.blockers).toContain(
      "commands_run missing required command: corepack pnpm lint",
    );
    expect(report.commandEvidenceStatus.blockers).toContain(
      "commands_run missing required command: git rev-parse HEAD",
    );
    expect(report.nextActions.join("\n")).toContain(
      "command lines uncommented",
    );
    expect(report.nextActions).not.toContain(
      "commands_run artifact must include shell command lines, not only prose",
    );
  });

  it("accepts combined launch evidence workspace init as Phase 7 workspace evidence", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/commands.log",
      encode(
        createValidCommandsLog().replace(
          "$ corepack pnpm phase7:staging:init",
          "$ corepack pnpm product:evidence:init",
        ),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.commandEvidenceStatus.blockers).not.toContain(
      "commands_run missing required command: corepack pnpm phase7:staging:init",
    );
  });

  it("accepts PowerShell UTF-16LE redirected text artifacts", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/commands.log",
      encodeUtf16Le(createValidCommandsLog()),
    );
    artifacts.set(
      "evidence/paid-suite.log",
      encodeUtf16Le(createValidPaidSuiteLog()),
    );
    const manifest = createPhase7StagingArtifactManifest(proofText, {
      artifactBaseDir: "evidence",
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });
    artifacts.set(
      "evidence/artifact-manifest.json",
      encode(JSON.stringify(manifest, null, 2)),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.commandEvidenceStatus).toEqual({
      status: "valid",
      blockers: [],
    });
    expect(report.paidRequestStatus.status).toBe("valid");
    expect(report.manifestStatus).toEqual({ status: "valid", blockers: [] });
  });

  it("blocks staged proof status when artifact manifest evidence is remote", () => {
    const proofText = createPhase7StagingProofRecord({
      proof_id: "phase7-staging-2026-06-26",
      proof_date: "2026-06-26",
      reviewers: "Split402 operators",
      source_commit: "fd88024",
      staging_environment: "staging-us",
      control_plane_url: "https://control.staging.example",
      dashboard_url: "https://dashboard.staging.example",
      demo_merchant_url: "https://merchant.staging.example",
      webhook_receiver_url: "https://webhook.staging.example",
      hosted_preflight_evidence: "attached: hosted-preflight.json",
      agent_discovery_evidence: "attached: agent-discovery.json",
      paid_request_evidence: "attached: paid-suite.log",
      receipt_verification_evidence: "attached: receipt-verification.json",
      referrer_balance_evidence: "attached: referrer-balances.json",
      dashboard_summary_evidence: "attached: dashboard-summary.json",
      webhook_delivery_evidence: "attached: webhook-events.json",
      payout_obligation_evidence: "attached: payout-obligations.json",
      funding_balance_evidence: "attached: funding-balance.json",
      mcp_bundle_evidence: "attached: mcp-bundle.json",
      mcp_gateway_evidence: "attached: mcp-gateway.jsonl",
      artifact_manifest_evidence: "https://artifacts.example/artifact-manifest.json",
      commands_run: "attached: commands.log",
      approval_decision: "approved",
    });

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: () => true,
      readArtifact: (path) => readTestArtifact(createManifestArtifacts(createManifestProof()), path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.manifestStatus).toEqual({
      status: "invalid",
      blockers: [
        "artifact_manifest_evidence must be an attached local artifact for status validation",
      ],
    });
    expect(report.gateStatuses).toContainEqual({
      gate: "artifact_manifest",
      evidenceField: "artifact_manifest_evidence",
      status: "invalid",
      blockers: [
        "artifact_manifest_evidence must be an attached local artifact",
      ],
    });
  });

  it("blocks staged proof status when control-plane read evidence is empty", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/referrer-balances.json",
      encode(
        JSON.stringify({
          summary: {
            referrerWallet: "referrer-wallet",
            generatedAt: "2026-06-26T00:00:00.000Z",
            assets: [
              {
                asset: "usdc-devnet",
                pendingAmountAtomic: "0",
                availableAmountAtomic: "0",
                heldAmountAtomic: "0",
                inFlightAmountAtomic: "0",
                paidAmountAtomic: "0",
                totalEarnedAmountAtomic: "0",
              },
            ],
          },
        }),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.controlPlaneReadStatus.blockers).toContain(
      "referrer_balance_evidence must show positive referrer earnings",
    );
  });

  it("blocks staged proof status when dashboard summary omits the discovered active route", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/dashboard-summary.json",
      encode(
        JSON.stringify(
          createValidDashboardSummary({
            routes: { activeRouteIds: ["rte_other"] },
          }),
        ),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.controlPlaneReadStatus.blockers).toContain(
      "dashboard_summary_evidence activeRouteIds does not include discovered active route id",
    );
  });

  it("blocks staged proof status when dashboard summary omits the discovered campaign", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/dashboard-summary.json",
      encode(
        JSON.stringify(
          createValidDashboardSummary({
            campaigns: { activeCampaignIds: ["cmp_other"] },
          }),
        ),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.controlPlaneReadStatus.blockers).toContain(
      "dashboard_summary_evidence activeCampaignIds does not include discovered active route campaignId",
    );
  });

  it("blocks staged proof status when referrer balance targets a different wallet", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/referrer-balances.json",
      encode(JSON.stringify(createValidReferrerBalance("other-referrer-wallet"))),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.controlPlaneReadStatus.blockers).toContain(
      "referrer_balance_evidence referrerWallet does not match any discovered active route referrerWallet",
    );
  });

  it("blocks staged proof status when payout obligations target a different merchant", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/payout-obligations.json",
      encode(JSON.stringify(createValidPayoutObligations("mrc_other"))),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.controlPlaneReadStatus.blockers).toContain(
      "payout_obligation_evidence merchantId does not match dashboard_summary_evidence merchant.id",
    );
  });

  it("blocks staged proof status when delivered webhook targets a different merchant", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/webhook-events.json",
      encode(JSON.stringify(createValidWebhookEvents("mrc_other"))),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.controlPlaneReadStatus.blockers).toContain(
      "webhook_delivery_evidence delivered merchantId does not match dashboard_summary_evidence merchant.id",
    );
  });

  it("blocks staged proof status when MCP bundle economics are not useful", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/mcp-bundle.json",
      encode(
        JSON.stringify({
          schemaVersion: "split402.mcp-demo-bundle.v1",
          project: "Split402",
          mcp: {
            tools: [
              {
                name: "split402.walletRiskScore",
                paidHttpCall: { method: "POST", url: "https://merchant.example/v1/risk" },
                x402: {
                  scheme: "exact",
                  network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
                  asset: "usdc-devnet",
                  amountAtomic: "10000",
                },
                split402: {
                  campaignId: "cmp_001",
                  operationId: "wallet-risk-score",
                  commissionBps: 2000,
                  protocolFeeBpsOfCommission: 1000,
                },
              },
            ],
          },
          expectedEconomics: {
            paymentAmountAtomic: "10000",
            referrerCommissionBps: 2000,
            protocolFeeBpsOfCommission: 1000,
            commissionAmountAtomic: "2000",
            protocolFeeAtomic: "0",
            referrerCreditAtomic: "2000",
            merchantRetainsAtomic: "8000",
          },
        }),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.mcpBundleStatus.blockers).toContain(
      "mcp_bundle_evidence expectedEconomics.protocolFeeAtomic does not match protocol fee bps",
    );
    expect(report.gateStatuses).toContainEqual({
      gate: "mcp_bundle",
      evidenceField: "mcp_bundle_evidence",
      status: "invalid",
      blockers: expect.arrayContaining([
        "mcp_bundle_evidence expectedEconomics.protocolFeeAtomic does not match protocol fee bps",
      ]),
    });
  });

  it("blocks staged proof status when MCP gateway evidence is not a useful transcript", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/mcp-gateway.jsonl",
      encode(
        [
          JSON.stringify({
            direction: "request",
            message: { jsonrpc: "2.0", id: "tools", method: "tools/list" },
          }),
          JSON.stringify({
            direction: "response",
            message: { jsonrpc: "2.0", id: "tools", result: { tools: [] } },
          }),
          "",
        ].join("\n"),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence missing split402.searchCapabilities request",
    );
    expect(report.gateStatuses).toContainEqual({
      gate: "mcp_gateway",
      evidenceField: "mcp_gateway_evidence",
      status: "invalid",
      blockers: expect.arrayContaining([
        "mcp_gateway_evidence missing split402.searchCapabilities request",
      ]),
    });
  });

  it("blocks staged proof status when MCP gateway tools/list omits router tools", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/mcp-gateway.jsonl",
      encode(
        createValidMcpGatewayTranscript({
          tools: ["split402.execute"],
        }),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence tools/list missing split402.searchCapabilities",
    );
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence tools/list missing split402.getReceipt",
    );
  });

  it("blocks staged proof status when MCP gateway evidence has no execution", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/mcp-gateway.jsonl",
      encode(
        createValidMcpGatewayTranscript({
          includeExecute: false,
        }),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence missing split402.execute request",
    );
  });

  it("blocks staged proof status when MCP search evidence has no budget", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/mcp-gateway.jsonl",
      encode(
        createValidMcpGatewayTranscript({
          includeSearchBudget: false,
        }),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence search request missing budget.maxAmountAtomic",
    );
  });

  it("blocks staged proof status when MCP execute evidence has no budget", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/mcp-gateway.jsonl",
      encode(
        createValidMcpGatewayTranscript({
          includeExecuteBudget: false,
        }),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence execute request missing budget.maxAmountAtomic",
    );
  });

  it("blocks staged proof status when MCP execute budget differs from search", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/mcp-gateway.jsonl",
      encode(
        createValidMcpGatewayTranscript({
          executeMaxAmountAtomic: "60000",
        }),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence execute budget.maxAmountAtomic does not match search budget",
    );
  });

  it("blocks staged proof status when MCP paid amount exceeds budget", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/mcp-gateway.jsonl",
      encode(
        createValidMcpGatewayTranscript({
          searchMaxAmountAtomic: "9000",
          executeMaxAmountAtomic: "9000",
          amountPaidAtomic: "10000",
        }),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence execute response amountPaidAtomic exceeds budget.maxAmountAtomic",
    );
  });

  it("blocks staged proof status when MCP execution is demo mode", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/mcp-gateway.jsonl",
      encode(
        createValidMcpGatewayTranscript({
          executeExecutionMode: "router-demo-mock",
        }),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence execute response executionMode must be router-live-agent-sdk",
    );
  });

  it("blocks staged proof status when MCP execute capability differs from search", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/mcp-gateway.jsonl",
      encode(
        createValidMcpGatewayTranscript({
          executeCapability: "solana.other-risk",
        }),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence execute capability does not match search capability",
    );
  });

  it("blocks staged proof status when MCP execute provider was not discovered", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/mcp-gateway.jsonl",
      encode(
        createValidMcpGatewayTranscript({
          searchProviderId: "split402-other-merchant",
        }),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence execute providerId was not returned by search",
    );
  });

  it("blocks staged proof status when MCP search providers have no ids", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/mcp-gateway.jsonl",
      encode(
        createValidMcpGatewayTranscript({
          includeSearchProviderId: false,
        }),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence search response has no provider ids",
    );
  });

  it("blocks staged proof status when MCP selected provider omits payment details", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/mcp-gateway.jsonl",
      encode(
        createValidMcpGatewayTranscript({
          includeSearchProviderNetwork: false,
          includeSearchProviderAsset: false,
          includeSearchProviderMerchantOrigin: false,
          includeSearchProviderOperationId: false,
          includeSearchProviderCampaignId: false,
          includeSearchProviderPayToWallet: false,
          includeSearchProviderAmount: false,
          includeSearchProviderRouteId: false,
          includeSearchProviderReferrerWallet: false,
          includeSearchProviderPayoutWallet: false,
        }),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence selected provider network is missing",
    );
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence selected provider asset is missing",
    );
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence selected provider merchantOrigin is missing",
    );
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence selected provider operationId is missing",
    );
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence selected provider campaignId is missing",
    );
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence selected provider payToWallet is missing",
    );
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence selected provider amountAtomic must be a positive atomic amount",
    );
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence selected provider routeId is missing",
    );
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence selected provider referrerWallet is missing",
    );
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence selected provider payoutWallet is missing",
    );
  });

  it("blocks staged proof status when MCP execute response omits provider summary", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/mcp-gateway.jsonl",
      encode(
        createValidMcpGatewayTranscript({
          includeExecuteProvider: false,
        }),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence execute response missing selected provider summary",
    );
  });

  it("blocks staged proof status when MCP execute provider omits payment details", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/mcp-gateway.jsonl",
      encode(
        createValidMcpGatewayTranscript({
          includeExecuteProviderId: false,
          includeExecuteProviderNetwork: false,
          includeExecuteProviderAsset: false,
          includeExecuteProviderMerchantOrigin: false,
          includeExecuteProviderOperationId: false,
          includeExecuteProviderCampaignId: false,
          includeExecuteProviderPayToWallet: false,
          includeExecuteProviderAmount: false,
          includeExecuteProviderRouteId: false,
          includeExecuteProviderReferrerWallet: false,
          includeExecuteProviderPayoutWallet: false,
        }),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence execute provider providerId is missing",
    );
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence execute provider network is missing",
    );
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence execute provider asset is missing",
    );
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence execute provider merchantOrigin is missing",
    );
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence execute provider operationId is missing",
    );
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence execute provider campaignId is missing",
    );
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence execute provider payToWallet is missing",
    );
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence execute provider amountAtomic must be a positive atomic amount",
    );
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence execute provider routeId is missing",
    );
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence execute provider referrerWallet is missing",
    );
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence execute provider payoutWallet is missing",
    );
  });

  it("blocks staged proof status when MCP execute provider differs from selected provider", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/mcp-gateway.jsonl",
      encode(
        createValidMcpGatewayTranscript({
          executeProviderNetwork: "solana:wrong-network",
          executeProviderAsset: "wrong-asset",
          executeProviderPayToWallet: "wrong-pay-to-wallet",
          executeProviderAmountAtomic: "9000",
          executeProviderRouteId: "rte_ffffffffffffffffffffffffffffffff",
        }),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence execute provider network does not match selected provider",
    );
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence execute provider asset does not match selected provider",
    );
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence execute provider payToWallet does not match selected provider",
    );
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence execute provider amountAtomic does not match selected provider",
    );
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence execute provider routeId does not match selected provider",
    );
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence getReceipt network does not match execute provider",
    );
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence execute amountPaidAtomic does not match execute provider amountAtomic",
    );
  });

  it("blocks staged proof status when MCP receipt does not match selected provider", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/mcp-gateway.jsonl",
      encode(
        createValidMcpGatewayTranscript({
          lookupNetwork: "solana:wrong-network",
          lookupAsset: "wrong-asset",
          lookupPayToWallet: "wrong-pay-to-wallet",
          searchProviderAmountAtomic: "9000",
        }),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence getReceipt network does not match selected provider",
    );
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence getReceipt asset does not match selected provider",
    );
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence getReceipt payToWallet does not match selected provider",
    );
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence execute amountPaidAtomic does not match selected provider amountAtomic",
    );
  });

  it("blocks staged proof status when MCP receipt context differs from selected provider", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/mcp-gateway.jsonl",
      encode(
        createValidMcpGatewayTranscript({
          lookupMerchantOrigin: "https://other-merchant.example",
          lookupOperationId: "other-operation",
          lookupCampaignId: "cmp_ffffffffffffffffffffffffffffffff",
        }),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence getReceipt merchantOrigin does not match selected provider",
    );
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence getReceipt operationId does not match selected provider",
    );
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence getReceipt campaignId does not match selected provider",
    );
  });

  it("blocks staged proof status when MCP receipt route differs from selected provider", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/mcp-gateway.jsonl",
      encode(
        createValidMcpGatewayTranscript({
          searchProviderRouteId: "rte_00000000000000000000000000000003",
          lookupRouteId: "rte_00000000000000000000000000000004",
        }),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence getReceipt routeId does not match selected provider",
    );
  });

  it("blocks staged proof status when MCP selected route is absent from discovery evidence", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/agent-discovery.json",
      encode(
        JSON.stringify({
          routes: [
            {
              id: "rte_ffffffffffffffffffffffffffffffff",
              status: "active",
              campaignId: "cmp_00000000000000000000000000000002",
              referrerWallet: "referrer-wallet",
              payoutWallet: "payout-wallet",
            },
          ],
        }),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence selected provider routeId was not found in agent_discovery_evidence",
    );
  });

  it("blocks staged proof status when MCP selected route attribution differs from discovery evidence", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/agent-discovery.json",
      encode(
        JSON.stringify({
          routes: [
            {
              id: "rte_00000000000000000000000000000003",
              status: "active",
              campaignId: "cmp_ffffffffffffffffffffffffffffffff",
              referrerWallet: "other-referrer-wallet",
              payoutWallet: "other-payout-wallet",
            },
          ],
        }),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence selected provider campaignId does not match agent_discovery_evidence",
    );
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence selected provider referrerWallet does not match agent_discovery_evidence",
    );
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence selected provider payoutWallet does not match agent_discovery_evidence",
    );
  });

  it("blocks staged proof status when MCP receipt wallets differ from selected provider", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/mcp-gateway.jsonl",
      encode(
        createValidMcpGatewayTranscript({
          searchProviderReferrerWallet: "referrer-wallet",
          searchProviderPayoutWallet: "payout-wallet",
          lookupReferrerWallet: "other-referrer-wallet",
          lookupPayoutWallet: "other-payout-wallet",
        }),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence getReceipt referrerWallet does not match selected provider",
    );
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence getReceipt payoutWallet does not match selected provider",
    );
  });

  it("blocks staged proof status when MCP execution evidence has no receipt lookup", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/mcp-gateway.jsonl",
      encode(
        createValidMcpGatewayTranscript({
          includeReceiptLookup: false,
        }),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence missing split402.getReceipt request",
    );
  });

  it("blocks staged proof status when MCP receipt lookup returns a different receipt", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/mcp-gateway.jsonl",
      encode(
        createValidMcpGatewayTranscript({
          lookupReceiptId: "rcp_99999999999999999999999999999999",
        }),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence getReceipt receipt.receiptId does not match execute receiptId",
    );
  });

  it("blocks staged proof status when MCP receipt lookup credit differs from execution", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/mcp-gateway.jsonl",
      encode(
        createValidMcpGatewayTranscript({
          lookupReferrerCreditAtomic: "1700",
        }),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence getReceipt referrerCreditAtomic does not match execute response",
    );
  });

  it("blocks staged proof status when MCP referrer credit is not positive", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/mcp-gateway.jsonl",
      encode(
        createValidMcpGatewayTranscript({
          executeReferrerCreditAtomic: "0",
          lookupReferrerCreditAtomic: "0",
        }),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence execute response referrerCreditAtomic must be positive",
    );
  });

  it("blocks staged proof status when MCP receipt amount differs from execution", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/mcp-gateway.jsonl",
      encode(
        createValidMcpGatewayTranscript({
          lookupRequiredAmountAtomic: "9000",
        }),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence getReceipt requiredAmountAtomic does not match execute amountPaidAtomic",
    );
  });

  it("blocks staged proof status when MCP receipt lookup has no route", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/mcp-gateway.jsonl",
      encode(
        createValidMcpGatewayTranscript({
          includeLookupRouteId: false,
        }),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence getReceipt receipt.routeId is missing",
    );
  });

  it("blocks staged proof status when MCP receipt lookup omits commission amount", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/mcp-gateway.jsonl",
      encode(
        createValidMcpGatewayTranscript({
          includeLookupCommissionAmount: false,
        }),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence getReceipt commissionAmountAtomic must be positive",
    );
  });

  it("blocks staged proof status when MCP receipt lookup omits commission bps", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/mcp-gateway.jsonl",
      encode(
        createValidMcpGatewayTranscript({
          includeLookupCommissionBps: false,
        }),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence getReceipt commissionBps must be positive basis points",
    );
  });

  it("blocks staged proof status when MCP receipt commission bps arithmetic is wrong", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/mcp-gateway.jsonl",
      encode(
        createValidMcpGatewayTranscript({
          lookupCommissionAmountAtomic: "1900",
        }),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence getReceipt commissionAmountAtomic does not match commissionBps",
    );
  });

  it("blocks staged proof status when MCP receipt lookup omits protocol fee bps", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/mcp-gateway.jsonl",
      encode(
        createValidMcpGatewayTranscript({
          includeLookupProtocolFeeBps: false,
        }),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence getReceipt protocolFeeBpsOfCommission must be basis points",
    );
  });

  it("blocks staged proof status when MCP receipt protocol fee bps arithmetic is wrong", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/mcp-gateway.jsonl",
      encode(
        createValidMcpGatewayTranscript({
          executeReferrerCreditAtomic: "1900",
          lookupReferrerCreditAtomic: "1900",
          lookupCommissionAmountAtomic: "2000",
          lookupProtocolFeeAtomic: "100",
        }),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence getReceipt protocolFeeAtomic does not match protocolFeeBpsOfCommission",
    );
  });

  it("blocks staged proof status when MCP receipt split arithmetic is wrong", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/mcp-gateway.jsonl",
      encode(
        createValidMcpGatewayTranscript({
          lookupCommissionAmountAtomic: "2100",
          lookupProtocolFeeAtomic: "200",
        }),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.mcpGatewayStatus.blockers).toContain(
      "mcp_gateway_evidence getReceipt referrerCreditAtomic does not equal commission minus protocol fee",
    );
  });

  it("blocks staged proof status when funding balance evidence is unresolved", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/funding-balance.json",
      encode(
        JSON.stringify({
          summary: {
            schema: "split402.merchant_obligation_summary.v1",
            merchantId: "mrc_001",
            generatedAt: "2026-06-26T00:00:00.000Z",
            assets: [
              {
                asset: "usdc-devnet",
                fundingStatus: "unknown",
                outstandingAmountAtomic: "1000",
              },
            ],
          },
        }),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.fundingBalanceStatus).toEqual({
      status: "invalid",
      blockers: [
        "funding_balance_evidence usdc-devnet fundingStatus is unknown",
        "funding_balance_evidence must include at least one asset with covered or deficit funding status",
      ],
    });
    expect(report.gateStatuses).toContainEqual({
      gate: "funding_balance",
      evidenceField: "funding_balance_evidence",
      status: "invalid",
      blockers: [
        "funding_balance_evidence usdc-devnet fundingStatus is unknown",
        "funding_balance_evidence must include at least one asset with covered or deficit funding status",
      ],
    });
  });

  it("blocks staged proof status when deficit evidence omits the real deficit", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set(
      "evidence/funding-balance.json",
      encode(
        JSON.stringify({
          summary: {
            schema: "split402.merchant_obligation_summary.v1",
            merchantId: "mrc_001",
            generatedAt: "2026-06-26T00:00:00.000Z",
            assets: [
              {
                asset: "usdc-devnet",
                fundingStatus: "deficit",
                fundingAmountAtomic: "900",
                fundingDeficitAtomic: "0",
                outstandingAmountAtomic: "1000",
              },
            ],
          },
        }),
      ),
    );

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.fundingBalanceStatus.blockers).toContain(
      "funding_balance_evidence usdc-devnet deficit status must report a positive deficit",
    );
  });

  it("blocks staged proof status when artifact manifest hashes are stale", () => {
    const proofText = createManifestProof();
    const artifacts = createManifestArtifacts(proofText);
    artifacts.set("evidence/paid-suite.log", encode("tampered proof\n"));

    const report = createPhase7StagingStatusReport(proofText, {
      artifactBaseDir: "evidence",
      artifactExists: (path) => artifacts.has(path),
      readArtifact: (path) => readTestArtifact(artifacts, path),
      resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
    });

    expect(report.readyForPublicAlphaDemo).toBe(false);
    expect(report.manifestStatus.status).toBe("invalid");
    expect(report.manifestStatus.blockers).toContain(
      "paid_request_evidence artifact hash does not match manifest",
    );
    expect(report.gateStatuses).toContainEqual({
      gate: "artifact_manifest",
      evidenceField: "artifact_manifest_evidence",
      status: "invalid",
      blockers: expect.arrayContaining([
        "paid_request_evidence artifact hash does not match manifest",
      ]),
    });
  });
});

function createManifestProof(): string {
  return createPhase7StagingProofRecord({
    proof_id: "phase7-staging-2026-06-26",
    proof_date: "2026-06-26",
    reviewers: "Split402 operators",
    source_commit: "fd88024",
    staging_environment: "staging-us",
    control_plane_url: "https://control.staging.example",
    dashboard_url: "https://dashboard.staging.example",
    demo_merchant_url: "https://merchant.staging.example",
    webhook_receiver_url: "https://webhook.staging.example",
    hosted_preflight_evidence: "attached: hosted-preflight.json",
    agent_discovery_evidence: "attached: agent-discovery.json",
    paid_request_evidence: "attached: paid-suite.log",
    receipt_verification_evidence: "attached: receipt-verification.json",
    referrer_balance_evidence: "attached: referrer-balances.json",
    dashboard_summary_evidence: "attached: dashboard-summary.json",
    webhook_delivery_evidence: "attached: webhook-events.json",
    payout_obligation_evidence: "attached: payout-obligations.json",
    funding_balance_evidence: "attached: funding-balance.json",
    mcp_bundle_evidence: "attached: mcp-bundle.json",
    mcp_gateway_evidence: "attached: mcp-gateway.jsonl",
    artifact_manifest_evidence: "attached: artifact-manifest.json",
    commands_run: "attached: commands.log",
    approval_decision: "approved",
  });
}

function createManifestArtifacts(proofText: string): Map<string, Uint8Array> {
  const artifacts = new Map<string, Uint8Array>([
    [
      "evidence/hosted-preflight.json",
      encode(
        JSON.stringify({
          schema: "split402.phase7_hosted_staging_preflight.v1",
          controlPlaneUrl: "https://control.staging.example",
          dashboardUrl: "https://dashboard.staging.example",
          sourceCommit: "fd88024",
          checks: createPassingHostedPreflightChecks(),
        }),
      ),
    ],
    ["evidence/paid-suite.log", encode(createValidPaidSuiteLog())],
    [
      "evidence/receipt-verification.json",
      encode(JSON.stringify(createValidReceiptVerificationEvidence())),
    ],
    [
      "evidence/agent-discovery.json",
      encode(JSON.stringify(createValidAgentDiscovery())),
    ],
    [
      "evidence/referrer-balances.json",
      encode(JSON.stringify(createValidReferrerBalance())),
    ],
    [
      "evidence/dashboard-summary.json",
      encode(JSON.stringify(createValidDashboardSummary())),
    ],
    [
      "evidence/webhook-events.json",
      encode(JSON.stringify(createValidWebhookEvents())),
    ],
    [
      "evidence/payout-obligations.json",
      encode(JSON.stringify(createValidPayoutObligations())),
    ],
    ["evidence/mcp-bundle.json", encode(JSON.stringify(createValidMcpBundle()))],
    ["evidence/mcp-gateway.jsonl", encode(createValidMcpGatewayTranscript())],
    [
      "evidence/funding-balance.json",
      encode(JSON.stringify(createValidPayoutObligations())),
    ],
    ["evidence/commands.log", encode(createValidCommandsLog())],
  ]);
  const manifest = createPhase7StagingArtifactManifest(proofText, {
    artifactBaseDir: "evidence",
    readArtifact: (path) => readTestArtifact(artifacts, path),
    resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
  });
  artifacts.set(
    "evidence/artifact-manifest.json",
    encode(JSON.stringify(manifest, null, 2)),
  );
  return artifacts;
}

function readTestArtifact(
  artifacts: ReadonlyMap<string, Uint8Array>,
  path: string,
): Uint8Array {
  const artifact = artifacts.get(path);
  if (artifact === undefined) {
    throw new Error(`missing artifact ${path}`);
  }
  return artifact;
}

function createPassingHostedPreflightChecks(): unknown[] {
  return [
    {
      name: "control_plane_health",
      status: 200,
      expectedStatus: 200,
      ok: true,
    },
    {
      name: "dashboard_health",
      status: 200,
      expectedStatus: 200,
      ok: true,
    },
    {
      name: "dashboard_session",
      status: 200,
      expectedStatus: 200,
      ok: true,
    },
    {
      name: "dashboard_config_without_viewer",
      status: 401,
      expectedStatus: 401,
      ok: true,
    },
    {
      name: "dashboard_config_with_viewer",
      status: 200,
      expectedStatus: 200,
      ok: true,
    },
  ];
}

function createValidAgentDiscovery(): unknown {
  return {
    routes: [
      {
        id: "rte_00000000000000000000000000000003",
        status: "active",
        campaignId: "cmp_00000000000000000000000000000002",
        referrerWallet: "referrer-wallet",
        payoutWallet: "payout-wallet",
      },
    ],
  };
}

function createValidReferrerBalance(referrerWallet = "referrer-wallet"): unknown {
  return {
    summary: {
      referrerWallet,
      generatedAt: "2026-06-26T00:00:00.000Z",
      assets: [
        {
          asset: "usdc-devnet",
          pendingAmountAtomic: "0",
          availableAmountAtomic: "1800",
          heldAmountAtomic: "0",
          inFlightAmountAtomic: "0",
          paidAmountAtomic: "0",
          totalEarnedAmountAtomic: "1800",
        },
      ],
    },
  };
}

function createValidDashboardSummary(
  overrides: {
    merchant?: Partial<Record<string, unknown>>;
    campaigns?: Partial<Record<string, unknown>>;
    routes?: Partial<Record<string, unknown>>;
  } = {},
): unknown {
  return {
    summary: {
      schema: "split402.merchant_dashboard_summary.v1",
      generatedAt: "2026-06-26T00:00:00.000Z",
      merchant: {
        id: "mrc_001",
        slug: "merchant",
        displayName: "Merchant",
        status: "active",
        ...(overrides.merchant ?? {}),
      },
      reliability: {
        acceptsReceipts: true,
        payoutReady: true,
        webhookReady: true,
        discoveryReady: true,
        signals: {
          verifiedOrigins: 1,
          activeOfferReceiptKeys: 1,
          activeWebhookKeys: 1,
          activePayoutWallets: 1,
        },
      },
      campaigns: {
        total: 1,
        byStatus: { draft: 0, active: 1, paused: 0, closed: 0 },
        activeCampaignIds: ["cmp_00000000000000000000000000000002"],
        operationCount: 1,
        ...(overrides.campaigns ?? {}),
      },
      routes: {
        total: 1,
        byStatus: { active: 1, suspended: 0, expired: 0, revoked: 0 },
        activeRouteIds: ["rte_00000000000000000000000000000003"],
        ...(overrides.routes ?? {}),
      },
    },
  };
}

function createValidWebhookEvents(merchantId = "mrc_001"): unknown {
  return {
    events: [
      {
        id: "evt_001",
        eventType: "webhook.receipt.accepted.v1",
        status: "delivered",
        attempts: 1,
        payload: { merchantId },
      },
    ],
  };
}

function createValidMcpBundle(): unknown {
  return {
    schemaVersion: "split402.mcp-demo-bundle.v1",
    project: "Split402",
    generatedAt: "2026-06-26T00:00:00.000Z",
    merchant: {
      merchantId: "mrc_001",
      origin: "https://merchant.staging.example",
      discoveryUrl: "https://merchant.staging.example/.well-known/split402.json",
      servicePublicKey: "service-public-key",
    },
    mcp: {
      serverName: "split402-demo",
      transport: "stdio",
      tools: [
        {
          name: "split402.walletRiskScore",
          description: "Paid wallet-risk score demo tool.",
          inputSchema: {
            type: "object",
            properties: { wallet: { type: "string" } },
            required: ["wallet"],
            additionalProperties: false,
          },
          paidHttpCall: {
            method: "POST",
            url: "https://merchant.staging.example/v1/risk",
            bodyTemplate: { wallet: "{{wallet}}" },
          },
          x402: {
            scheme: "exact",
            network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
            asset: "usdc-devnet",
            amountAtomic: "10000",
          },
          split402: {
            campaignId: "cmp_001",
            operationId: "wallet-risk-score",
            commissionBps: 2000,
            protocolFeeBpsOfCommission: 1000,
            referralClaimSources: ["mcp-config", "tool-argument", "http-header"],
            receiptVerification: {
              package: "@split402/agent-sdk",
              method: "Split402AgentClient.verifyReceipt",
            },
          },
        },
      ],
    },
    expectedEconomics: {
      paymentAmountAtomic: "10000",
      referrerCommissionBps: 2000,
      protocolFeeBpsOfCommission: 1000,
      commissionAmountAtomic: "2000",
      protocolFeeAtomic: "200",
      referrerCreditAtomic: "1800",
      merchantRetainsAtomic: "8000",
    },
  };
}

function createValidPayoutObligations(merchantId = "mrc_001"): unknown {
  return {
    summary: {
      schema: "split402.merchant_obligation_summary.v1",
      merchantId,
      generatedAt: "2026-06-26T00:00:00.000Z",
      assets: [
        {
          asset: "usdc-devnet",
          fundingStatus: "covered",
          fundingAmountAtomic: "1800",
          fundingDeficitAtomic: "0",
          pendingAmountAtomic: "0",
          availableAmountAtomic: "1800",
          heldAmountAtomic: "0",
          inFlightAmountAtomic: "0",
          paidAmountAtomic: "0",
          outstandingAmountAtomic: "1800",
          totalAccruedAmountAtomic: "1800",
          accrualCount: 1,
          pendingAccrualCount: 0,
          availableAccrualCount: 1,
          heldAccrualCount: 0,
          inFlightAccrualCount: 0,
          paidAccrualCount: 0,
        },
      ],
    },
  };
}

function createValidPaidSuiteLog(): string {
  return [
    "merchant ready at http://127.0.0.1:4021",
    "",
    "--- preflight ---",
    JSON.stringify({ readyForPaidRun: true }),
    "",
    "--- valid paid request ---",
    JSON.stringify({ risk: "low" }),
    JSON.stringify({
      split402ReceiptVerified: true,
      errors: [],
      receiptId: "rcp_valid",
      referralCreditStatus: "credited",
      commissionBps: 2000,
      commissionAmountAtomic: "2000",
      referrerCreditAtomic: "1800",
      settlementTxSignature: "tx_valid",
    }),
    "",
    "--- invalid-claim paid request ---",
    JSON.stringify({ risk: "low" }),
    JSON.stringify({
      split402ReceiptVerified: true,
      errors: [],
      receiptId: "rcp_invalid",
      referralCreditStatus: "zero",
      commissionBps: 0,
      commissionAmountAtomic: "0",
      referrerCreditAtomic: "0",
      settlementTxSignature: "tx_invalid",
    }),
    JSON.stringify(
      {
        paidSuitePassed: true,
        validReceipt: {
          receiptId: "rcp_valid",
          paymentId: "pay_valid",
          commissionBps: 2000,
          commissionAmountAtomic: "2000",
          referrerCreditAtomic: "1800",
          settlementTxSignature: "tx_valid",
          routeId: "rte_001",
        },
        invalidReceipt: {
          receiptId: "rcp_invalid",
          paymentId: "pay_invalid",
          commissionBps: 0,
          commissionAmountAtomic: "0",
          referrerCreditAtomic: "0",
          settlementTxSignature: "tx_invalid",
        },
      },
      null,
      2,
    ),
    "",
  ].join("\n");
}

function createValidReceiptVerificationEvidence(
  overrides: {
    receiptId?: string;
    validReceipt?: Partial<Record<string, unknown>>;
    invalidClaimReceipt?: Partial<Record<string, unknown>>;
  } = {},
): unknown {
  const validReceipt = {
    receiptId: "rcp_valid",
    paymentId: "pay_valid",
    commissionBps: 2000,
    commissionAmountAtomic: "2000",
    referrerCreditAtomic: "1800",
    settlementTxSignature: "tx_valid",
    routeId: "rte_001",
    ...(overrides.validReceipt ?? {}),
  };
  const invalidClaimReceipt = {
    receiptId: "rcp_invalid",
    paymentId: "pay_invalid",
    commissionBps: 0,
    commissionAmountAtomic: "0",
    referrerCreditAtomic: "0",
    settlementTxSignature: "tx_invalid",
    ...(overrides.invalidClaimReceipt ?? {}),
  };
  return {
    schema: "split402.phase7_receipt_verification_evidence.v1",
    generatedAt: "2026-06-26T00:00:00.000Z",
    sourceLogPath: "evidence/paid-suite.log",
    receiptId: overrides.receiptId ?? validReceipt.receiptId,
    verificationStatus: "verified",
    split402ReceiptVerified: true,
    errors: [],
    validReceipt,
    invalidClaimReceipt,
  };
}

function createValidCommandsLog(): string {
  return [
    "$ git rev-parse HEAD",
    "fd88024000000000000000000000000000000000",
    "$ git status --short --branch",
    "## main...origin/main",
    "$ corepack pnpm phase7:staging:init",
    "$ SPLIT402_PHASE7_SEED_CONFIRM=seed-hosted-staging corepack pnpm phase7:staging:seed",
    "$ corepack pnpm phase7:staging-proof phase7-staging-proof.txt",
    "$ corepack pnpm phase7:hosted:preflight",
    "$ corepack pnpm phase7:staging:collect-reads",
    "$ corepack pnpm phase7:staging:collect-mcp-gateway",
    "$ corepack pnpm demo:mcp-gateway:smoke",
    "$ corepack pnpm demo:mcp-bundle phase7-staging-evidence/mcp-bundle.json",
    "$ corepack pnpm demo:paid-suite phase7-staging-evidence/paid-suite.log",
    "$ corepack pnpm phase7:staging:derive-receipt-verification phase7-staging-evidence/paid-suite.log phase7-staging-evidence/receipt-verification.json",
    "$ corepack pnpm phase7:staging:manifest phase7-staging-proof.txt phase7-staging-evidence/artifact-manifest.json",
    "$ corepack pnpm phase7:staging:assemble phase7-staging-proof.txt",
    "$ corepack pnpm phase7:staging:status phase7-staging-proof.txt",
    "$ corepack pnpm lint",
    "$ corepack pnpm typecheck",
    "$ corepack pnpm test",
    "$ corepack pnpm build",
    "$ corepack pnpm vectors:check",
    "$ corepack pnpm audit --audit-level high",
    "",
  ].join("\n");
}

function createValidMcpGatewayTranscript(
  options: {
    includeExecute?: boolean;
    includeExecuteBudget?: boolean;
    includeReceiptLookup?: boolean;
    includeSearchBudget?: boolean;
    searchMaxAmountAtomic?: string;
    executeMaxAmountAtomic?: string;
    searchCapability?: string;
    executeCapability?: string;
    includeSearchProviderId?: boolean;
    searchProviderId?: string;
    executeProviderId?: string;
    executeExecutionMode?: string;
    includeSearchProviderNetwork?: boolean;
    includeSearchProviderAsset?: boolean;
    includeSearchProviderMerchantOrigin?: boolean;
    includeSearchProviderOperationId?: boolean;
    includeSearchProviderCampaignId?: boolean;
    includeSearchProviderPayToWallet?: boolean;
    includeSearchProviderAmount?: boolean;
    includeSearchProviderRouteId?: boolean;
    includeSearchProviderReferrerWallet?: boolean;
    includeSearchProviderPayoutWallet?: boolean;
    searchProviderNetwork?: string;
    searchProviderAsset?: string;
    searchProviderMerchantOrigin?: string;
    searchProviderOperationId?: string;
    searchProviderCampaignId?: string;
    searchProviderPayToWallet?: string;
    searchProviderAmountAtomic?: string;
    searchProviderRouteId?: string;
    searchProviderReferrerWallet?: string;
    searchProviderPayoutWallet?: string;
    includeExecuteProvider?: boolean;
    includeExecuteProviderId?: boolean;
    executeProviderIdValue?: string;
    includeExecuteProviderNetwork?: boolean;
    includeExecuteProviderAsset?: boolean;
    includeExecuteProviderMerchantOrigin?: boolean;
    includeExecuteProviderOperationId?: boolean;
    includeExecuteProviderCampaignId?: boolean;
    includeExecuteProviderPayToWallet?: boolean;
    includeExecuteProviderAmount?: boolean;
    includeExecuteProviderRouteId?: boolean;
    includeExecuteProviderReferrerWallet?: boolean;
    includeExecuteProviderPayoutWallet?: boolean;
    executeProviderNetwork?: string;
    executeProviderAsset?: string;
    executeProviderMerchantOrigin?: string;
    executeProviderOperationId?: string;
    executeProviderCampaignId?: string;
    executeProviderPayToWallet?: string;
    executeProviderAmountAtomic?: string;
    executeProviderRouteId?: string;
    executeProviderReferrerWallet?: string;
    executeProviderPayoutWallet?: string;
    amountPaidAtomic?: string;
    executeReferrerCreditAtomic?: string;
    lookupReceiptId?: string;
    lookupReferrerCreditAtomic?: string;
    lookupRequiredAmountAtomic?: string;
    lookupNetwork?: string;
    lookupAsset?: string;
    lookupMerchantOrigin?: string;
    lookupOperationId?: string;
    lookupCampaignId?: string;
    lookupPayToWallet?: string;
    lookupRouteId?: string;
    lookupReferrerWallet?: string;
    lookupPayoutWallet?: string;
    includeLookupReferrerWallet?: boolean;
    includeLookupPayoutWallet?: boolean;
    includeLookupRouteId?: boolean;
    includeLookupCommissionAmount?: boolean;
    lookupCommissionAmountAtomic?: string;
    includeLookupCommissionBps?: boolean;
    lookupCommissionBps?: number;
    includeLookupProtocolFeeBps?: boolean;
    lookupProtocolFeeBpsOfCommission?: number;
    lookupProtocolFeeAtomic?: string;
    tools?: string[];
  } = {},
): string {
  const includeExecute = options.includeExecute ?? true;
  const includeExecuteBudget = options.includeExecuteBudget ?? true;
  const includeReceiptLookup = options.includeReceiptLookup ?? true;
  const includeSearchBudget = options.includeSearchBudget ?? true;
  const searchMaxAmountAtomic = options.searchMaxAmountAtomic ?? "50000";
  const searchCapability = options.searchCapability ?? "solana.wallet-risk";
  const executeCapability = options.executeCapability ?? searchCapability;
  const includeSearchProviderId = options.includeSearchProviderId ?? true;
  const searchProviderId = options.searchProviderId ?? "split402-demo-merchant";
  const executeProviderId = options.executeProviderId ?? "split402-demo-merchant";
  const executeExecutionMode =
    options.executeExecutionMode ?? "router-live-agent-sdk";
  const executeMaxAmountAtomic =
    options.executeMaxAmountAtomic ?? searchMaxAmountAtomic;
  const amountPaidAtomic = options.amountPaidAtomic ?? "10000";
  const includeSearchProviderNetwork =
    options.includeSearchProviderNetwork ?? true;
  const includeSearchProviderAsset = options.includeSearchProviderAsset ?? true;
  const includeSearchProviderMerchantOrigin =
    options.includeSearchProviderMerchantOrigin ?? true;
  const includeSearchProviderOperationId =
    options.includeSearchProviderOperationId ?? true;
  const includeSearchProviderCampaignId =
    options.includeSearchProviderCampaignId ?? true;
  const includeSearchProviderPayToWallet =
    options.includeSearchProviderPayToWallet ?? true;
  const includeSearchProviderAmount = options.includeSearchProviderAmount ?? true;
  const includeSearchProviderRouteId =
    options.includeSearchProviderRouteId ?? true;
  const includeSearchProviderReferrerWallet =
    options.includeSearchProviderReferrerWallet ?? true;
  const includeSearchProviderPayoutWallet =
    options.includeSearchProviderPayoutWallet ?? true;
  const searchProviderNetwork =
    options.searchProviderNetwork ?? "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
  const searchProviderAsset = options.searchProviderAsset ?? "usdc-devnet";
  const searchProviderMerchantOrigin =
    options.searchProviderMerchantOrigin ?? "https://merchant.staging.example";
  const searchProviderOperationId =
    options.searchProviderOperationId ?? "wallet-risk-score";
  const searchProviderCampaignId =
    options.searchProviderCampaignId ?? "cmp_00000000000000000000000000000002";
  const searchProviderPayToWallet =
    options.searchProviderPayToWallet ?? "pay-to-wallet";
  const searchProviderAmountAtomic =
    options.searchProviderAmountAtomic ?? amountPaidAtomic;
  const searchProviderRouteId =
    options.searchProviderRouteId ?? "rte_00000000000000000000000000000003";
  const searchProviderReferrerWallet =
    options.searchProviderReferrerWallet ?? "referrer-wallet";
  const searchProviderPayoutWallet =
    options.searchProviderPayoutWallet ?? "payout-wallet";
  const includeExecuteProvider = options.includeExecuteProvider ?? true;
  const includeExecuteProviderId = options.includeExecuteProviderId ?? true;
  const includeExecuteProviderNetwork =
    options.includeExecuteProviderNetwork ?? true;
  const includeExecuteProviderAsset = options.includeExecuteProviderAsset ?? true;
  const includeExecuteProviderMerchantOrigin =
    options.includeExecuteProviderMerchantOrigin ?? true;
  const includeExecuteProviderOperationId =
    options.includeExecuteProviderOperationId ?? true;
  const includeExecuteProviderCampaignId =
    options.includeExecuteProviderCampaignId ?? true;
  const includeExecuteProviderPayToWallet =
    options.includeExecuteProviderPayToWallet ?? true;
  const includeExecuteProviderAmount = options.includeExecuteProviderAmount ?? true;
  const includeExecuteProviderRouteId =
    options.includeExecuteProviderRouteId ?? true;
  const includeExecuteProviderReferrerWallet =
    options.includeExecuteProviderReferrerWallet ?? true;
  const includeExecuteProviderPayoutWallet =
    options.includeExecuteProviderPayoutWallet ?? true;
  const executeProviderIdValue =
    options.executeProviderIdValue ?? executeProviderId;
  const executeProviderNetwork =
    options.executeProviderNetwork ?? searchProviderNetwork;
  const executeProviderAsset = options.executeProviderAsset ?? searchProviderAsset;
  const executeProviderMerchantOrigin =
    options.executeProviderMerchantOrigin ?? searchProviderMerchantOrigin;
  const executeProviderOperationId =
    options.executeProviderOperationId ?? searchProviderOperationId;
  const executeProviderCampaignId =
    options.executeProviderCampaignId ?? searchProviderCampaignId;
  const executeProviderPayToWallet =
    options.executeProviderPayToWallet ?? searchProviderPayToWallet;
  const executeProviderAmountAtomic =
    options.executeProviderAmountAtomic ?? searchProviderAmountAtomic;
  const executeProviderRouteId =
    options.executeProviderRouteId ?? searchProviderRouteId;
  const executeProviderReferrerWallet =
    options.executeProviderReferrerWallet ?? searchProviderReferrerWallet;
  const executeProviderPayoutWallet =
    options.executeProviderPayoutWallet ?? searchProviderPayoutWallet;
  const executeReferrerCreditAtomic =
    options.executeReferrerCreditAtomic ?? "1800";
  const tools = options.tools ?? [
    "split402.searchCapabilities",
    "split402.execute",
    "split402.getReceipt",
  ];
  const receiptId = "rcp_00000000000000000000000000000005";
  const lookupReceiptId = options.lookupReceiptId ?? receiptId;
  const lookupReferrerCreditAtomic =
    options.lookupReferrerCreditAtomic ?? executeReferrerCreditAtomic;
  const lookupRequiredAmountAtomic =
    options.lookupRequiredAmountAtomic ?? amountPaidAtomic;
  const lookupNetwork = options.lookupNetwork ?? searchProviderNetwork;
  const lookupAsset = options.lookupAsset ?? searchProviderAsset;
  const lookupMerchantOrigin =
    options.lookupMerchantOrigin ?? searchProviderMerchantOrigin;
  const lookupOperationId =
    options.lookupOperationId ?? searchProviderOperationId;
  const lookupCampaignId = options.lookupCampaignId ?? searchProviderCampaignId;
  const lookupPayToWallet =
    options.lookupPayToWallet ?? searchProviderPayToWallet;
  const lookupRouteId = options.lookupRouteId ?? searchProviderRouteId;
  const lookupReferrerWallet =
    options.lookupReferrerWallet ?? searchProviderReferrerWallet;
  const lookupPayoutWallet =
    options.lookupPayoutWallet ?? searchProviderPayoutWallet;
  const includeLookupRouteId = options.includeLookupRouteId ?? true;
  const includeLookupReferrerWallet =
    options.includeLookupReferrerWallet ?? true;
  const includeLookupPayoutWallet = options.includeLookupPayoutWallet ?? true;
  const includeLookupCommissionAmount =
    options.includeLookupCommissionAmount ?? true;
  const includeLookupCommissionBps = options.includeLookupCommissionBps ?? true;
  const lookupCommissionBps = options.lookupCommissionBps ?? 2000;
  const includeLookupProtocolFeeBps =
    options.includeLookupProtocolFeeBps ?? true;
  const lookupProtocolFeeBpsOfCommission =
    options.lookupProtocolFeeBpsOfCommission ?? 1000;
  const lookupProtocolFeeAtomic = options.lookupProtocolFeeAtomic ?? "200";
  const lookupCommissionAmountAtomic =
    options.lookupCommissionAmountAtomic ??
    (BigInt(lookupReferrerCreditAtomic) + BigInt(lookupProtocolFeeAtomic)).toString();
  const lines = [
    {
      direction: "request",
      message: { jsonrpc: "2.0", id: "initialize", method: "initialize" },
    },
    {
      direction: "response",
      message: {
        jsonrpc: "2.0",
        id: "initialize",
        result: { protocolVersion: "2024-11-05" },
      },
    },
    {
      direction: "request",
      message: { jsonrpc: "2.0", id: "tools", method: "tools/list" },
    },
    {
      direction: "response",
      message: {
        jsonrpc: "2.0",
        id: "tools",
        result: { tools: tools.map((name) => ({ name })) },
      },
    },
    {
      direction: "request",
      message: {
        jsonrpc: "2.0",
        id: "search",
        method: "tools/call",
        params: {
          name: "split402.searchCapabilities",
          arguments: {
            capability: searchCapability,
            ...(includeSearchBudget
              ? { budget: { maxAmountAtomic: searchMaxAmountAtomic } }
              : {}),
          },
        },
      },
    },
    {
      direction: "response",
      message: {
        jsonrpc: "2.0",
        id: "search",
        result: {
          structuredContent: {
            capabilities: [
              {
                ...(includeSearchProviderId ? { providerId: searchProviderId } : {}),
                ...(includeSearchProviderNetwork
                  ? { network: searchProviderNetwork }
                  : {}),
                ...(includeSearchProviderAsset ? { asset: searchProviderAsset } : {}),
                ...(includeSearchProviderMerchantOrigin
                  ? { merchantOrigin: searchProviderMerchantOrigin }
                  : {}),
                ...(includeSearchProviderOperationId
                  ? { operationId: searchProviderOperationId }
                  : {}),
                ...(includeSearchProviderCampaignId
                  ? { campaignId: searchProviderCampaignId }
                  : {}),
                ...(includeSearchProviderPayToWallet
                  ? { payToWallet: searchProviderPayToWallet }
                  : {}),
                ...(includeSearchProviderAmount
                  ? { amountAtomic: searchProviderAmountAtomic }
                  : {}),
                ...(includeSearchProviderRouteId
                  ? { routeId: searchProviderRouteId }
                  : {}),
                ...(includeSearchProviderReferrerWallet
                  ? { referrerWallet: searchProviderReferrerWallet }
                  : {}),
                ...(includeSearchProviderPayoutWallet
                  ? { payoutWallet: searchProviderPayoutWallet }
                  : {}),
              },
            ],
          },
        },
      },
    },
    ...(includeExecute
      ? [
          {
            direction: "request",
            message: {
              jsonrpc: "2.0",
              id: "execute",
              method: "tools/call",
              params: {
                name: "split402.execute",
                arguments: {
                  capability: executeCapability,
                  input: { wallet: "wallet-demo" },
                  ...(includeExecuteBudget
                    ? { budget: { maxAmountAtomic: executeMaxAmountAtomic } }
                    : {}),
                },
              },
            },
          },
          {
            direction: "response",
            message: {
              jsonrpc: "2.0",
              id: "execute",
              result: {
                structuredContent: {
                  providerId: executeProviderId,
                  executionMode: executeExecutionMode,
                  amountPaidAtomic,
                  receiptId,
                  receiptVerificationStatus: "verified",
                  referrerCreditAtomic: executeReferrerCreditAtomic,
                  ...(includeExecuteProvider
                    ? {
                        provider: {
                          ...(includeExecuteProviderId
                            ? { providerId: executeProviderIdValue }
                            : {}),
                          ...(includeExecuteProviderNetwork
                            ? { network: executeProviderNetwork }
                            : {}),
                          ...(includeExecuteProviderAsset
                            ? { asset: executeProviderAsset }
                            : {}),
                          ...(includeExecuteProviderMerchantOrigin
                            ? { merchantOrigin: executeProviderMerchantOrigin }
                            : {}),
                          ...(includeExecuteProviderOperationId
                            ? { operationId: executeProviderOperationId }
                            : {}),
                          ...(includeExecuteProviderCampaignId
                            ? { campaignId: executeProviderCampaignId }
                            : {}),
                          ...(includeExecuteProviderPayToWallet
                            ? { payToWallet: executeProviderPayToWallet }
                            : {}),
                          ...(includeExecuteProviderAmount
                            ? { amountAtomic: executeProviderAmountAtomic }
                            : {}),
                          ...(includeExecuteProviderRouteId
                            ? { routeId: executeProviderRouteId }
                            : {}),
                          ...(includeExecuteProviderReferrerWallet
                            ? { referrerWallet: executeProviderReferrerWallet }
                            : {}),
                          ...(includeExecuteProviderPayoutWallet
                            ? { payoutWallet: executeProviderPayoutWallet }
                            : {}),
                        },
                      }
                    : {}),
                },
              },
            },
          },
          ...(includeReceiptLookup
            ? [
                {
                  direction: "request",
                  message: {
                    jsonrpc: "2.0",
                    id: "receipt",
                    method: "tools/call",
                    params: {
                      name: "split402.getReceipt",
                      arguments: { receiptId },
                    },
                  },
                },
                {
                  direction: "response",
                  message: {
                    jsonrpc: "2.0",
                    id: "receipt",
                    result: {
                      structuredContent: {
                        receiptId,
                        receipt: {
                          receiptId: lookupReceiptId,
                          network: lookupNetwork,
                          asset: lookupAsset,
                          merchantOrigin: lookupMerchantOrigin,
                          operationId: lookupOperationId,
                          campaignId: lookupCampaignId,
                          payToWallet: lookupPayToWallet,
                          referrerCreditAtomic: lookupReferrerCreditAtomic,
                          requiredAmountAtomic: lookupRequiredAmountAtomic,
                          ...(includeLookupRouteId
                            ? { routeId: lookupRouteId }
                            : {}),
                          ...(includeLookupReferrerWallet
                            ? { referrerWallet: lookupReferrerWallet }
                            : {}),
                          ...(includeLookupPayoutWallet
                            ? { payoutWallet: lookupPayoutWallet }
                            : {}),
                          ...(includeLookupCommissionAmount
                            ? { commissionAmountAtomic: lookupCommissionAmountAtomic }
                            : {}),
                          ...(includeLookupCommissionBps
                            ? { commissionBps: lookupCommissionBps }
                            : {}),
                          ...(includeLookupProtocolFeeBps
                            ? {
                                protocolFeeBpsOfCommission:
                                  lookupProtocolFeeBpsOfCommission,
                              }
                            : {}),
                          protocolFeeAtomic: lookupProtocolFeeAtomic,
                        },
                      },
                    },
                  },
                },
              ]
            : []),
        ]
      : []),
  ];
  return `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
}

function encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function encodeUtf16Le(value: string): Uint8Array {
  return Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from(value, "utf16le"),
  ]);
}
