import { describe, expect, it } from "vitest";

import {
  createSplit402MainnetCanaryReport,
  formatSplit402MainnetCanaryBrief,
  MAINNET_CANARY_CONFIRMATION,
  MAINNET_CANARY_NON_ATOMIC_ACKNOWLEDGEMENT,
} from "../src/mainnetCanaryPlan.js";
import type { Split402ProductReadinessReport } from "../src/productReadinessStatus.js";

describe("Split402 mainnet canary plan", () => {
  it("fails closed when launch gates and canary controls are missing", () => {
    const report = createSplit402MainnetCanaryReport({
      productReadiness: createProductReadinessReport({
        launchDecision: "no-go",
        readyLaunchGates: 0,
      }),
    });

    expect(report).toMatchObject({
      schema: "split402.mainnet_canary_plan.v1",
      product: "Split402",
      repository: "split402protocol/splitx402",
      readyForMainnetCanary: false,
      readyForProductionMainnet: false,
      maxAllowedGrossAmountAtomic: "100000",
    });
    expect(report.checks.find((check) => check.id === "launch_gates_ready"))
      .toMatchObject({
        ok: false,
        severity: "required",
      });
    expect(report.nextActions.join("\n")).toContain(
      "Do not broadcast mainnet payment or payout transactions",
    );
    expect(formatSplit402MainnetCanaryBrief(report)).toContain(
      "Split402 mainnet canary: no-go",
    );
  });

  it("keeps production mainnet false even when a tiny canary is ready", () => {
    const report = createSplit402MainnetCanaryReport({
      productReadiness: createProductReadinessReport({
        launchDecision: "go",
        readyLaunchGates: 3,
      }),
      operatorConfirmation: MAINNET_CANARY_CONFIRMATION,
      nonAtomicAcknowledgement: MAINNET_CANARY_NON_ATOMIC_ACKNOWLEDGEMENT,
      network: "solana:mainnet",
      maxGrossAmountAtomic: "100000",
      merchantId: "mrc_123",
      campaignId: "cmp_123",
      routeId: "rte_123",
      canaryWallet: "payer-wallet",
      dryRunEvidence: "attached: mainnet-canary-dry-run.txt",
      rollbackPlan: "attached: mainnet-canary-rollback.txt",
      reviewDecision: "approved",
    });

    expect(report.readyForMainnetCanary).toBe(true);
    expect(report.readyForProductionMainnet).toBe(false);
    expect(report.checks.every((check) => check.ok)).toBe(true);
    expect(report.nextActions).toContain(
      "Run the canary manually using the approved one-merchant, one-route, one-wallet scope.",
    );
    expect(formatSplit402MainnetCanaryBrief(report)).toContain(
      "Production mainnet ready: no",
    );
  });

  it("rejects canary amounts above the cap", () => {
    const report = createSplit402MainnetCanaryReport({
      productReadiness: createProductReadinessReport({
        launchDecision: "go",
        readyLaunchGates: 3,
      }),
      operatorConfirmation: MAINNET_CANARY_CONFIRMATION,
      nonAtomicAcknowledgement: MAINNET_CANARY_NON_ATOMIC_ACKNOWLEDGEMENT,
      network: "solana:mainnet",
      maxGrossAmountAtomic: "100001",
      merchantId: "mrc_123",
      campaignId: "cmp_123",
      routeId: "rte_123",
      canaryWallet: "payer-wallet",
      dryRunEvidence: "attached: mainnet-canary-dry-run.txt",
      rollbackPlan: "attached: mainnet-canary-rollback.txt",
      reviewDecision: "approved",
    });

    expect(report.readyForMainnetCanary).toBe(false);
    expect(report.checks.find((check) => check.id === "amount_cap"))
      .toMatchObject({
        ok: false,
        details: [
          "Set SPLIT402_MAINNET_CANARY_MAX_GROSS_AMOUNT_ATOMIC to a positive integer no greater than 100000.",
        ],
      });
  });

  it("rejects placeholder dry-run evidence", () => {
    const report = createSplit402MainnetCanaryReport({
      productReadiness: createProductReadinessReport({
        launchDecision: "go",
        readyLaunchGates: 3,
      }),
      operatorConfirmation: MAINNET_CANARY_CONFIRMATION,
      nonAtomicAcknowledgement: MAINNET_CANARY_NON_ATOMIC_ACKNOWLEDGEMENT,
      network: "solana:mainnet",
      maxGrossAmountAtomic: "100000",
      merchantId: "mrc_123",
      campaignId: "cmp_123",
      routeId: "rte_123",
      canaryWallet: "payer-wallet",
      dryRunEvidence: "attached: <dry-run evidence>",
      rollbackPlan: "attached: mainnet-canary-rollback.txt",
      reviewDecision: "approved",
    });

    expect(report.readyForMainnetCanary).toBe(false);
    expect(report.checks.find((check) => check.id === "dry_run_evidence"))
      .toMatchObject({
        ok: false,
      });
  });

  it("surfaces attached dry-run evidence verification errors", () => {
    const report = createSplit402MainnetCanaryReport({
      productReadiness: createProductReadinessReport({
        launchDecision: "go",
        readyLaunchGates: 3,
      }),
      operatorConfirmation: MAINNET_CANARY_CONFIRMATION,
      nonAtomicAcknowledgement: MAINNET_CANARY_NON_ATOMIC_ACKNOWLEDGEMENT,
      network: "solana:mainnet",
      maxGrossAmountAtomic: "100000",
      merchantId: "mrc_123",
      campaignId: "cmp_123",
      routeId: "rte_123",
      canaryWallet: "payer-wallet",
      dryRunEvidence: "attached: mainnet-canary-dry-run.txt",
      dryRunEvidenceVerification: {
        ok: false,
        errors: ["dry_run_status must be passed"],
        path: "split402-launch-evidence/mainnet-canary-dry-run.txt",
      },
      rollbackPlan: "attached: mainnet-canary-rollback-plan.txt",
      reviewDecision: "approved",
    });

    expect(report.readyForMainnetCanary).toBe(false);
    expect(report.checks.find((check) => check.id === "dry_run_evidence"))
      .toMatchObject({
        ok: false,
        details: [
          "SPLIT402_MAINNET_CANARY_DRY_RUN_EVIDENCE: dry_run_status must be passed",
        ],
      });
    expect(report.nextActions).toContain(
      "Fix SPLIT402_MAINNET_CANARY_DRY_RUN_EVIDENCE dry-run artifact: resolve dry_run_status must be passed.",
    );
    expect(report.nextActions).not.toContain(
      "SPLIT402_MAINNET_CANARY_DRY_RUN_EVIDENCE: dry_run_status must be passed",
    );
  });

  it("requires acknowledgement that mainnet canary is not atomic splitting", () => {
    const report = createSplit402MainnetCanaryReport({
      productReadiness: createProductReadinessReport({
        launchDecision: "go",
        readyLaunchGates: 3,
      }),
      operatorConfirmation: MAINNET_CANARY_CONFIRMATION,
      network: "solana:mainnet",
      maxGrossAmountAtomic: "100000",
      merchantId: "mrc_123",
      campaignId: "cmp_123",
      routeId: "rte_123",
      canaryWallet: "payer-wallet",
      dryRunEvidence: "attached: mainnet-canary-dry-run.txt",
      rollbackPlan: "attached: mainnet-canary-rollback.txt",
      reviewDecision: "approved",
    });

    expect(report.readyForMainnetCanary).toBe(false);
    expect(report.checks.find((check) => check.id === "non_atomic_acknowledgement"))
      .toMatchObject({
        ok: false,
      });
    expect(report.notes).toContain(
      "The canary validates referral accounting plus later payout. It is not an atomic on-chain splitter.",
    );
  });
});

