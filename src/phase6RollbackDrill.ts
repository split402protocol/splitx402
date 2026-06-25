export interface Phase6RollbackDrillInput {
  drillId: string;
  drillDate: string;
  owners: string;
  stagingEnvironment: string;
  currentSignerImageDigest: string;
  lastKnownGoodSignerImageDigest: string;
  currentSecretSetReference: string;
  lastKnownGoodSecretSetReference: string;
  payoutBatchCreationPausedAt: string;
  rollbackStartedAt: string;
  rollbackCompletedAt: string;
  readinessAfterRollback: string;
  metricsAfterRollback: string;
  reconciliationRecords: string;
  batchCreationResumedAt: string;
  drillDecision?: string;
  drillNotes?: string;
}

export function createPhase6RollbackDrillRecord(
  input: Phase6RollbackDrillInput,
): string {
  const currentSignerImageDigest = assertImageDigest(
    input.currentSignerImageDigest,
    "currentSignerImageDigest",
  );
  const lastKnownGoodSignerImageDigest = assertImageDigest(
    input.lastKnownGoodSignerImageDigest,
    "lastKnownGoodSignerImageDigest",
  );
  if (currentSignerImageDigest === lastKnownGoodSignerImageDigest) {
    throw new Error(
      "lastKnownGoodSignerImageDigest must differ from currentSignerImageDigest",
    );
  }

  const currentSecretSetReference = assertRequired(
    input.currentSecretSetReference,
    "currentSecretSetReference",
  );
  const lastKnownGoodSecretSetReference = assertRequired(
    input.lastKnownGoodSecretSetReference,
    "lastKnownGoodSecretSetReference",
  );
  if (currentSecretSetReference === lastKnownGoodSecretSetReference) {
    throw new Error(
      "lastKnownGoodSecretSetReference must differ from currentSecretSetReference",
    );
  }

  const record = {
    drill_id: assertRequired(input.drillId, "drillId"),
    drill_date: assertRequired(input.drillDate, "drillDate"),
    owners: assertRequired(input.owners, "owners"),
    staging_environment: assertRequired(
      input.stagingEnvironment,
      "stagingEnvironment",
    ),
    current_signer_image_digest: currentSignerImageDigest,
    last_known_good_signer_image_digest: lastKnownGoodSignerImageDigest,
    current_secret_set_reference: currentSecretSetReference,
    last_known_good_secret_set_reference: lastKnownGoodSecretSetReference,
    payout_batch_creation_paused_at: assertRequired(
      input.payoutBatchCreationPausedAt,
      "payoutBatchCreationPausedAt",
    ),
    rollback_started_at: assertRequired(
      input.rollbackStartedAt,
      "rollbackStartedAt",
    ),
    rollback_completed_at: assertRequired(
      input.rollbackCompletedAt,
      "rollbackCompletedAt",
    ),
    readiness_after_rollback: assertReadinessEvidence(
      input.readinessAfterRollback,
    ),
    metrics_after_rollback: assertRequired(
      input.metricsAfterRollback,
      "metricsAfterRollback",
    ),
    reconciliation_records: assertRequired(
      input.reconciliationRecords,
      "reconciliationRecords",
    ),
    batch_creation_resumed_at: assertRequired(
      input.batchCreationResumedAt,
      "batchCreationResumedAt",
    ),
    drill_decision: input.drillDecision ?? "no-go",
    drill_notes: input.drillNotes ?? "",
  };

  return `${Object.entries(record)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n")}\n`;
}

export function assertImageDigest(value: string, fieldName: string): string {
  const trimmed = assertRequired(value, fieldName);
  if (!/^sha256:[a-f0-9]{64}$/u.test(trimmed)) {
    throw new Error(`${fieldName} must be an immutable sha256 digest`);
  }
  return trimmed;
}

export function assertReadinessEvidence(value: string): string {
  const trimmed = assertRequired(value, "readinessAfterRollback");
  const normalized = trimmed.toLowerCase();
  if (!normalized.includes("ready") && !normalized.includes("200")) {
    throw new Error("readinessAfterRollback must mention ready or HTTP 200");
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
