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
    gate: "custody_bundle_assembly",
    command: "corepack pnpm phase6:evidence:assemble",
    evidenceField: "review_id",
  },
  {
    gate: "custody_assembly_env_template",
    command:
      "corepack pnpm phase6:evidence:env-template split402-launch-evidence split402-launch-evidence/phase6-evidence.env",
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
    gate: "unknown_outcome_reconciliation",
    command: "corepack pnpm phase6:reconciliation-drill",
    evidenceField: "unknown_outcome_reconciliation_record",
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
    command:
      "corepack pnpm signer:payout:smoke && corepack pnpm phase6:signer-smoke",
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
  sourceCommitStatus: Phase6SourceCommitStatus;
  commands: typeof PHASE6_EVIDENCE_COMMANDS;
  validation?: Phase6CustodyReviewValidation;
  nextActions: string[];
}

export interface Phase6EvidenceStatusOptions {
  currentSourceCommit?: string;
}

export interface Phase6SourceCommitStatus {
  status: "not_checked" | "not_applicable" | "valid" | "invalid";
  evidenceSourceCommit?: string;
  currentSourceCommit?: string;
  blockers: string[];
}

export function createPhase6EvidenceStatusReport(
  evidenceText?: string,
  options: Phase6EvidenceStatusOptions = {},
): Phase6EvidenceStatusReport {
  const validation =
    evidenceText === undefined
      ? undefined
      : validatePhase6CustodyEvidence(evidenceText);
  const sourceCommitStatus = createSourceCommitStatus(evidenceText, options);
  const sourceCommitBlockers = sourceCommitStatus.blockers;

  return {
    schema: "split402.phase6_evidence_status.v1",
    readyForCustody:
      (validation?.approved ?? false) && sourceCommitBlockers.length === 0,
    evidenceBundleChecked: validation !== undefined,
    sourceCommitStatus,
    commands: PHASE6_EVIDENCE_COMMANDS,
    validation,
    nextActions: createNextActions(validation, sourceCommitBlockers),
  };
}

export function formatPhase6EvidenceStatusBrief(
  report: Phase6EvidenceStatusReport,
): string {
  const status = report.readyForCustody
    ? "ready"
    : report.evidenceBundleChecked
      ? "checked, blocked"
      : "not checked";
  const sourceCommit =
    report.sourceCommitStatus.status === "valid"
      ? "valid"
      : report.sourceCommitStatus.status;
  const validation = report.validation;
  const missingCount = validation?.missingFields.length ?? 0;
  const invalidCount = validation?.invalidFields.length ?? 0;
  const nextActions = report.nextActions
    .slice(0, 8)
    .map((action) => `- ${action}`);

  return [
    `Phase 6 custody evidence: ${status}`,
    `Source commit: ${sourceCommit}`,
    `Missing fields: ${missingCount}`,
    `Invalid fields: ${invalidCount}`,
    "Launch posture: production custody remains no-go until evidence is approved.",
    "",
    "Next actions:",
    ...(nextActions.length > 0 ? nextActions : ["- No next actions."]),
  ].join("\n");
}

function createNextActions(
  validation: Phase6CustodyReviewValidation | undefined,
  sourceCommitBlockers: readonly string[] = [],
): string[] {
  if (validation === undefined) {
    return [
      "Generate a bundle scaffold with corepack pnpm phase6:evidence:bundle.",
      "Review generated split402-launch-evidence/phase6-evidence.env before editing; regenerate only if missing with corepack pnpm phase6:evidence:env-template split402-launch-evidence split402-launch-evidence/phase6-evidence.env.",
      "Run each listed evidence command against staging outputs.",
      "Attach generated records to docs/templates/phase6-custody-evidence.txt copy.",
      "Run corepack pnpm phase6:evidence:status --brief <evidence-bundle.txt>.",
    ];
  }

  if (validation.approved) {
    return sourceCommitBlockers.length === 0
      ? ["Evidence bundle passes machine checks; proceed to human go/no-go review."]
      : [...sourceCommitBlockers];
  }

  const actions: string[] = [];
  if (validation.missingFields.length > 0) {
    actions.push(`Fill missing fields: ${validation.missingFields.join(", ")}`);
  }
  const placeholderFieldsToReplace = validation.placeholderFields.filter(
    (field) => field !== "approval_decision",
  );
  if (placeholderFieldsToReplace.length > 0) {
    actions.push(
      `Replace placeholder fields: ${placeholderFieldsToReplace.join(", ")}`,
    );
  }
  actions.push(...createOperatorInvalidFieldActions(validation.invalidFields));
  actions.push(...sourceCommitBlockers);
  return actions;
}

function createOperatorInvalidFieldActions(invalidFields: readonly string[]): string[] {
  return invalidFields.map((field) =>
    field === "approval_decision must be approved before Phase 6 custody can go live"
      ? "Keep approval_decision=no-go until all Phase 6 custody evidence fields and reviews are complete; set it to approved only during final human custody approval."
      : field,
  );
}

function createSourceCommitStatus(
  evidenceText: string | undefined,
  options: Phase6EvidenceStatusOptions,
): Phase6SourceCommitStatus {
  if (evidenceText === undefined) {
    return {
      status: "not_checked",
      blockers: [],
    };
  }

  const evidenceSourceCommit = readRecordField(evidenceText, "source_commit");
  const currentSourceCommit = options.currentSourceCommit?.trim();
  if (currentSourceCommit === undefined || currentSourceCommit.length === 0) {
    return {
      status: "not_applicable",
      ...(evidenceSourceCommit === undefined ? {} : { evidenceSourceCommit }),
      blockers: [],
    };
  }

  const blockers: string[] = [];
  if (evidenceSourceCommit === undefined || evidenceSourceCommit.length === 0) {
    blockers.push("source_commit is missing");
  } else if (!gitShasMatch(evidenceSourceCommit, currentSourceCommit)) {
    blockers.push("source_commit does not match current checkout");
  }

  if (!/^[0-9a-f]{7,40}$/iu.test(currentSourceCommit)) {
    blockers.push("current checkout source commit is not a git SHA");
  }

  return {
    status: blockers.length === 0 ? "valid" : "invalid",
    ...(evidenceSourceCommit === undefined ? {} : { evidenceSourceCommit }),
    currentSourceCommit,
    blockers,
  };
}

function readRecordField(text: string, fieldName: string): string | undefined {
  for (const line of text.split(/\r?\n/u)) {
    const match = /^([a-z][a-z0-9_]*):\s*(.*)$/u.exec(line);
    if (match?.[1] === fieldName) {
      return match[2]?.trim();
    }
  }
  return undefined;
}

function gitShasMatch(left: string, right: string): boolean {
  const normalizedLeft = left.trim().toLowerCase();
  const normalizedRight = right.trim().toLowerCase();
  if (
    !/^[0-9a-f]{7,40}$/u.test(normalizedLeft) ||
    !/^[0-9a-f]{7,40}$/u.test(normalizedRight)
  ) {
    return false;
  }
  return (
    normalizedLeft.startsWith(normalizedRight) ||
    normalizedRight.startsWith(normalizedLeft)
  );
}