function createProductReadinessReport(input: {
  launchDecision: "go" | "no-go";
  readyLaunchGates: number;
}): Split402ProductReadinessReport {
  return {
    schema: "split402.product_readiness_status.v1",
    product: "Split402",
    repository: "split402protocol/splitx402",
    currentPhase: "Phase 7 public-alpha staging and Phase 6 custody evidence",
    implementationState: "public-alpha foundation implemented",
    readiness: {
      totalLaunchGates: 3,
      checkedLaunchGates: 3,
      readyLaunchGates: input.readyLaunchGates,
      checkedLaunchGatePercent: 100,
      readyLaunchGatePercent: Math.round((input.readyLaunchGates / 3) * 100),
      gates: [
        {
          gate: "public_boundary_review",
          label: "GitHub public/private and license review",
          checked: true,
          ready: input.readyLaunchGates >= 1,
        },
        {
          gate: "phase7_public_alpha_demo",
          label: "Phase 7 hosted public-alpha proof",
          checked: true,
          ready: input.readyLaunchGates >= 2,
        },
        {
          gate: "phase6_production_custody",
          label: "Phase 6 production custody evidence",
          checked: true,
          ready: input.readyLaunchGates >= 3,
        },
      ],
    },
    launchDecision: input.launchDecision,
    readyForPublicBoundary: input.readyLaunchGates >= 1,
    readyForPublicAlphaDemo: input.readyLaunchGates >= 2,
    readyForProductionCustody: input.readyLaunchGates >= 3,
    readyForMainnet: false,
    githubSettingsReview: {
      checked: true,
      ready: input.readyLaunchGates >= 1,
      status: input.readyLaunchGates >= 1 ? "approved" : "failed",
      blockers: [],
    },
    localProof: {
      checked: true,
      ready: true,
      status: "passed",
      blockers: [],
    },
    phase6: {
      schema: "split402.phase6_evidence_status.v1",
      evidenceBundleChecked: true,
      readyForCustody: input.readyLaunchGates >= 3,
      sourceCommitStatus: { status: "valid", blockers: [] },
      nextActions: [],
    },
    phase7: {
      schema: "split402.phase7_staging_status.v1",
      proofChecked: true,
      readyForPublicAlphaDemo: input.readyLaunchGates >= 2,
      sourceCommitStatus: { status: "valid", blockers: [] },
      commandEvidenceStatus: { status: "not_checked", blockers: [] },
      nextActions: [],
    },
    nextActions: [],
    summary: "",
  } as unknown as Split402ProductReadinessReport;
}
