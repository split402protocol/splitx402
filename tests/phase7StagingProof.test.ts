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
        agent_discovery_evidence: "https://artifacts.example/discovery.json",
        paid_request_evidence: "attached: paid-suite.log",
        receipt_verification_evidence: "attached: receipt-verification.json",
        referrer_balance_evidence: "attached: referrer-balances.json",
        dashboard_summary_evidence: "attached: dashboard-summary.json",
        webhook_delivery_evidence: "attached: webhook-events.json",
        payout_obligation_evidence: "attached: payout-obligations.json",
        funding_balance_evidence: "attached: missing-funding-balance.json",
        mcp_bundle_evidence: "attached: mcp-bundle.json",
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
      reference: "https://artifacts.example/discovery.json",
      status: "remote",
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
    expect(report.fundingBalanceStatus).toEqual({
      status: "valid",
      blockers: [],
    });
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
    agent_discovery_evidence: "https://artifacts.example/discovery.json",
    paid_request_evidence: "attached: paid-suite.log",
    receipt_verification_evidence: "https://artifacts.example/receipt.json",
    referrer_balance_evidence: "https://artifacts.example/balances.json",
    dashboard_summary_evidence: "https://artifacts.example/dashboard.json",
    webhook_delivery_evidence: "https://artifacts.example/webhooks.json",
    payout_obligation_evidence: "https://artifacts.example/obligations.json",
    funding_balance_evidence: "attached: funding-balance.json",
    mcp_bundle_evidence: "https://artifacts.example/mcp.json",
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
    ["evidence/paid-suite.log", encode("paid proof\n")],
    [
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
                fundingStatus: "covered",
                fundingAmountAtomic: "1000",
                fundingDeficitAtomic: "0",
                pendingAmountAtomic: "0",
                availableAmountAtomic: "1000",
                heldAmountAtomic: "0",
                inFlightAmountAtomic: "0",
                paidAmountAtomic: "0",
                outstandingAmountAtomic: "1000",
                totalAccruedAmountAtomic: "1000",
                accrualCount: 1,
                pendingAccrualCount: 0,
                availableAccrualCount: 1,
                heldAccrualCount: 0,
                inFlightAccrualCount: 0,
                paidAccrualCount: 0,
              },
            ],
          },
        }),
      ),
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

function encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}
