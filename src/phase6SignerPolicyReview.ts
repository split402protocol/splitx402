export interface Phase6SignerPolicyReviewInput {
  reviewId: string;
  reviewDate: string;
  reviewers: string;
  network: string;
  fundingWallet: string;
  sourceTokenAccount: string;
  mint: string;
  allowedTokenProgramIds: string[];
  maxTransactionAmountAtomic: string;
  maxBatchAmountAtomic: string;
  expectedDestinationAmountListHash: string;
  requireSuccessfulSimulation: boolean;
  signerReference: string;
  reviewDecision?: string;
  reviewNotes?: string;
}

export function createPhase6SignerPolicyReviewRecord(
  input: Phase6SignerPolicyReviewInput,
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
    mint: assertRequired(input.mint, "mint"),
    allowed_token_program_ids: assertTokenProgramIds(
      input.allowedTokenProgramIds,
    ).join(","),
    max_transaction_amount_atomic: assertPositiveAtomicAmount(
      input.maxTransactionAmountAtomic,
      "maxTransactionAmountAtomic",
    ),
    max_batch_amount_atomic: assertPositiveAtomicAmount(
      input.maxBatchAmountAtomic,
      "maxBatchAmountAtomic",
    ),
    expected_destination_amount_list_hash: assertRequired(
      input.expectedDestinationAmountListHash,
      "expectedDestinationAmountListHash",
    ),
    require_successful_simulation: assertSimulationRequired(
      input.requireSuccessfulSimulation,
    ),
    signer_reference: assertRequired(input.signerReference, "signerReference"),
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

export function assertPositiveAtomicAmount(
  value: string,
  fieldName: string,
): string {
  const trimmed = assertRequired(value, fieldName);
  if (!/^[1-9][0-9]*$/u.test(trimmed)) {
    throw new Error(`${fieldName} must be a positive atomic amount`);
  }
  return trimmed;
}

function assertTokenProgramIds(values: string[]): string[] {
  const trimmed = values.map((value) => value.trim()).filter(Boolean);
  if (trimmed.length === 0) {
    throw new Error("allowedTokenProgramIds must include at least one token program");
  }
  return trimmed;
}

function assertSimulationRequired(value: boolean): string {
  if (!value) {
    throw new Error("requireSuccessfulSimulation must be true");
  }
  return "true";
}

function assertRequired(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${fieldName} is required`);
  }
  return trimmed;
}
