import {
  type Phase6EvidenceStatusReport,
  createPhase6EvidenceStatusReport,
} from "./phase6EvidenceStatus.js";
import {
  type Phase7StagingStatusOptions,
  type Phase7StagingStatusReport,
  createPhase7StagingStatusReport,
} from "./phase7StagingStatus.js";

export interface Split402ProductReadinessInput {
  phase6EvidenceText?: string;
  phase7ProofText?: string;
  phase7Options?: Phase7StagingStatusOptions;
}

export interface Split402ProductReadinessReport {
  schema: "split402.product_readiness_status.v1";
  product: "Split402";
  repository: "split402protocol/splitx402";
  currentPhase: "Phase 7 public-alpha staging and Phase 6 custody evidence";
  implementationState: "public-alpha foundation implemented";
  readiness: Split402ProductReadinessProgress;
  launchDecision: "go" | "no-go";
  readyForPublicAlphaDemo: boolean;
  readyForProductionCustody: boolean;
  readyForMainnet: boolean;
  phase6: Phase6EvidenceStatusReport;
  phase7: Phase7StagingStatusReport;
  nextActions: string[];
  summary: string;
}

export interface Split402ProductReadinessProgress {
  totalLaunchGates: 2;
  checkedLaunchGates: number;
  readyLaunchGates: number;
  checkedLaunchGatePercent: number;
  readyLaunchGatePercent: number;
  gates: [
    {
      gate: "phase7_public_alpha_demo";
      label: "Phase 7 hosted public-alpha proof";
      checked: boolean;
      ready: boolean;
    },
    {
      gate: "phase6_production_custody";
      label: "Phase 6 production custody evidence";
      checked: boolean;
      ready: boolean;
    },
  ];
}

export function createSplit402ProductReadinessReport(
  input: Split402ProductReadinessInput = {},
): Split402ProductReadinessReport {
  const phase6 = createPhase6EvidenceStatusReport(input.phase6EvidenceText);
  const phase7 = createPhase7StagingStatusReport(
    input.phase7ProofText,
    input.phase7Options,
  );
  const readyForPublicAlphaDemo = phase7.readyForPublicAlphaDemo;
  const readyForProductionCustody = phase6.readyForCustody;
  const readyForMainnet = false;
  const launchDecision =
    readyForPublicAlphaDemo && readyForProductionCustody ? "go" : "no-go";
  const readiness = createReadinessProgress(phase6, phase7);
  const nextActions = createProductNextActions(phase6, phase7);

  return {
    schema: "split402.product_readiness_status.v1",
    product: "Split402",
    repository: "split402protocol/splitx402",
    currentPhase: "Phase 7 public-alpha staging and Phase 6 custody evidence",
    implementationState: "public-alpha foundation implemented",
    readiness,
    launchDecision,
    readyForPublicAlphaDemo,
    readyForProductionCustody,
    readyForMainnet,
    phase6,
    phase7,
    nextActions,
    summary: createSummary({
      readyForPublicAlphaDemo,
      readyForProductionCustody,
      phase6Checked: phase6.evidenceBundleChecked,
      phase7Checked: phase7.proofChecked,
    }),
  };
}

export function formatSplit402ProductReadinessBrief(
  report: Split402ProductReadinessReport,
): string {
  const gateLines = report.readiness.gates.map((gate) => {
    const status = gate.ready
      ? "ready"
      : gate.checked
        ? "checked, blocked"
        : "not checked";
    return `- ${gate.label}: ${status}`;
  });
  const nextActions = report.nextActions.slice(0, 5).map((action) => `- ${action}`);

  return [
    `Split402 status: ${report.launchDecision}`,
    `Phase: ${report.currentPhase}`,
    `Implementation: ${report.implementationState}`,
    `Launch gates ready: ${report.readiness.readyLaunchGates}/${report.readiness.totalLaunchGates} (${report.readiness.readyLaunchGatePercent}%)`,
    `Launch gates checked: ${report.readiness.checkedLaunchGates}/${report.readiness.totalLaunchGates} (${report.readiness.checkedLaunchGatePercent}%)`,
    `Mainnet ready: ${report.readyForMainnet ? "yes" : "no"}`,
    report.summary,
    "",
    "Gate status:",
    ...gateLines,
    "",
    "Next actions:",
    ...(nextActions.length > 0 ? nextActions : ["- No machine-generated next actions."]),
  ].join("\n");
}

