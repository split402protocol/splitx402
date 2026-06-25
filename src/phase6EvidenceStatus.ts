import {
  type Phase6CustodyReviewValidation,
  validatePhase6CustodyEvidence,
} from "./phase6CustodyReview.js";

export const PHASE6_EVIDENCE_COMMANDS = [
  {
    gate: "custody_bundle_scaffold",
    command: "corepack pnpm phase6:evidence:bundle",
    evidenceField: "review_id",
  },
  {
    gate: "signer_image_provenance",
    command: "corepack pnpm phase6:image-provenance",
    evidenceField: "signer_image_dependency_audit_output",
  },
  {
    gate: "signer_policy_review",
    command: "corepack pnpm phase6:signer-policy",
    evidenceField: "signer_policy_record",
  },
  {
    gate: "payout_signer_key_custody",
    command: "corepack pnpm phase6:key-custody",
    evidenceField: "key_custody_record",
  },
  {
    gate: "private_signer_networking",
    command: "corepack pnpm phase6:network-policy",
    evidenceField: "network_policy_record",
  },
  {
    gate: "emergency_auth_revocation",
    command: "corepack pnpm phase6:emergency-revocation",
    evidenceField: "emergency_revocation_drill_record",
  },
  {
    gate: "hmac_key_rotation",
    command: "corepack pnpm phase6:rotation-drill",
    evidenceField: "rotation_drill_record",
  },
  {
    gate: "rollback_drill",
    command: "corepack pnpm phase6:rollback-drill",
    evidenceField: "rollback_drill_record",
  },
  {
    gate: "incident_drill",
    command: "corepack pnpm phase6:incident-drill",
    evidenceField: "incident_drill_record",
  },
  {
    gate: "rpc_failover",
    command:
      "corepack pnpm payout:finality:failover-drill && corepack pnpm phase6:rpc-failover",
    evidenceField: "rpc_failover_record",
  },
  {
    gate: "signer_readiness_and_secret_exposure",
    command: "corepack pnpm signer:payout:smoke",
    evidenceField: "smoke_check_output",
  },
  {
    gate: "custody_bundle_approval",
    command: "corepack pnpm phase6:custody:check <evidence-bundle.txt>",
    evidenceField: "approval_decision",
  },
] as const;

export interface Phase6EvidenceStatusReport {
  schema: "split402.phase6_evidence_status.v1";
  readyForCustody: boolean;
  evidenceBundleChecked: boolean;
  commands: typeof PHASE6_EVIDENCE_COMMANDS;
  validation?: Phase6CustodyReviewValidation;
  nextActions: string[];
}

export function createPhase6EvidenceStatusReport(
  evidenceText?: string,
): Phase6EvidenceStatusReport {
  const validation =
    evidenceText === undefined
      ? undefined
      : validatePhase6CustodyEvidence(evidenceText);

  return {
    schema: "split402.phase6_evidence_status.v1",
    readyForCustody: validation?.approved ?? false,
    evidenceBundleChecked: validation !== undefined,
    commands: PHASE6_EVIDENCE_COMMANDS,
    validation,
    nextActions: createNextActions(validation),
  };
}

function createNextActions(
  validation: Phase6CustodyReviewValidation | undefined,
): string[] {
  if (validation === undefined) {
    return [
      "Generate a bundle scaffold with corepack pnpm phase6:evidence:bundle.",
      "Run each listed evidence command against staging outputs.",
      "Attach generated records to docs/templates/phase6-custody-evidence.txt copy.",
      "Run corepack pnpm phase6:evidence:status <evidence-bundle.txt>.",
    ];
  }

  if (validation.approved) {
    return ["Evidence bundle passes machine checks; proceed to human go/no-go review."];
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
