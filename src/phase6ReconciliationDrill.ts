export type Phase6ReconciliationRecommendedAction =
  | "close_ledger_if_finalized"
  | "wait_for_finality"
  | "manual_review_before_retry"
  | "requery_chain_before_retry";

export interface Phase6ReconciliationDrillInput {
  drillId: string;
  drillDate: string;
  owners: string;
  stagingEnvironment: string;
  merchantId: string;
  payoutBatchId: string;
  expectedSignature: string;
  outcomeUnknownEvidence: string;
  reconciliationListEvidence: string;
  reconcileEndpointEvidence: string;
  recommendedAction: string;
  persistedStatusAfterReconcile: string;
  noReplacementBytesEvidence: string;
  drillDecision?: string;
  drillNotes?: string;
}

const RECOMMENDED_ACTIONS: readonly Phase6ReconciliationRecommendedAction[] = [
  "close_ledger_if_finalized",
  "wait_for_finality",
  "manual_review_before_retry",
  "requery_chain_before_retry",
];

export function createPhase6ReconciliationDrillRecord(
  input: Phase6ReconciliationDrillInput,
): string {
  const record = {
    drill_id: assertRequired(input.drillId, "drillId"),
    drill_date: assertRequired(input.drillDate, "drillDate"),
    owners: assertRequired(input.owners, "owners"),
    staging_environment: assertRequired(
      input.stagingEnvironment,
      "stagingEnvironment",
    ),
    merchant_id: assertRequired(input.merchantId, "merchantId"),
    payout_batch_id: assertRequired(input.payoutBatchId, "payoutBatchId"),
    expected_signature: assertRequired(input.expectedSignature, "expectedSignature"),
    outcome_unknown_evidence: assertOutcomeUnknownEvidence(
      input.outcomeUnknownEvidence,
    ),
    reconciliation_list_evidence: assertReconciliationListEvidence(
      input.reconciliationListEvidence,
    ),
    reconcile_endpoint_evidence: assertReconcileEndpointEvidence(
      input.reconcileEndpointEvidence,
    ),
    recommended_action: assertRecommendedAction(input.recommendedAction),
    persisted_status_after_reconcile: assertRequired(
      input.persistedStatusAfterReconcile,
      "persistedStatusAfterReconcile",
    ),
    no_replacement_bytes_evidence: assertNoReplacementBytesEvidence(
      input.noReplacementBytesEvidence,
    ),
    drill_decision: input.drillDecision ?? "no-go",
    drill_notes: input.drillNotes ?? "",
  };

  return `${Object.entries(record)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n")}\n`;
}

export function assertOutcomeUnknownEvidence(value: string): string {
  const trimmed = assertRequired(value, "outcomeUnknownEvidence");
  if (!trimmed.toLowerCase().includes("outcome_unknown")) {
    throw new Error("outcomeUnknownEvidence must mention outcome_unknown");
  }
  return trimmed;
}

export function assertReconciliationListEvidence(value: string): string {
  const trimmed = assertRequired(value, "reconciliationListEvidence");
  const normalized = trimmed.toLowerCase();
  if (
    !normalized.includes("/v1/merchants/") ||
    !normalized.includes("/payouts/reconciliation")
  ) {
    throw new Error(
      "reconciliationListEvidence must mention GET /v1/merchants/:merchantId/payouts/reconciliation",
    );
  }
  return trimmed;
}

export function assertReconcileEndpointEvidence(value: string): string {
  const trimmed = assertRequired(value, "reconcileEndpointEvidence");
  const normalized = trimmed.toLowerCase();
  if (
    !normalized.includes("/v1/payout-batches/") ||
    !normalized.includes("/reconcile")
  ) {
    throw new Error(
      "reconcileEndpointEvidence must mention POST /v1/payout-batches/:batchId/reconcile",
    );
  }
  return trimmed;
}

export function assertRecommendedAction(
  value: string,
): Phase6ReconciliationRecommendedAction {
  const trimmed = assertRequired(value, "recommendedAction");
  if (!RECOMMENDED_ACTIONS.includes(trimmed as Phase6ReconciliationRecommendedAction)) {
    throw new Error(
      `recommendedAction must be one of: ${RECOMMENDED_ACTIONS.join(", ")}`,
    );
  }
  return trimmed as Phase6ReconciliationRecommendedAction;
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

function assertRequired(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${fieldName} is required`);
  }
  return trimmed;
}