function createReadinessProgress(
  phase6: Phase6EvidenceStatusReport,
  phase7: Phase7StagingStatusReport,
): Split402ProductReadinessProgress {
  const gates: Split402ProductReadinessProgress["gates"] = [
    {
      gate: "phase7_public_alpha_demo",
      label: "Phase 7 hosted public-alpha proof",
      checked: phase7.proofChecked,
      ready: phase7.readyForPublicAlphaDemo,
    },
    {
      gate: "phase6_production_custody",
      label: "Phase 6 production custody evidence",
      checked: phase6.evidenceBundleChecked,
      ready: phase6.readyForCustody,
    },
  ];
  const totalLaunchGates = 2;
  const checkedLaunchGates = gates.filter((gate) => gate.checked).length;
  const readyLaunchGates = gates.filter((gate) => gate.ready).length;

  return {
    totalLaunchGates,
    checkedLaunchGates,
    readyLaunchGates,
    checkedLaunchGatePercent: Math.round(
      (checkedLaunchGates / totalLaunchGates) * 100,
    ),
    readyLaunchGatePercent: Math.round(
      (readyLaunchGates / totalLaunchGates) * 100,
    ),
    gates,
  };
}

function createProductNextActions(
  phase6: Phase6EvidenceStatusReport,
  phase7: Phase7StagingStatusReport,
): string[] {
  const actions: string[] = [];

  if (!phase7.proofChecked && !phase6.evidenceBundleChecked) {
    return [
      "Create a combined launch evidence workspace with corepack pnpm product:evidence:init.",
      "Fill split402-launch-evidence/phase7-staging.env with hosted staging values.",
      "Fill split402-launch-evidence/phase6-custody-evidence.txt with generated Phase 6 custody records.",
      "Run hosted Phase 7 staging proof collection and status validation.",
      "Run corepack pnpm product:status --brief split402-launch-evidence/phase6-custody-evidence.txt split402-launch-evidence/phase7-staging-proof.txt.",
    ];
  }

  if (!phase7.readyForPublicAlphaDemo) {
    actions.push(
      phase7.proofChecked
        ? "Fix Phase 7 hosted proof blockers reported by corepack pnpm phase7:staging:status."
        : "Run hosted Phase 7 staging proof collection and status validation.",
    );
    actions.push(...phase7.nextActions.slice(0, 5));
  }

  if (!phase6.readyForCustody) {
    actions.push(
      phase6.evidenceBundleChecked
        ? "Fix Phase 6 custody evidence blockers reported by corepack pnpm phase6:evidence:status."
        : "Generate and assemble the Phase 6 custody evidence bundle.",
    );
    actions.push(...phase6.nextActions.slice(0, 5));
  }

  return [...new Set(actions)];
}

function createSummary(input: {
  readyForPublicAlphaDemo: boolean;
  readyForProductionCustody: boolean;
  phase6Checked: boolean;
  phase7Checked: boolean;
}): string {
  if (input.readyForPublicAlphaDemo && input.readyForProductionCustody) {
    return "Split402 machine-checkable public-alpha demo and production custody gates are ready for human launch review. Mainnet approval remains outside this local status command.";
  }

  const unchecked: string[] = [];
  if (!input.phase7Checked) {
    unchecked.push("Phase 7 hosted proof");
  }
  if (!input.phase6Checked) {
    unchecked.push("Phase 6 custody evidence");
  }

  const blocked: string[] = [];
  if (!input.readyForPublicAlphaDemo) {
    blocked.push("public-alpha demo approval");
  }
  if (!input.readyForProductionCustody) {
    blocked.push("production payout custody");
  }

  const uncheckedText =
    unchecked.length > 0 ? ` Missing checked evidence: ${unchecked.join(", ")}.` : "";

  return `Split402 has a public-alpha implementation foundation, but launch remains no-go for ${blocked.join(
    " and ",
  )}.${uncheckedText}`;
}
