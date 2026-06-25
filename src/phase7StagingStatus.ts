import {
  type Phase7StagingProofValidation,
  validatePhase7StagingProof,
} from "./phase7StagingProof.js";

export const PHASE7_STAGING_COMMANDS = [
  {
    gate: "proof_scaffold",
    command: "corepack pnpm phase7:staging-proof",
    evidenceField: "proof_id",
  },
  {
    gate: "dashboard_smoke",
    command: "corepack pnpm dashboard",
    evidenceField: "dashboard_url",
  },
  {
    gate: "mcp_bundle",
    command: "corepack pnpm demo:mcp-bundle",
    evidenceField: "mcp_bundle_evidence",
  },
  {
    gate: "agent_paid_suite",
    command: "corepack pnpm demo:paid-suite",
    evidenceField: "paid_request_evidence",
  },
  {
    gate: "control_plane_reads",
    command:
      "curl the Phase 7 control-plane read APIs from docs/PHASE_7.md and attach responses",
    evidenceField: "dashboard_summary_evidence",
  },
  {
    gate: "proof_validation",
    command: "corepack pnpm phase7:staging:status <phase7-staging-proof.txt>",
    evidenceField: "approval_decision",
  },
] as const;

export interface Phase7StagingStatusReport {
  schema: "split402.phase7_staging_status.v1";
  readyForPublicAlphaDemo: boolean;
  proofChecked: boolean;
  commands: typeof PHASE7_STAGING_COMMANDS;
  validation?: Phase7StagingProofValidation;
  nextActions: string[];
}

export function createPhase7StagingStatusReport(
  proofText?: string,
): Phase7StagingStatusReport {
  const validation =
    proofText === undefined ? undefined : validatePhase7StagingProof(proofText);

  return {
    schema: "split402.phase7_staging_status.v1",
    readyForPublicAlphaDemo: validation?.approved ?? false,
    proofChecked: validation !== undefined,
    commands: PHASE7_STAGING_COMMANDS,
    validation,
    nextActions: createNextActions(validation),
  };
}

function createNextActions(
  validation: Phase7StagingProofValidation | undefined,
): string[] {
  if (validation === undefined) {
    return [
      "Generate a proof scaffold with corepack pnpm phase7:staging-proof.",
      "Run the dashboard, MCP bundle, paid-suite, and control-plane read checks against staging.",
      "Attach response URLs, logs, or artifact paths to the proof record.",
      "Run corepack pnpm phase7:staging:status <phase7-staging-proof.txt>.",
    ];
  }

  if (validation.approved) {
    return ["Phase 7 staging proof passes machine checks; proceed to launch review."];
  }

  const actions: string[] = [];
  if (validation.missingFields.length > 0) {
    actions.push(`Fill missing fields: ${validation.missingFields.join(", ")}`);
  }
  if (validation.placeholderFields.length > 0) {
    actions.push(
      `Replace placeholder fields: ${validation.placeholderFields.join(", ")}`,
    );
  }
  actions.push(...validation.invalidFields);
  return actions;
}
