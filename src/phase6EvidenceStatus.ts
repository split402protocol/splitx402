import { isAbsolute, join } from "node:path";

import {
  PHASE6_CUSTODY_ATTACHMENT_FIELDS,
  type Phase6CustodyRequiredField,
  type Phase6CustodyReviewValidation,
  readPhase6AttachedArtifactPath,
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
  attachmentStatus: Phase6AttachmentStatus;
  sourceCommitStatus: Phase6SourceCommitStatus;
  commands: typeof PHASE6_EVIDENCE_COMMANDS;
  validation?: Phase6CustodyReviewValidation;
  nextActions: string[];
}

export interface Phase6EvidenceStatusOptions {
  artifactBaseDir?: string;
  artifactExists?: (path: string) => boolean;
  currentSourceCommit?: string;
  resolveArtifactPath?: (artifactPath: string, baseDir: string) => string;
}

export interface Phase6SourceCommitStatus {
  status: "not_checked" | "not_applicable" | "valid" | "invalid";
  evidenceSourceCommit?: string;
  currentSourceCommit?: string;
  blockers: string[];
}

export interface Phase6AttachmentStatus {
  status: "not_checked" | "valid" | "invalid";
  checkedArtifacts: string[];
  missingArtifacts: string[];
  blockers: string[];
}

interface Phase6MissingFieldAction {
  fields: readonly Phase6CustodyRequiredField[];
  createAction: (fields: readonly Phase6CustodyRequiredField[]) => string;
}

const PHASE6_MISSING_FIELD_ACTIONS: readonly Phase6MissingFieldAction[] = [
  {
    fields: [
      "review_id",
      "review_date",
      "reviewers",
      "staging_environment",
      "funding_wallet",
      "network",
      "approval_notes",
    ],
    createAction: (fields) =>
      `Fill direct Phase 6 custody review fields in split402-launch-evidence/phase6-evidence.env: ${fields.join(", ")}.`,
  },
  {
    fields: ["source_commit"],
    createAction: () =>
      "Refresh source_commit with corepack pnpm product:evidence:init --refresh-source before collecting final evidence, or recollect evidence from the current checkout.",
  },
  {
    fields: [
      "signer_image_digest",
      "signer_image_build_command",
      "signer_image_dependency_audit_output",
      "control_plane_image_digest",
    ],
    createAction: (fields) =>
      `Generate image provenance with corepack pnpm phase6:image-provenance, then assemble these fields: ${fields.join(", ")}.`,
  },
  {
    fields: ["network_policy_record"],
    createAction: () =>
      "Generate private signer network evidence with corepack pnpm phase6:network-policy, then attach network_policy_record.",
  },
  {
    fields: [
      "signer_policy_record",
      "signer_policy_network",
      "signer_policy_funding_wallet",
      "signer_policy_source_token_account",
      "signer_policy_mint",
      "signer_policy_allowed_token_program_ids",
      "signer_policy_max_transaction_amount_atomic",
    ],
    createAction: (fields) =>
      `Generate signer policy evidence with corepack pnpm phase6:signer-policy, then assemble these fields: ${fields.join(", ")}.`,
  },
  {
    fields: ["smoke_check_output"],
    createAction: () =>
      "Run corepack pnpm signer:payout:smoke && corepack pnpm phase6:signer-smoke, then attach smoke_check_output.",
  },
  {
    fields: ["key_custody_record"],
    createAction: () =>
      "Generate key custody evidence with corepack pnpm phase6:key-custody, then attach key_custody_record.",
  },
  {
    fields: [
      "unknown_outcome_reconciliation_record",
      "rotation_drill_record",
      "emergency_revocation_drill_record",
      "incident_drill_record",
      "rollback_drill_record",
      "rpc_failover_record",
    ],
    createAction: (fields) =>
      `Generate custody drill evidence for ${fields.join(", ")} using corepack pnpm phase6:reconciliation-drill, phase6:rotation-drill, phase6:emergency-revocation, phase6:incident-drill, phase6:rollback-drill, and corepack pnpm payout:finality:failover-drill && corepack pnpm phase6:rpc-failover as applicable.`,
  },
  {
    fields: ["approval_decision"],
    createAction: () =>
      "Set approval_decision=no-go until all Phase 6 custody evidence fields and reviews are complete; use approved only during final human custody approval.",
  },
];

const PHASE6_MISSING_FIELD_ACTION_FIELDS = new Set<Phase6CustodyRequiredField>(
  PHASE6_MISSING_FIELD_ACTIONS.flatMap((action) => [...action.fields]),
);

