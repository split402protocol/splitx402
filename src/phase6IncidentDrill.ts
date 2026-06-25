export type Phase6IncidentDrillScenario =
  | "control_plane_auth_secret_exposure"
  | "payout_signer_key_suspected_compromised"
  | "rpc_timeout_after_broadcast";

export interface Phase6IncidentDrillInput {
  drillId: string;
  scenario: string;
  startedAt: string;
  endedAt: string;
  incidentCommander: string;
  controlPlaneOperator: string;
  signerOperator: string;
  chainOperator: string;
  reviewer: string;
  sourceCommit: string;
  signerImageDigest: string;
  signerReference: string;
  network: string;
  fundingWallet: string;
  affectedBatchIds: string;
  payoutCreationPausedEvidence: string;
  smokeCheckOutput: string;
  metricsBefore: string;
  metricsAfter: string;
  auditLogSample: string;
  reconciliationReports: string;
  noReplacementBytesEvidence: string;
  resumeEvidence: string;
  drillDecision?: string;
  followUpActions?: string;
}

const SCENARIOS: readonly Phase6IncidentDrillScenario[] = [
  "control_plane_auth_secret_exposure",
  "payout_signer_key_suspected_compromised",
  "rpc_timeout_after_broadcast",
];

export function createPhase6IncidentDrillRecord(
  input: Phase6IncidentDrillInput,
): string {
  const record = {
    drill_id: assertRequired(input.drillId, "drillId"),
    scenario: assertScenario(input.scenario),
    started_at: assertRequired(input.startedAt, "startedAt"),
    ended_at: assertRequired(input.endedAt, "endedAt"),
    incident_commander: assertRequired(
      input.incidentCommander,
      "incidentCommander",
    ),
    control_plane_operator: assertRequired(
      input.controlPlaneOperator,
      "controlPlaneOperator",
    ),
    signer_operator: assertRequired(input.signerOperator, "signerOperator"),
    chain_operator: assertRequired(input.chainOperator, "chainOperator"),
    reviewer: assertRequired(input.reviewer, "reviewer"),
    source_commit: assertGitSha(input.sourceCommit),
    signer_image_digest: assertImageDigest(input.signerImageDigest),
    signer_reference: assertRequired(input.signerReference, "signerReference"),
    network: assertSolanaNetwork(input.network),
    funding_wallet: assertRequired(input.fundingWallet, "fundingWallet"),
    affected_batch_ids: assertRequired(input.affectedBatchIds, "affectedBatchIds"),
    payout_creation_paused_evidence: assertPauseEvidence(
      input.payoutCreationPausedEvidence,
    ),
    smoke_check_output: assertRequired(input.smokeCheckOutput, "smokeCheckOutput"),
    metrics_before: assertRequired(input.metricsBefore, "metricsBefore"),
    metrics_after: assertRequired(input.metricsAfter, "metricsAfter"),
    audit_log_sample: assertSanitizedAuditEvidence(input.auditLogSample),
    reconciliation_reports: assertReconciliationEvidence(
      input.reconciliationReports,
    ),
    no_replacement_bytes_evidence: assertNoReplacementBytesEvidence(
      input.noReplacementBytesEvidence,
    ),
    resume_evidence: assertResumeEvidence(input.resumeEvidence),
    drill_decision: assertDrillDecision(input.drillDecision ?? "no-go"),
    follow_up_actions: input.followUpActions ?? "",
  };

  return `${Object.entries(record)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n")}\n`;
}

export function assertScenario(value: string): Phase6IncidentDrillScenario {
  const trimmed = assertRequired(value, "scenario");
  if (!SCENARIOS.includes(trimmed as Phase6IncidentDrillScenario)) {
    throw new Error(
      `scenario must be one of: ${SCENARIOS.join(", ")}`,
    );
  }
  return trimmed as Phase6IncidentDrillScenario;
}

export function assertPauseEvidence(value: string): string {
  const trimmed = assertRequired(value, "payoutCreationPausedEvidence");
  const normalized = trimmed.toLowerCase();
  if (!normalized.includes("paused")) {
    throw new Error("payoutCreationPausedEvidence must mention paused payouts");
  }
  return trimmed;
}

export function assertReconciliationEvidence(value: string): string {
  const trimmed = assertRequired(value, "reconciliationReports");
  const normalized = trimmed.toLowerCase();
  if (!normalized.includes("reconcile") && !normalized.includes("reconciliation")) {
    throw new Error("reconciliationReports must mention reconciliation");
  }
  return trimmed;
}

export function assertNoReplacementBytesEvidence(value: string): string {
  const trimmed = assertRequired(value, "noReplacementBytesEvidence");
  const normalized = trimmed.toLowerCase();
  if (
    !normalized.includes("no replacement") &&
    !normalized.includes("no new signed bytes")
  ) {
    throw new Error(
      "noReplacementBytesEvidence must mention no replacement or no new signed bytes",
    );
  }
  return trimmed;
}

export function assertResumeEvidence(value: string): string {
  const trimmed = assertRequired(value, "resumeEvidence");
  const normalized = trimmed.toLowerCase();
  if (!normalized.includes("resumed")) {
    throw new Error("resumeEvidence must mention resumed payout creation");
  }
  return trimmed;
}

export function assertDrillDecision(value: string): string {
  const normalized = assertRequired(value, "drillDecision").toLowerCase();
  if (normalized !== "pass" && normalized !== "no-go") {
    throw new Error("drillDecision must be pass or no-go");
  }
  return normalized;
}

function assertGitSha(value: string): string {
  const trimmed = assertRequired(value, "sourceCommit");
  if (!/^[a-f0-9]{7,40}$/u.test(trimmed)) {
    throw new Error("sourceCommit must be a git SHA");
  }
  return trimmed;
}

function assertImageDigest(value: string): string {
  const trimmed = assertRequired(value, "signerImageDigest");
  if (!/^sha256:[a-f0-9]{64}$/u.test(trimmed)) {
    throw new Error("signerImageDigest must be an immutable sha256 digest");
  }
  return trimmed;
}

function assertSolanaNetwork(value: string): string {
  const trimmed = assertRequired(value, "network");
  if (!trimmed.startsWith("solana:")) {
    throw new Error("network must start with solana:");
  }
  return trimmed;
}

function assertSanitizedAuditEvidence(value: string): string {
  const trimmed = assertRequired(value, "auditLogSample");
  const normalized = trimmed.toLowerCase();
  if (!normalized.includes("sanitized")) {
    throw new Error("auditLogSample must mention sanitized audit evidence");
  }
  return trimmed;
}

function assertRequired(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${fieldName} is required`);
  }
  return trimmed;
}
