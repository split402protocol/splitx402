export interface Phase6KeyCustodyReviewInput {
  reviewId: string;
  reviewDate: string;
  reviewers: string;
  network: string;
  fundingWallet: string;
  sourceTokenAccount: string;
  keySource: string;
  keyOwner: string;
  keyBackupPolicy: string;
  keyRecoveryProcess: string;
  accessList: string[];
  accessReviewRecord: string;
  separationOfDutiesRecord: string;
  lastRotationOrGenerationTime: string;
  mainnetEnabled?: boolean;
  reviewDecision?: string;
  reviewNotes?: string;
}

export function createPhase6KeyCustodyReviewRecord(
  input: Phase6KeyCustodyReviewInput,
): string {
  const record = {
    review_id: assertRequired(input.reviewId, "reviewId"),
    review_date: assertRequired(input.reviewDate, "reviewDate"),
    reviewers: assertRequired(input.reviewers, "reviewers"),
    network: assertSolanaNetwork(input.network),
    funding_wallet: assertRequired(input.fundingWallet, "fundingWallet"),
    source_token_account: assertRequired(
      input.sourceTokenAccount,
      "sourceTokenAccount",
    ),
    key_source: assertRequired(input.keySource, "keySource"),
    key_owner: assertRequired(input.keyOwner, "keyOwner"),
    key_backup_policy: assertRequired(input.keyBackupPolicy, "keyBackupPolicy"),
    key_recovery_process: assertRequired(
      input.keyRecoveryProcess,
      "keyRecoveryProcess",
    ),
    access_list: assertAccessList(input.accessList).join(","),
    access_review_record: assertRequired(
      input.accessReviewRecord,
      "accessReviewRecord",
    ),
    separation_of_duties_record: assertRequired(
      input.separationOfDutiesRecord,
      "separationOfDutiesRecord",
    ),
    last_rotation_or_generation_time: assertRequired(
      input.lastRotationOrGenerationTime,
      "lastRotationOrGenerationTime",
    ),
    mainnet_enabled: String(input.mainnetEnabled ?? false),
    review_decision: input.reviewDecision ?? "no-go",
    review_notes: input.reviewNotes ?? "",
  };

  return `${Object.entries(record)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n")}\n`;
}

export function assertSolanaNetwork(value: string): string {
  const trimmed = assertRequired(value, "network");
  if (!trimmed.startsWith("solana:")) {
    throw new Error("network must start with solana:");
  }
  return trimmed;
}

function assertAccessList(values: string[]): string[] {
  const trimmed = values.map((value) => value.trim()).filter(Boolean);
  if (trimmed.length === 0) {
    throw new Error("accessList must include at least one authorized operator");
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
