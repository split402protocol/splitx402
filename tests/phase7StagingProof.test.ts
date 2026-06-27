import { describe, expect, it } from "vitest";

import { createPhase7StagingArtifactManifest } from "../src/phase7StagingArtifactManifest.js";
import {
  createPhase7StagingProofRecord,
  validatePhase7StagingProof,
} from "../src/phase7StagingProof.js";
import {
  PHASE7_STAGING_COMMANDS,
  createPhase7StagingStatusReport,
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
      "agent_discovery_evidence must be an attached artifact or http(s) URL",
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
      "corepack pnpm phase7:staging:manifest <phase7-staging-proof.txt>",
    );
    expect(report.commands.map((item) => item.evidenceField)).toContain(
      "funding_balance_evidence",
    );
    expect(report.commands.map((item) => item.evidenceField)).toContain(
      "mcp_gateway_evidence",
    );
    expect(report.gateStatuses.every((item) => item.status === "not_checked")).toBe(
      true,
    );
    expect(report.nextActions).toContain(
      "Create the evidence workspace with corepack pnpm phase7:staging:init.",
    );
    expect(report.nextActions).toContain(
      "Generate a proof scaffold with corepack pnpm phase7:staging-proof.",
    );
    expect(report.nextActions).toContain(
      "Run the hosted staging preflight with corepack pnpm phase7:hosted:preflight.",
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
        "funding_balance_evidence must be an attached artifact or http(s) URL",
      ],
    });
    expect(report.gateStatuses).toContainEqual({
      gate: "mcp_bundle",
      evidenceField: "mcp_bundle_evidence",
      status: "missing",
      blockers: ["mcp_bundle_evidence is missing"],
    });
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
          checks: createPassingHostedPreflightChecks(),
        }),
      ),
    ],
    ["evidence/paid-suite.log", encode(createValidPaidSuiteLog())],
    [
      "evidence/receipt-verification.json",
      encode(
        JSON.stringify({
          receiptId: "rcp_001",
          verificationStatus: "verified",
          errors: [],
        }),
      ),
    ],
    [
      "evidence/agent-discovery.json",
      encode(
        JSON.stringify({
          routes: [
            {
              id: "rte_001",
              status: "active",
              campaignId: "cmp_001",
              referrerWallet: "referrer-wallet",
              payoutWallet: "payout-wallet",
            },
          ],
        }),
      ),
    ],
    [
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
                availableAmountAtomic: "1800",
                heldAmountAtomic: "0",
                inFlightAmountAtomic: "0",
                paidAmountAtomic: "0",
                totalEarnedAmountAtomic: "1800",
              },
            ],
          },
        }),
      ),
    ],
    [
      "evidence/dashboard-summary.json",
      encode(
        JSON.stringify({
          summary: {
            schema: "split402.merchant_dashboard_summary.v1",
            generatedAt: "2026-06-26T00:00:00.000Z",
            merchant: {
              id: "mrc_001",
              slug: "merchant",
              displayName: "Merchant",
              status: "active",
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
              activeCampaignIds: ["cmp_001"],
              operationCount: 1,
            },
            routes: {
              total: 1,
              byStatus: { active: 1, suspended: 0, expired: 0, revoked: 0 },
              activeRouteIds: ["rte_001"],
            },
          },
        }),
      ),
    ],
    [
      "evidence/webhook-events.json",
      encode(
        JSON.stringify({
          events: [
            {
              id: "evt_001",
              eventType: "webhook.receipt.accepted.v1",
              status: "delivered",
              attempts: 1,
              payload: { merchantId: "mrc_001" },
            },
          ],
        }),
      ),
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
    ["evidence/commands.log", encode("commands\n")],
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

function createValidPayoutObligations(): unknown {
  return {
    summary: {
      schema: "split402.merchant_obligation_summary.v1",
      merchantId: "mrc_001",
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

function createValidMcpGatewayTranscript(
  options: { includeReceiptLookup?: boolean } = {},
): string {
  const includeReceiptLookup = options.includeReceiptLookup ?? true;
  const receiptId = "rcp_00000000000000000000000000000005";
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
        result: { tools: [{ name: "split402.execute" }] },
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
          arguments: { capability: "solana.wallet-risk" },
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
            capabilities: [{ providerId: "split402-demo-merchant" }],
          },
        },
      },
    },
    {
      direction: "request",
      message: {
        jsonrpc: "2.0",
        id: "execute",
        method: "tools/call",
        params: {
          name: "split402.execute",
          arguments: {
            capability: "solana.wallet-risk",
            input: { wallet: "wallet-demo" },
            budget: { maxAmountAtomic: "50000" },
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
            providerId: "split402-demo-merchant",
            amountPaidAtomic: "10000",
            receiptId,
            receiptVerificationStatus: "verified",
            referrerCreditAtomic: "1800",
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
                    receiptId,
                    referrerCreditAtomic: "1800",
                  },
                },
              },
            },
          },
        ]
      : []),
  ];
  return `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
}

function encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}