const LAUNCH_PREFLIGHT_ACTION =
  "Run corepack pnpm product:launch-preflight --brief --workspace split402-launch-evidence for grouped env/setup blockers before collecting or recollecting evidence.";

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
  const attachmentStatus = createAttachmentStatus(evidenceText, options);

  return {
    schema: "split402.phase6_evidence_status.v1",
    readyForCustody:
      (validation?.approved ?? false) &&
      sourceCommitBlockers.length === 0 &&
      attachmentStatus.status !== "invalid",
    evidenceBundleChecked: validation !== undefined,
    attachmentStatus,
    sourceCommitStatus,
    commands: PHASE6_EVIDENCE_COMMANDS,
    validation,
    nextActions: createNextActions(
      validation,
      sourceCommitBlockers,
      attachmentStatus.blockers,
    ),
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
  const attachmentStatus = report.attachmentStatus.status;
  const nextActions = report.nextActions.map((action) => `- ${action}`);

  return [
    `Phase 6 custody evidence: ${status}`,
    `Source commit: ${sourceCommit}`,
    `Attached artifacts: ${attachmentStatus}`,
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
  attachmentBlockers: readonly string[] = [],
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
    return sourceCommitBlockers.length === 0 && attachmentBlockers.length === 0
      ? ["Evidence bundle passes machine checks; proceed to human go/no-go review."]
      : [LAUNCH_PREFLIGHT_ACTION, ...sourceCommitBlockers, ...attachmentBlockers];
  }

  const actions: string[] = [LAUNCH_PREFLIGHT_ACTION];
  actions.push(...createMissingFieldActions(validation));
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
  actions.push(...attachmentBlockers);
  if (actions.length > 0) {
    actions.push(
      "Reassemble with corepack pnpm phase6:evidence:assemble --evidence-env-file split402-launch-evidence/phase6-evidence.env split402-launch-evidence/phase6-custody-evidence.txt, then rerun corepack pnpm phase6:evidence:status --brief split402-launch-evidence/phase6-custody-evidence.txt.",
    );
  }
  return actions;
}

function createAttachmentStatus(
  evidenceText: string | undefined,
  options: Phase6EvidenceStatusOptions,
): Phase6AttachmentStatus {
  if (
    evidenceText === undefined ||
    options.artifactBaseDir === undefined ||
    options.artifactExists === undefined
  ) {
    return {
      status: "not_checked",
      checkedArtifacts: [],
      missingArtifacts: [],
      blockers: [],
    };
  }

  const fields = parseRecordFields(evidenceText);
  const checkedArtifacts: string[] = [];
  const missingArtifacts: string[] = [];
  const artifactExists = options.artifactExists;
  const resolveArtifactPath =
    options.resolveArtifactPath ??
    ((artifactPath: string, baseDir: string) =>
      resolveDefaultArtifactPath(artifactPath, baseDir, artifactExists));

  for (const field of PHASE6_CUSTODY_ATTACHMENT_FIELDS) {
    const value = fields.get(field);
    if (value === undefined || value.trim().length === 0) {
      continue;
    }
    const artifactPath = readPhase6AttachedArtifactPath(value);
    if (artifactPath === undefined) {
      continue;
    }
    const resolvedArtifactPath = resolveArtifactPath(
      artifactPath,
      options.artifactBaseDir,
    );
    checkedArtifacts.push(resolvedArtifactPath);
    if (!options.artifactExists(resolvedArtifactPath)) {
      missingArtifacts.push(resolvedArtifactPath);
    }
  }

  return {
    status: missingArtifacts.length === 0 ? "valid" : "invalid",
    checkedArtifacts,
    missingArtifacts,
    blockers: missingArtifacts.map(
      (path) => `Phase 6 attached artifact is missing: ${path}`,
    ),
  };
}

function resolveDefaultArtifactPath(
  artifactPath: string,
  baseDir: string,
  artifactExists: (path: string) => boolean,
): string {
  if (isAbsolute(artifactPath) || artifactExists(artifactPath)) {
    return artifactPath;
  }
  return join(baseDir, artifactPath);
}

function createMissingFieldActions(
  validation: Phase6CustodyReviewValidation,
): string[] {
  const fieldsNeedingEvidence = new Set<Phase6CustodyRequiredField>([
    ...validation.missingFields,
    ...validation.placeholderFields.filter((field) => field !== "approval_decision"),
  ]);
  if (validation.missingFields.includes("approval_decision")) {
    fieldsNeedingEvidence.add("approval_decision");
  }

  const actions = PHASE6_MISSING_FIELD_ACTIONS.flatMap((action) => {
    const matchedFields = action.fields.filter((field) =>
      fieldsNeedingEvidence.has(field),
    );
    return matchedFields.length === 0 ? [] : [action.createAction(matchedFields)];
  });
  const unhandledFields = [...fieldsNeedingEvidence].filter(
    (field) => !PHASE6_MISSING_FIELD_ACTION_FIELDS.has(field),
  );
  if (unhandledFields.length > 0) {
    actions.push(`Fill missing fields: ${unhandledFields.join(", ")}`);
  }
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

function parseRecordFields(text: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of text.split(/\r?\n/u)) {
    const match = /^([a-z][a-z0-9_]*):\s*(.*)$/u.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      fields.set(match[1], match[2].trim());
    }
  }
  return fields;
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
