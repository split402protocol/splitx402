import {
  type Phase6EvidenceStatusOptions,
  type Phase6EvidenceStatusReport,
  createPhase6EvidenceStatusReport,
} from "./phase6EvidenceStatus.js";
import {
  type Phase7StagingStatusOptions,
  type Phase7StagingStatusReport,
  createPhase7StagingStatusReport,
} from "./phase7StagingStatus.js";
import {
  LOCAL_PUBLIC_ALPHA_PROOF_CHECKS,
  type Split402LocalProofReport,
} from "./productLocalProof.js";

export interface Split402ProductReadinessInput {
  localProofText?: string;
  phase6EvidenceText?: string;
  phase6Options?: Phase6EvidenceStatusOptions;
  phase7ProofText?: string;
  phase7Options?: Phase7StagingStatusOptions;
}

export interface Split402LocalProofStatus {
  checked: boolean;
  ready: boolean;
  status: "not_checked" | "passed" | "failed";
  generatedAt?: string;
  blockers: string[];
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
  localProof: Split402LocalProofStatus;
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
  const localProof = createLocalProofStatus(input.localProofText);
  const phase6 = createPhase6EvidenceStatusReport(
    input.phase6EvidenceText,
    input.phase6Options,
  );
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
  const nextActions = createProductNextActions(phase6, phase7, localProof);

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
    localProof,
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
  const localProofLine = report.localProof.ready
    ? "- Local public-alpha proof: ready"
    : report.localProof.checked
      ? "- Local public-alpha proof: checked, blocked"
      : "- Local public-alpha proof: not checked";
  const gateLines = report.readiness.gates.map((gate) => {
    const status = gate.ready
      ? "ready"
      : gate.checked
        ? "checked, blocked"
        : "not checked";
    return `- ${gate.label}: ${status}`;
  });
  const nextActions = report.nextActions.slice(0, 6).map((action) => `- ${action}`);

  return [
    `Split402 status: ${report.launchDecision}`,
    `Phase: ${report.currentPhase}`,
    `Implementation: ${report.implementationState}`,
    `Launch gates ready: ${report.readiness.readyLaunchGates}/${report.readiness.totalLaunchGates} (${report.readiness.readyLaunchGatePercent}%)`,
    `Launch gates checked: ${report.readiness.checkedLaunchGates}/${report.readiness.totalLaunchGates} (${report.readiness.checkedLaunchGatePercent}%)`,
    `Mainnet ready: ${report.readyForMainnet ? "yes" : "no"}`,
    localProofLine,
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
  localProof?: Split402LocalProofStatus,
): string[] {
  const leadActions: string[] = [];
  const phase7DetailActions: string[] = [];
  const phase6DetailActions: string[] = [];
  if (localProof?.ready !== true) {
    leadActions.push(
      "Run corepack pnpm product:local-proof --brief --output split402-launch-evidence/local-public-alpha-proof.json.",
    );
    if (localProof?.checked === true) {
      leadActions.push(...localProof.blockers);
    }
  }
  if (
    hasStaleSourceCommit(phase7.sourceCommitStatus) ||
    hasStaleSourceCommit(phase6.sourceCommitStatus)
  ) {
    leadActions.push(
      "Run corepack pnpm product:evidence:init --refresh-source before collecting evidence, or recollect evidence from the current checkout if real artifacts already exist.",
    );
  }

  if (!phase7.proofChecked && !phase6.evidenceBundleChecked) {
    return [
      "Create a combined launch evidence workspace with corepack pnpm product:evidence:init.",
      "Run corepack pnpm product:launch-preflight --brief --workspace split402-launch-evidence and follow its next action.",
      ...leadActions,
      "Fill the generated Phase 7 and Phase 6 env files with hosted staging and custody evidence values.",
      "Collect Phase 7 hosted proof and Phase 6 custody evidence from the same deployed environment and source commit.",
      "Run hosted Phase 7 staging proof collection and status validation.",
      "Run corepack pnpm product:status --brief --workspace split402-launch-evidence.",
    ];
  }

  if (!phase7.readyForPublicAlphaDemo) {
    leadActions.push(
      phase7.proofChecked
        ? "Fix Phase 7 hosted proof blockers reported by corepack pnpm phase7:staging:status --brief."
        : "Run corepack pnpm product:launch-preflight --brief --workspace split402-launch-evidence before collecting hosted proof.",
    );
    phase7DetailActions.push(...phase7.nextActions.slice(0, 5));
  }

  if (!phase6.readyForCustody) {
    leadActions.push(
      phase6.evidenceBundleChecked
        ? "Fix Phase 6 custody evidence blockers reported by corepack pnpm phase6:evidence:status --brief."
        : "Generate and assemble the Phase 6 custody evidence bundle.",
    );
    phase6DetailActions.push(...phase6.nextActions.slice(0, 5));
  }

  return [
    ...new Set([
      ...leadActions,
      ...interleaveActions(phase7DetailActions, phase6DetailActions),
    ]),
  ];
}

function createLocalProofStatus(
  localProofText: string | undefined,
): Split402LocalProofStatus {
  if (localProofText === undefined || localProofText.trim().length === 0) {
    return {
      checked: false,
      ready: false,
      status: "not_checked",
      blockers: ["Run product:local-proof and save local-public-alpha-proof.json."],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(localProofText);
  } catch (error) {
    return {
      checked: true,
      ready: false,
      status: "failed",
      blockers: [
        `local-public-alpha-proof.json is not valid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
    };
  }

  const report = parsed as Partial<Split402LocalProofReport>;
  const blockers: string[] = [];
  if (report.schema !== "split402.local_public_alpha_proof.v1") {
    blockers.push("local proof schema is not split402.local_public_alpha_proof.v1");
  }
  if (report.status !== "passed") {
    blockers.push("local proof status is not passed");
  }
  if (report.launchApproval !== "not_approved") {
    blockers.push("local proof must not claim launch approval");
  }
  if (!Array.isArray(report.checks) || report.checks.length === 0) {
    blockers.push("local proof checks are missing");
  } else {
    const failedChecks = report.checks.filter((check) => check.status !== "passed");
    if (failedChecks.length > 0) {
      blockers.push(
        `local proof failed checks: ${failedChecks
          .map((check) => check.id)
          .join(", ")}`,
      );
    }
    const actualCheckIds = new Set(report.checks.map((check) => check.id));
    const missingCurrentChecks = LOCAL_PUBLIC_ALPHA_PROOF_CHECKS.filter(
      (check) => !actualCheckIds.has(check.id),
    ).map((check) => check.id);
    if (missingCurrentChecks.length > 0) {
      blockers.push(
        `local proof is stale; rerun product:local-proof because it is missing current checks: ${missingCurrentChecks.join(
          ", ",
        )}`,
      );
    }
  }

  return {
    checked: true,
    ready: blockers.length === 0,
    status: blockers.length === 0 ? "passed" : "failed",
    ...(typeof report.generatedAt === "string"
      ? { generatedAt: report.generatedAt }
      : {}),
    blockers,
  };
}

function hasStaleSourceCommit(input: { blockers: readonly string[] }): boolean {
  return input.blockers.includes("source_commit does not match current checkout");
}

function interleaveActions(left: readonly string[], right: readonly string[]): string[] {
  const actions: string[] = [];
  const maxLength = Math.max(left.length, right.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftAction = left[index];
    if (leftAction !== undefined) {
      actions.push(leftAction);
    }
    const rightAction = right[index];
    if (rightAction !== undefined) {
      actions.push(rightAction);
    }
  }
  return actions;
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
