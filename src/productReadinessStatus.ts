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
  launchDecision: "go" | "no-go";
  readyForPublicAlphaDemo: boolean;
  readyForProductionCustody: boolean;
  readyForMainnet: boolean;
  phase6: Phase6EvidenceStatusReport;
  phase7: Phase7StagingStatusReport;
  nextActions: string[];
  summary: string;
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
  const nextActions = createProductNextActions(phase6, phase7);

  return {
    schema: "split402.product_readiness_status.v1",
    product: "Split402",
    repository: "split402protocol/splitx402",
    currentPhase: "Phase 7 public-alpha staging and Phase 6 custody evidence",
    implementationState: "public-alpha foundation implemented",
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

function createProductNextActions(
  phase6: Phase6EvidenceStatusReport,
  phase7: Phase7StagingStatusReport,
): string[] {
  const actions: string[] = [];

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
