import { parseAtomicAmount, serializeAtomicAmount } from "@split402/protocol";
import { randomBytes } from "node:crypto";

import type { CommissionAccrual, LedgerTransaction } from "./index.js";

export type PayoutFundingStatus = "unknown" | "covered" | "deficit";
export type PayoutBatchStatus =
  | "draft"
  | "planned"
  | "signing"
  | "submitted"
  | "confirmed"
  | "finalized"
  | "failed"
  | "cancelled"
  | "outcome_unknown";
export type PayoutItemStatus =
  | "allocated"
  | "submitted"
  | "confirmed"
  | "finalized"
  | "failed"
  | "released";
export type PayoutTransactionStatus =
  | "planned"
  | "signed"
  | "submitted"
  | "confirmed"
  | "finalized"
  | "expired"
  | "failed"
  | "outcome_unknown";
export type PayoutSkippedAccrualReason =
  | "merchant_mismatch"
  | "not_available"
  | "available_in_future"
  | "zero_amount"
  | "below_minimum_threshold"
  | "recipient_limit";

export interface ListPayoutEligibleAccrualsInput {
  merchantId: string;
  asset?: string;
  campaignId?: string;
  routeId?: string;
  now?: string;
  limit?: number;
}

export interface PayoutAccrualStore {
  listPayoutEligibleAccruals(
    input: ListPayoutEligibleAccrualsInput
  ): Promise<CommissionAccrual[]> | CommissionAccrual[];
}

export interface CreatePayoutBatchInput {
  merchantId: string;
  payoutWalletId: string;
  network: string;
  asset: string;
  accruals: readonly CommissionAccrual[];
  now?: string;
  batchId?: string;
  itemIdFactory?: () => string;
  minimumPayoutAmountAtomic?: string;
  maxRecipients?: number;
}

export interface CreatePayoutBatchFromAvailableAccrualsInput {
  merchantId: string;
  payoutWalletId: string;
  network: string;
  asset: string;
  campaignId?: string;
  routeId?: string;
  now?: string;
  limit?: number;
  batchId?: string;
  itemIdFactory?: () => string;
  minimumPayoutAmountAtomic?: string;
  maxRecipients?: number;
}

export interface PayoutBatchStore {
  createPayoutBatch(input: CreatePayoutBatchInput): Promise<PayoutBatchRecord> | PayoutBatchRecord;
  createPayoutBatchFromAvailableAccruals(
    input: CreatePayoutBatchFromAvailableAccrualsInput
  ): Promise<PayoutBatchRecord> | PayoutBatchRecord;
  getPayoutBatch(
    batchId: string
  ): Promise<PayoutBatchRecord | undefined> | PayoutBatchRecord | undefined;
}

export interface SaveSignedPayoutTransactionsInput {
  payoutBatchId: string;
  transactions: readonly SaveSignedPayoutTransactionInput[];
  now?: string;
  idFactory?: () => string;
}

export interface SaveSignedPayoutTransactionInput {
  id?: string;
  sequence: number;
  attempt?: number;
  recentBlockhash?: string;
  lastValidBlockHeight?: number;
  signedTransactionBase64: string;
  expectedSignature?: string;
  items?: readonly SaveSignedPayoutTransactionItemInput[];
}

export interface SaveSignedPayoutTransactionItemInput {
  payoutItemId: string;
  amountAtomic: string;
  destinationWallet: string;
  destinationTokenAccount?: string;
}

export interface MarkPayoutTransactionSubmittedInput {
  id: string;
  submittedAt?: string;
  expectedSignature?: string;
}

export type PayoutTransactionFinalityStatus =
  | "confirmed"
  | "finalized"
  | "failed"
  | "expired"
  | "outcome_unknown";

export interface MarkPayoutTransactionFinalityInput {
  id: string;
  status: PayoutTransactionFinalityStatus;
  observedAt?: string;
  error?: Record<string, unknown>;
}

export interface PayoutTransactionStore {
  saveSignedPayoutTransactions(
    input: SaveSignedPayoutTransactionsInput
  ): Promise<PayoutTransactionRecord[]> | PayoutTransactionRecord[];
  listPayoutTransactions(
    payoutBatchId: string
  ): Promise<PayoutTransactionRecord[]> | PayoutTransactionRecord[];
  markPayoutTransactionSubmitted(
    input: MarkPayoutTransactionSubmittedInput
  ): Promise<PayoutTransactionRecord | undefined> | PayoutTransactionRecord | undefined;
  markPayoutTransactionFinality(
    input: MarkPayoutTransactionFinalityInput
  ): Promise<PayoutTransactionRecord | undefined> | PayoutTransactionRecord | undefined;
}

export interface ClosePayoutBatchLedgerInput {
  payoutBatchId: string;
  now?: string;
  transactionId?: string;
  entryIdFactory?: () => string;
  finalizedTransferVerifier?: PayoutFinalizedTransferVerifier;
}

export interface PayoutLedgerClosureStore {
  closeFinalizedPayoutBatchLedger(
    input: ClosePayoutBatchLedgerInput
  ): Promise<LedgerTransaction | undefined> | LedgerTransaction | undefined;
}

export interface PayoutFinalizedTransferVerifier {
  verifyFinalizedPayout(input: {
    batch: PayoutBatchRecord;
    transactions: PayoutTransactionRecord[];
  }):
    | Promise<PayoutFinalizedTransferVerificationResult>
    | PayoutFinalizedTransferVerificationResult;
}

export interface PayoutFinalizedTransferVerificationResult {
  ok: boolean;
  errors: string[];
}

export async function verifyPayoutFinalizedTransfersBeforeLedgerClosure(input: {
  batch: PayoutBatchRecord;
  transactions: PayoutTransactionRecord[];
  verifier?: PayoutFinalizedTransferVerifier;
}): Promise<void> {
  if (input.verifier === undefined) {
    return;
  }
  const result = await input.verifier.verifyFinalizedPayout({
    batch: input.batch,
    transactions: input.transactions
  });
  if (!result.ok) {
    throw new PayoutBatchValidationError(
      `finalized payout transfer verification failed: ${result.errors.join("; ")}`
    );
  }
}

export interface PayoutFundingBalance {
  asset: string;
  amountAtomic: string;
  fundingWallet?: string;
}

export interface CreatePayoutPreviewInput {
  merchantId: string;
  accruals: readonly CommissionAccrual[];
  now?: string;
  minimumPayoutAmountAtomic?: string;
  maxRecipients?: number;
  fundingBalances?: readonly PayoutFundingBalance[];
}

export interface PayoutPreview {
  merchantId: string;
  generatedAt: string;
  batches: PayoutPreviewBatch[];
  eligibleAccrualCount: number;
  skippedAccrualCount: number;
  skippedAccruals: PayoutPreviewSkippedAccrual[];
  totalAmountAtomicByAsset: Record<string, string>;
}

export interface PayoutPreviewBatch {
  merchantId: string;
  asset: string;
  totalAmountAtomic: string;
  itemCount: number;
  accrualCount: number;
  fundingStatus: PayoutFundingStatus;
  fundingAmountAtomic?: string;
  fundingDeficitAtomic?: string;
  items: PayoutPreviewItem[];
}

export interface PayoutPreviewItem {
  destinationWallet: string;
  referrerWallets: string[];
  amountAtomic: string;
  accrualIds: string[];
  oldestAvailableAt?: string;
  newestAvailableAt?: string;
}

export interface PayoutPreviewSkippedAccrual {
  accrualId: string;
  reason: PayoutSkippedAccrualReason;
}

export interface PayoutBatchRecord {
  id: string;
  merchantId: string;
  payoutWalletId: string;
  network: string;
  asset: string;
  status: PayoutBatchStatus;
  totalAmountAtomic: string;
  itemCount: number;
  accrualCount: number;
  failureCode?: string;
  failureMessage?: string;
  createdAt: string;
  updatedAt: string;
  items: PayoutItemRecord[];
}

export interface PayoutItemRecord {
  id: string;
  payoutBatchId: string;
  destinationWallet: string;
  destinationTokenAccount?: string;
  amountAtomic: string;
  status: PayoutItemStatus;
  createdAt: string;
  allocations: PayoutAllocationRecord[];
}

export interface PayoutAllocationRecord {
  payoutItemId: string;
  accrualId: string;
  amountAtomic: string;
}

export interface PayoutTransactionRecord {
  id: string;
  payoutBatchId: string;
  sequence: number;
  attempt: number;
  recentBlockhash?: string;
  lastValidBlockHeight?: number;
  signedTransactionBase64?: string;
  expectedSignature?: string;
  status: PayoutTransactionStatus;
  submittedAt?: string;
  confirmedAt?: string;
  finalizedAt?: string;
  error?: Record<string, unknown>;
  createdAt: string;
  items: PayoutTransactionItemRecord[];
}

export interface PayoutTransactionItemRecord {
  payoutTransactionId: string;
  payoutItemId: string;
  amountAtomic: string;
  destinationWallet: string;
  destinationTokenAccount?: string;
}

export interface ListPayoutReconciliationItemsInput {
  merchantId: string;
  asset?: string;
  limit?: number;
}

export interface PayoutReconciliationItem {
  batch: PayoutBatchRecord;
  transactions: PayoutTransactionRecord[];
  reason: "outcome_unknown";
  recommendedAction: "requery_chain_before_retry";
}

export interface PayoutReconciliationStore {
  listPayoutReconciliationItems(
    input: ListPayoutReconciliationItemsInput
  ):
    | Promise<PayoutReconciliationItem[]>
    | PayoutReconciliationItem[];
}

export interface ReferrerPayoutViewInput {
  referrerWallet: string;
  asset?: string;
}

export interface ListReferrerPayoutHistoryInput extends ReferrerPayoutViewInput {
  limit?: number;
}

export interface ReferrerBalanceSummary {
  referrerWallet: string;
  generatedAt: string;
  assets: ReferrerBalanceAsset[];
}

export interface ReferrerBalanceAsset {
  asset: string;
  pendingAmountAtomic: string;
  availableAmountAtomic: string;
  heldAmountAtomic: string;
  inFlightAmountAtomic: string;
  paidAmountAtomic: string;
  totalEarnedAmountAtomic: string;
}

export type ReferrerPayoutHistoryStatus =
  | "pending"
  | "available"
  | "held"
  | "in_flight"
  | "paid";

export interface ReferrerPayoutHistoryItem {
  accrualId: string;
  receiptId: string;
  merchantId: string;
  campaignId: string;
  routeId: string;
  referrerWallet: string;
  payoutWallet: string;
  asset: string;
  amountAtomic: string;
  status: ReferrerPayoutHistoryStatus;
  accrualStatus: CommissionAccrual["status"];
  createdAt: string;
  availableAt?: string;
  payoutBatchId?: string;
  payoutItemId?: string;
  payoutStatus?: PayoutItemStatus;
}

export interface ReferrerPayoutViewStore {
  getReferrerBalanceSummary(
    input: ReferrerPayoutViewInput
  ): Promise<ReferrerBalanceSummary> | ReferrerBalanceSummary;
  listReferrerPayoutHistory(
    input: ListReferrerPayoutHistoryInput
  ): Promise<ReferrerPayoutHistoryItem[]> | ReferrerPayoutHistoryItem[];
}

export interface MerchantObligationViewInput {
  merchantId: string;
  asset?: string;
  now?: string;
  fundingBalances?: readonly PayoutFundingBalance[];
}

export interface MerchantObligationSummary {
  schema: "split402.merchant_obligation_summary.v1";
  merchantId: string;
  generatedAt: string;
  assets: MerchantObligationAssetSummary[];
}

export interface MerchantObligationAssetSummary {
  asset: string;
  fundingStatus: PayoutFundingStatus;
  fundingAmountAtomic?: string;
  fundingDeficitAtomic?: string;
  pendingAmountAtomic: string;
  availableAmountAtomic: string;
  heldAmountAtomic: string;
  inFlightAmountAtomic: string;
  paidAmountAtomic: string;
  outstandingAmountAtomic: string;
  totalAccruedAmountAtomic: string;
  accrualCount: number;
  pendingAccrualCount: number;
  availableAccrualCount: number;
  heldAccrualCount: number;
  inFlightAccrualCount: number;
  paidAccrualCount: number;
}

export interface MerchantObligationViewStore {
  getMerchantObligationSummary(
    input: MerchantObligationViewInput
  ): Promise<MerchantObligationSummary> | MerchantObligationSummary;
}

export interface PayoutBatchFinalityRollup {
  batchStatus: PayoutBatchStatus;
  itemStatus?: PayoutItemStatus;
  failureCode?: string;
  failureMessage?: string;
}

export interface CreatePayoutFinalizationLedgerTransactionInput {
  batch: PayoutBatchRecord;
  now?: string;
  transactionId?: string;
  entryIdFactory?: () => string;
}

interface MutablePayoutItem {
  destinationWallet: string;
  referrerWallets: Set<string>;
  amount: bigint;
  accrualIds: string[];
  availableTimes: string[];
}

export class PayoutPreviewValidationError extends Error {
  readonly code = "payout_preview_validation_error";

  constructor(message: string) {
    super(message);
    this.name = "PayoutPreviewValidationError";
  }
}

export class PayoutBatchValidationError extends Error {
  readonly code = "payout_batch_validation_error";

  constructor(message: string) {
    super(message);
    this.name = "PayoutBatchValidationError";
  }
}

export class PayoutBatchConflictError extends Error {
  readonly code = "payout_batch_conflict";

  constructor(message: string) {
    super(message);
    this.name = "PayoutBatchConflictError";
  }
}

export function createPayoutPreview(
  input: CreatePayoutPreviewInput
): PayoutPreview {
  const merchantId = assertNonEmptyString(input.merchantId, "merchantId");
  const generatedAt = normalizeTimestamp(
    input.now ?? new Date().toISOString(),
    "now"
  );
  const nowMs = Date.parse(generatedAt);
  const minimumPayoutAmount = readAtomicAmount(
    input.minimumPayoutAmountAtomic ?? "0",
    "minimumPayoutAmountAtomic"
  );
  const maxRecipients = readOptionalPositiveInteger(
    input.maxRecipients,
    "maxRecipients"
  );
  const fundingByAsset = buildFundingBalanceMap(input.fundingBalances);
  const skippedAccruals: PayoutPreviewSkippedAccrual[] = [];
  const itemsByAsset = new Map<string, Map<string, MutablePayoutItem>>();

  for (const accrual of [...input.accruals].sort(compareAccrualsForPayout)) {
    if (accrual.merchantId !== merchantId) {
      skippedAccruals.push({
        accrualId: accrual.id,
        reason: "merchant_mismatch"
      });
      continue;
    }
    if (accrual.status !== "available") {
      skippedAccruals.push({ accrualId: accrual.id, reason: "not_available" });
      continue;
    }
    if (
      accrual.availableAt !== undefined &&
      Date.parse(normalizeTimestamp(accrual.availableAt, "availableAt")) > nowMs
    ) {
      skippedAccruals.push({
        accrualId: accrual.id,
        reason: "available_in_future"
      });
      continue;
    }

    const amount = readAtomicAmount(accrual.amountAtomic, "amountAtomic");
    if (amount === 0n) {
      skippedAccruals.push({ accrualId: accrual.id, reason: "zero_amount" });
      continue;
    }

    let assetItems = itemsByAsset.get(accrual.asset);
    if (assetItems === undefined) {
      assetItems = new Map();
      itemsByAsset.set(accrual.asset, assetItems);
    }

    let item = assetItems.get(accrual.payoutWallet);
    if (item === undefined) {
      item = {
        destinationWallet: accrual.payoutWallet,
        referrerWallets: new Set(),
        amount: 0n,
        accrualIds: [],
        availableTimes: []
      };
      assetItems.set(accrual.payoutWallet, item);
    }
    item.amount += amount;
    item.referrerWallets.add(accrual.referrerWallet);
    item.accrualIds.push(accrual.id);
    if (accrual.availableAt !== undefined) {
      item.availableTimes.push(normalizeTimestamp(accrual.availableAt, "availableAt"));
    }
  }

  const batches = Array.from(itemsByAsset.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([asset, itemMap]) =>
      createPreviewBatch({
        merchantId,
        asset,
        itemMap,
        minimumPayoutAmount,
        maxRecipients,
        fundingByAsset,
        skippedAccruals
      })
    )
    .filter((batch): batch is PayoutPreviewBatch => batch !== undefined);
  const totalAmountAtomicByAsset = Object.fromEntries(
    batches.map((batch) => [batch.asset, batch.totalAmountAtomic])
  );

  return {
    merchantId,
    generatedAt,
    batches,
    eligibleAccrualCount: batches.reduce(
      (total, batch) => total + batch.accrualCount,
      0
    ),
    skippedAccrualCount: skippedAccruals.length,
    skippedAccruals,
    totalAmountAtomicByAsset
  };
}

export function filterPayoutEligibleAccruals(
  accruals: readonly CommissionAccrual[],
  input: ListPayoutEligibleAccrualsInput
): CommissionAccrual[] {
  const merchantId = assertNonEmptyString(input.merchantId, "merchantId");
  const limit = readOptionalPositiveInteger(input.limit, "limit");
  const nowMs =
    input.now === undefined
      ? undefined
      : Date.parse(normalizeTimestamp(input.now, "now"));
  const filtered = accruals
    .filter((accrual) => {
      if (accrual.merchantId !== merchantId || accrual.status !== "available") {
        return false;
      }
      if (input.asset !== undefined && accrual.asset !== input.asset) {
        return false;
      }
      if (input.campaignId !== undefined && accrual.campaignId !== input.campaignId) {
        return false;
      }
      if (input.routeId !== undefined && accrual.routeId !== input.routeId) {
        return false;
      }
      if (
        nowMs !== undefined &&
        accrual.availableAt !== undefined &&
        Date.parse(normalizeTimestamp(accrual.availableAt, "availableAt")) > nowMs
      ) {
        return false;
      }
      return true;
    })
    .sort(compareAccrualsForPayout);

  return limit === undefined ? filtered : filtered.slice(0, limit);
}

export function isPayoutPreviewValidationError(
  error: unknown
): error is PayoutPreviewValidationError {
  return error instanceof PayoutPreviewValidationError;
}

export function createPayoutBatchPlan(
  input: CreatePayoutBatchInput
): PayoutBatchRecord {
  const merchantId = assertNonEmptyString(input.merchantId, "merchantId");
  const payoutWalletId = assertSplit402Id(input.payoutWalletId, "payoutWalletId");
  const network = assertNonEmptyString(input.network, "network");
  const asset = assertNonEmptyString(input.asset, "asset");
  const createdAt = normalizeTimestamp(input.now ?? new Date().toISOString(), "now");
  const batchId = assertSplit402Id(
    input.batchId ?? createPayoutBatchId(),
    "batchId"
  );
  const itemIdFactory = input.itemIdFactory ?? createPayoutItemId;
  const accruals = input.accruals.filter((accrual) => accrual.asset === asset);
  const preview = createPayoutPreview({
    merchantId,
    accruals,
    now: createdAt,
    ...(input.minimumPayoutAmountAtomic === undefined
      ? {}
      : { minimumPayoutAmountAtomic: input.minimumPayoutAmountAtomic }),
    ...(input.maxRecipients === undefined ? {} : { maxRecipients: input.maxRecipients })
  });
  const previewBatch = preview.batches.find((batch) => batch.asset === asset);
  if (previewBatch === undefined || previewBatch.items.length === 0) {
    throw new PayoutBatchValidationError("no payout items selected");
  }

  const accrualById = new Map(accruals.map((accrual) => [accrual.id, accrual]));
  const items = previewBatch.items.map((previewItem) => {
    const itemId = assertSplit402Id(itemIdFactory(), "payoutItemId");
    const allocations = previewItem.accrualIds.map((accrualId) => {
      const accrual = accrualById.get(accrualId);
      if (accrual === undefined) {
        throw new PayoutBatchValidationError(
          `missing selected accrual: ${accrualId}`
        );
      }
      return {
        payoutItemId: itemId,
        accrualId,
        amountAtomic: accrual.amountAtomic
      };
    });
    return {
      id: itemId,
      payoutBatchId: batchId,
      destinationWallet: previewItem.destinationWallet,
      amountAtomic: previewItem.amountAtomic,
      status: "allocated" as const,
      createdAt,
      allocations
    };
  });

  return {
    id: batchId,
    merchantId,
    payoutWalletId,
    network,
    asset,
    status: "planned",
    totalAmountAtomic: previewBatch.totalAmountAtomic,
    itemCount: items.length,
    accrualCount: items.reduce(
      (total, item) => total + item.allocations.length,
      0
    ),
    createdAt,
    updatedAt: createdAt,
    items
  };
}

export function isPayoutBatchValidationError(
  error: unknown
): error is PayoutBatchValidationError {
  return error instanceof PayoutBatchValidationError;
}

export function isPayoutBatchConflictError(
  error: unknown
): error is PayoutBatchConflictError {
  return error instanceof PayoutBatchConflictError;
}

export function createSignedPayoutTransactionRecords(
  input: SaveSignedPayoutTransactionsInput
): PayoutTransactionRecord[] {
  const payoutBatchId = assertSplit402Id(input.payoutBatchId, "payoutBatchId");
  const createdAt = normalizeTimestamp(input.now ?? new Date().toISOString(), "now");
  const idFactory = input.idFactory ?? createPayoutTransactionId;
  if (input.transactions.length === 0) {
    throw new PayoutBatchValidationError("signed payout transactions are required");
  }

  const sequenceAttempts = new Set<string>();
  const expectedSignatures = new Set<string>();
  return [...input.transactions]
    .sort((left, right) => left.sequence - right.sequence || readAttempt(left) - readAttempt(right))
    .map((transaction) => {
      const sequence = assertNonNegativeInteger(
        transaction.sequence,
        "payout transaction sequence"
      );
      const attempt = assertPositiveInteger(readAttempt(transaction), "payout transaction attempt");
      const sequenceAttempt = `${sequence}:${attempt}`;
      if (sequenceAttempts.has(sequenceAttempt)) {
        throw new PayoutBatchValidationError(
          `duplicate payout transaction sequence and attempt: ${sequenceAttempt}`
        );
      }
      sequenceAttempts.add(sequenceAttempt);

      const expectedSignature =
        transaction.expectedSignature === undefined
          ? undefined
          : assertNonEmptyString(
              transaction.expectedSignature,
              "payout transaction expectedSignature"
            );
      if (expectedSignature !== undefined) {
        if (expectedSignatures.has(expectedSignature)) {
          throw new PayoutBatchValidationError(
            "duplicate payout transaction expectedSignature"
          );
        }
        expectedSignatures.add(expectedSignature);
      }

      const id = assertSplit402Id(
        transaction.id ?? idFactory(),
        "payout transaction id"
      );
      return {
        id,
        payoutBatchId,
        sequence,
        attempt,
        ...(transaction.recentBlockhash === undefined
          ? {}
          : {
              recentBlockhash: assertNonEmptyString(
                transaction.recentBlockhash,
                "payout transaction recentBlockhash"
              )
            }),
        ...(transaction.lastValidBlockHeight === undefined
          ? {}
          : {
              lastValidBlockHeight: assertNonNegativeInteger(
                transaction.lastValidBlockHeight,
                "payout transaction lastValidBlockHeight"
              )
            }),
        signedTransactionBase64: assertBase64String(
          transaction.signedTransactionBase64,
          "payout transaction signedTransactionBase64"
        ),
        ...(expectedSignature === undefined ? {} : { expectedSignature }),
        status: "signed" as const,
        createdAt,
        items: readSignedPayoutTransactionItems(
          transaction.items,
          id
        )
      };
    });
}

export function attachPayoutTransactionItemMappings(
  transactions: readonly PayoutTransactionRecord[],
  batch: PayoutBatchRecord
): PayoutTransactionRecord[] {
  if (transactions.length === 0) {
    return [];
  }
  const batchItemsById = new Map(batch.items.map((item) => [item.id, item]));
  const defaultAllItems =
    transactions.length === 1 && transactions[0]?.items.length === 0;
  const sequenceByPayoutItemId = new Map<string, number>();
  return transactions.map((transaction) => {
    const rawItems = defaultAllItems
      ? batch.items.map((item) => ({
          payoutTransactionId: transaction.id,
          payoutItemId: item.id,
          amountAtomic: item.amountAtomic,
          destinationWallet: item.destinationWallet,
          ...(item.destinationTokenAccount === undefined
            ? {}
            : { destinationTokenAccount: item.destinationTokenAccount })
        }))
      : transaction.items;
    if (rawItems.length === 0) {
      throw new PayoutBatchValidationError(
        "payout transaction item mappings are required"
      );
    }
    const seenInTransaction = new Set<string>();
    const items = rawItems.map((mapping) => {
      const payoutItem = batchItemsById.get(mapping.payoutItemId);
      if (payoutItem === undefined) {
        throw new PayoutBatchValidationError(
          `payout transaction references unknown payout item: ${mapping.payoutItemId}`
        );
      }
      if (seenInTransaction.has(mapping.payoutItemId)) {
        throw new PayoutBatchValidationError(
          `duplicate payout item mapping: ${mapping.payoutItemId}`
        );
      }
      seenInTransaction.add(mapping.payoutItemId);
      const existingSequence = sequenceByPayoutItemId.get(mapping.payoutItemId);
      if (
        existingSequence !== undefined &&
        existingSequence !== transaction.sequence
      ) {
        throw new PayoutBatchValidationError(
          `payout item is mapped to multiple transaction sequences: ${mapping.payoutItemId}`
        );
      }
      sequenceByPayoutItemId.set(mapping.payoutItemId, transaction.sequence);
      if (mapping.amountAtomic !== payoutItem.amountAtomic) {
        throw new PayoutBatchValidationError(
          `payout transaction item amount mismatch: ${mapping.payoutItemId}`
        );
      }
      if (mapping.destinationWallet !== payoutItem.destinationWallet) {
        throw new PayoutBatchValidationError(
          `payout transaction item destination wallet mismatch: ${mapping.payoutItemId}`
        );
      }
      if (
        (mapping.destinationTokenAccount ?? undefined) !==
        (payoutItem.destinationTokenAccount ?? undefined)
      ) {
        throw new PayoutBatchValidationError(
          `payout transaction item destination token account mismatch: ${mapping.payoutItemId}`
        );
      }
      return {
        ...mapping,
        payoutTransactionId: transaction.id
      };
    });
    return {
      ...transaction,
      items
    };
  });
}

export function summarizePayoutBatchFinality(
  transactions: readonly PayoutTransactionRecord[]
): PayoutBatchFinalityRollup | undefined {
  if (transactions.length === 0) {
    return undefined;
  }
  const failed = transactions.find((transaction) => transaction.status === "failed");
  if (failed !== undefined) {
    return {
      batchStatus: "failed",
      itemStatus: "failed",
      failureCode: "payout_transaction_failed",
      failureMessage: readPayoutTransactionFailureMessage(failed)
    };
  }
  const expired = transactions.find((transaction) => transaction.status === "expired");
  if (expired !== undefined) {
    return {
      batchStatus: "outcome_unknown",
      failureCode: "payout_transaction_expired",
      failureMessage: `payout transaction expired before safe finality: ${expired.id}`
    };
  }
  const unknown = transactions.find(
    (transaction) => transaction.status === "outcome_unknown"
  );
  if (unknown !== undefined) {
    return {
      batchStatus: "outcome_unknown",
      failureCode: "payout_transaction_outcome_unknown",
      failureMessage: `payout transaction outcome is unknown: ${unknown.id}`
    };
  }
  if (transactions.every((transaction) => transaction.status === "finalized")) {
    return {
      batchStatus: "finalized",
      itemStatus: "finalized"
    };
  }
  if (
    transactions.every(
      (transaction) =>
        transaction.status === "confirmed" || transaction.status === "finalized"
    )
  ) {
    return {
      batchStatus: "confirmed",
      itemStatus: "confirmed"
    };
  }
  if (
    transactions.some(
      (transaction) =>
        transaction.status === "submitted" ||
        transaction.status === "confirmed" ||
        transaction.status === "finalized"
    )
  ) {
    return {
      batchStatus: "submitted",
      itemStatus: "submitted"
    };
  }
  if (
    transactions.some(
      (transaction) =>
        transaction.status === "signed" || transaction.status === "planned"
    )
  ) {
    return {
      batchStatus: "signing"
    };
  }
  return undefined;
}

export interface PayoutBatchItemStatusUpdate {
  payoutItemId: string;
  status: PayoutItemStatus;
}

export interface PayoutBatchTransactionItemRollup {
  batchStatus: PayoutBatchStatus;
  updatedItems: PayoutBatchItemStatusUpdate[];
  failureCode?: string;
  failureMessage?: string;
}

export function summarizePayoutBatchTransactionItemFinality(input: {
  batch: PayoutBatchRecord;
  transactions: readonly PayoutTransactionRecord[];
}): PayoutBatchTransactionItemRollup | undefined {
  if (input.transactions.length === 0) {
    return undefined;
  }
  const activeTransactions = latestAttemptBySequence(input.transactions);
  const itemStatusById = new Map(
    input.batch.items.map((item) => [item.id, item.status])
  );
  let failureCode: string | undefined;
  let failureMessage: string | undefined;

  for (const transaction of activeTransactions) {
    if (transaction.status === "failed" && failureCode === undefined) {
      failureCode = "payout_transaction_failed";
      failureMessage = readPayoutTransactionFailureMessage(transaction);
    }
    if (transaction.status === "expired" && failureCode === undefined) {
      failureCode = "payout_transaction_expired";
      failureMessage = `payout transaction expired before safe finality: ${transaction.id}`;
    }
    if (transaction.status === "outcome_unknown" && failureCode === undefined) {
      failureCode = "payout_transaction_outcome_unknown";
      failureMessage = `payout transaction outcome is unknown: ${transaction.id}`;
    }
    const itemStatus = payoutItemStatusForTransactionStatus(transaction.status);
    if (itemStatus === undefined) {
      continue;
    }
    for (const item of transaction.items) {
      if (itemStatusById.has(item.payoutItemId)) {
        itemStatusById.set(item.payoutItemId, itemStatus);
      }
    }
  }

  const nextItemStatuses = input.batch.items.map(
    (item) => itemStatusById.get(item.id) ?? item.status
  );
  const terminalFailure = activeTransactions.find((transaction) =>
    ["failed", "expired", "outcome_unknown"].includes(transaction.status)
  );
  let batchStatus: PayoutBatchStatus;
  if (terminalFailure?.status === "failed") {
    batchStatus = "failed";
  } else if (
    terminalFailure?.status === "expired" ||
    terminalFailure?.status === "outcome_unknown"
  ) {
    batchStatus = "outcome_unknown";
  } else if (nextItemStatuses.every((status) => status === "finalized")) {
    batchStatus = "finalized";
  } else if (
    nextItemStatuses.length > 0 &&
    nextItemStatuses.every(
      (status) => status === "confirmed" || status === "finalized"
    )
  ) {
    batchStatus = "confirmed";
  } else if (
    nextItemStatuses.some((status) =>
      ["submitted", "confirmed", "finalized"].includes(status)
    )
  ) {
    batchStatus = "submitted";
  } else {
    batchStatus = "signing";
  }

  return {
    batchStatus,
    updatedItems: input.batch.items
      .map((item) => ({
        payoutItemId: item.id,
        status: itemStatusById.get(item.id) ?? item.status
      }))
      .filter((item) => {
        const existing = input.batch.items.find((batchItem) => batchItem.id === item.payoutItemId);
        return existing !== undefined && existing.status !== item.status;
      }),
    ...(failureCode === undefined ? {} : { failureCode }),
    ...(failureMessage === undefined ? {} : { failureMessage })
  };
}

export function createPayoutFinalizationLedgerTransaction(
  input: CreatePayoutFinalizationLedgerTransactionInput
): LedgerTransaction {
  const batch = input.batch;
  if (batch.status !== "finalized") {
    throw new PayoutBatchValidationError(
      "payout batch must be finalized before ledger closure"
    );
  }
  if (batch.items.length === 0) {
    throw new PayoutBatchValidationError("payout batch must contain items");
  }
  if (batch.items.some((item) => item.status !== "finalized")) {
    throw new PayoutBatchValidationError(
      "all payout items must be finalized before ledger closure"
    );
  }
  const createdAt = normalizeTimestamp(input.now ?? new Date().toISOString(), "now");
  const transactionId = assertSplit402Id(
    input.transactionId ?? createLedgerTransactionId(),
    "ledger transaction id"
  );
  const entryIdFactory = input.entryIdFactory ?? createLedgerEntryId;
  const itemTotal = batch.items.reduce(
    (total, item) => total + readPositiveAtomicAmount(item.amountAtomic, "item.amountAtomic"),
    0n
  );
  if (itemTotal.toString() !== batch.totalAmountAtomic) {
    throw new PayoutBatchValidationError(
      "payout batch total does not match finalized item total"
    );
  }
  const entries = [
    {
      id: assertSplit402Id(entryIdFactory(), "ledger entry id"),
      transactionId,
      accountType: "merchant_commission_liability" as const,
      accountReference: batch.merchantId,
      asset: batch.asset,
      amountAtomic: itemTotal.toString()
    },
    ...batch.items.map((item) => ({
      id: assertSplit402Id(entryIdFactory(), "ledger entry id"),
      transactionId,
      accountType: "referrer_payable" as const,
      accountReference: item.destinationWallet,
      asset: batch.asset,
      amountAtomic: negatePositiveAtomic(item.amountAtomic)
    }))
  ];
  assertPayoutLedgerBalances(entries);
  return {
    id: transactionId,
    sourceType: "payout_batch",
    sourceId: batch.id,
    asset: batch.asset,
    entries,
    createdAt
  };
}

export function createPayoutReconciliationItem(
  batch: PayoutBatchRecord,
  transactions: readonly PayoutTransactionRecord[]
): PayoutReconciliationItem | undefined {
  if (batch.status !== "outcome_unknown") {
    return undefined;
  }
  const reconciliationTransactions = transactions.filter(
    isPayoutTransactionOutcomeUnknown
  );
  if (reconciliationTransactions.length === 0) {
    return undefined;
  }
  return {
    batch,
    transactions: reconciliationTransactions,
    reason: "outcome_unknown",
    recommendedAction: "requery_chain_before_retry"
  };
}

export function isPayoutTransactionOutcomeUnknown(
  transaction: PayoutTransactionRecord
): boolean {
  return (
    transaction.status === "outcome_unknown" ||
    transaction.status === "expired"
  );
}

export function createReferrerBalanceSummary(input: {
  referrerWallet: string;
  accruals: readonly CommissionAccrual[];
  payoutBatches: readonly PayoutBatchRecord[];
  asset?: string;
  now?: string;
}): ReferrerBalanceSummary {
  const referrerWallet = assertNonEmptyString(
    input.referrerWallet,
    "referrerWallet"
  );
  const generatedAt = normalizeTimestamp(
    input.now ?? new Date().toISOString(),
    "now"
  );
  const assetsByMint = new Map<
    string,
    {
      pending: bigint;
      available: bigint;
      held: bigint;
      inFlight: bigint;
      paid: bigint;
      total: bigint;
    }
  >();

  for (const item of createReferrerPayoutHistoryItems({
    referrerWallet,
    accruals: input.accruals,
    payoutBatches: input.payoutBatches,
    ...(input.asset === undefined ? {} : { asset: input.asset })
  })) {
    const amount = readAtomicAmount(item.amountAtomic, "amountAtomic");
    const bucket = assetsByMint.get(item.asset) ?? {
      pending: 0n,
      available: 0n,
      held: 0n,
      inFlight: 0n,
      paid: 0n,
      total: 0n
    };
    bucket.total += amount;
    if (item.status === "pending") {
      bucket.pending += amount;
    } else if (item.status === "available") {
      bucket.available += amount;
    } else if (item.status === "held") {
      bucket.held += amount;
    } else if (item.status === "in_flight") {
      bucket.inFlight += amount;
    } else {
      bucket.paid += amount;
    }
    assetsByMint.set(item.asset, bucket);
  }

  return {
    referrerWallet,
    generatedAt,
    assets: Array.from(assetsByMint.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([asset, totals]) => ({
        asset,
        pendingAmountAtomic: serializeAtomicAmount(totals.pending),
        availableAmountAtomic: serializeAtomicAmount(totals.available),
        heldAmountAtomic: serializeAtomicAmount(totals.held),
        inFlightAmountAtomic: serializeAtomicAmount(totals.inFlight),
        paidAmountAtomic: serializeAtomicAmount(totals.paid),
        totalEarnedAmountAtomic: serializeAtomicAmount(totals.total)
      }))
  };
}

export function createReferrerPayoutHistoryItems(input: {
  referrerWallet: string;
  accruals: readonly CommissionAccrual[];
  payoutBatches: readonly PayoutBatchRecord[];
  asset?: string;
  limit?: number;
}): ReferrerPayoutHistoryItem[] {
  const referrerWallet = assertNonEmptyString(
    input.referrerWallet,
    "referrerWallet"
  );
  const limit =
    input.limit === undefined
      ? undefined
      : normalizeReferrerPayoutHistoryLimit(input.limit);
  const payoutIndex = buildPayoutAllocationIndex(input.payoutBatches);
  const items = input.accruals
    .filter((accrual) => accrual.referrerWallet === referrerWallet)
    .filter((accrual) => input.asset === undefined || accrual.asset === input.asset)
    .filter((accrual) => accrual.status !== "rejected" && accrual.status !== "reversed")
    .map((accrual) => {
      const payout = payoutIndex.get(accrual.id);
      const status = readReferrerPayoutHistoryStatus(accrual, payout);
      return {
        accrualId: accrual.id,
        receiptId: accrual.receiptId,
        merchantId: accrual.merchantId,
        campaignId: accrual.campaignId,
        routeId: accrual.routeId,
        referrerWallet: accrual.referrerWallet,
        payoutWallet: accrual.payoutWallet,
        asset: accrual.asset,
        amountAtomic: accrual.amountAtomic,
        status,
        accrualStatus: accrual.status,
        createdAt: normalizeTimestamp(accrual.createdAt, "createdAt"),
        ...(accrual.availableAt === undefined
          ? {}
          : { availableAt: normalizeTimestamp(accrual.availableAt, "availableAt") }),
        ...(payout === undefined
          ? {}
          : {
              payoutBatchId: payout.batch.id,
              payoutItemId: payout.item.id,
              payoutStatus: payout.item.status
            })
      };
    })
    .sort(compareReferrerPayoutHistoryItems);
  return limit === undefined ? items : items.slice(0, limit);
}

export function createMerchantObligationSummary(input: {
  merchantId: string;
  accruals: readonly CommissionAccrual[];
  payoutBatches: readonly PayoutBatchRecord[];
  asset?: string;
  now?: string;
  fundingBalances?: readonly PayoutFundingBalance[];
}): MerchantObligationSummary {
  const merchantId = assertNonEmptyString(input.merchantId, "merchantId");
  const generatedAt = normalizeTimestamp(
    input.now ?? new Date().toISOString(),
    "now"
  );
  const payoutIndex = buildPayoutAllocationIndex(input.payoutBatches);
  const fundingByAsset = buildFundingBalanceMap(input.fundingBalances);
  const assetsByMint = new Map<
    string,
    {
      pending: bigint;
      available: bigint;
      held: bigint;
      inFlight: bigint;
      paid: bigint;
      accrualCount: number;
      pendingCount: number;
      availableCount: number;
      heldCount: number;
      inFlightCount: number;
      paidCount: number;
    }
  >();

  for (const accrual of input.accruals) {
    if (
      accrual.merchantId !== merchantId ||
      accrual.status === "rejected" ||
      accrual.status === "reversed" ||
      (input.asset !== undefined && accrual.asset !== input.asset)
    ) {
      continue;
    }
    const amount = readAtomicAmount(accrual.amountAtomic, "amountAtomic");
    const bucket = assetsByMint.get(accrual.asset) ?? {
      pending: 0n,
      available: 0n,
      held: 0n,
      inFlight: 0n,
      paid: 0n,
      accrualCount: 0,
      pendingCount: 0,
      availableCount: 0,
      heldCount: 0,
      inFlightCount: 0,
      paidCount: 0
    };
    bucket.accrualCount += 1;
    const status = readMerchantObligationStatus(
      accrual,
      payoutIndex.get(accrual.id)
    );
    if (status === "pending") {
      bucket.pending += amount;
      bucket.pendingCount += 1;
    } else if (status === "available") {
      bucket.available += amount;
      bucket.availableCount += 1;
    } else if (status === "held") {
      bucket.held += amount;
      bucket.heldCount += 1;
    } else if (status === "in_flight") {
      bucket.inFlight += amount;
      bucket.inFlightCount += 1;
    } else {
      bucket.paid += amount;
      bucket.paidCount += 1;
    }
    assetsByMint.set(accrual.asset, bucket);
  }

  return {
    schema: "split402.merchant_obligation_summary.v1",
    merchantId,
    generatedAt,
    assets: Array.from(assetsByMint.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([asset, totals]) => {
        const outstanding =
          totals.pending + totals.available + totals.held + totals.inFlight;
        const total = outstanding + totals.paid;
        const fundingAmount = fundingByAsset?.get(asset);
        const fundingDeficit =
          fundingAmount === undefined || fundingAmount >= outstanding
            ? 0n
            : outstanding - fundingAmount;
        const fundingStatus: PayoutFundingStatus =
          fundingAmount === undefined
            ? "unknown"
            : fundingDeficit === 0n
              ? "covered"
              : "deficit";
        return {
          asset,
          fundingStatus,
          ...(fundingAmount === undefined
            ? {}
            : { fundingAmountAtomic: serializeAtomicAmount(fundingAmount) }),
          ...(fundingAmount === undefined
            ? {}
            : { fundingDeficitAtomic: serializeAtomicAmount(fundingDeficit) }),
          pendingAmountAtomic: serializeAtomicAmount(totals.pending),
          availableAmountAtomic: serializeAtomicAmount(totals.available),
          heldAmountAtomic: serializeAtomicAmount(totals.held),
          inFlightAmountAtomic: serializeAtomicAmount(totals.inFlight),
          paidAmountAtomic: serializeAtomicAmount(totals.paid),
          outstandingAmountAtomic: serializeAtomicAmount(outstanding),
          totalAccruedAmountAtomic: serializeAtomicAmount(total),
          accrualCount: totals.accrualCount,
          pendingAccrualCount: totals.pendingCount,
          availableAccrualCount: totals.availableCount,
          heldAccrualCount: totals.heldCount,
          inFlightAccrualCount: totals.inFlightCount,
          paidAccrualCount: totals.paidCount
        };
      })
  };
}

function readPositiveAtomicAmount(value: string, label: string): bigint {
  const amount = readAtomicAmount(value, label);
  if (amount <= 0n) {
    throw new PayoutBatchValidationError(`${label} must be a positive atomic amount`);
  }
  return amount;
}

function negatePositiveAtomic(value: string): string {
  const amount = readPositiveAtomicAmount(value, "amountAtomic");
  return `-${amount.toString()}`;
}

function assertPayoutLedgerBalances(
  entries: readonly LedgerTransaction["entries"][number][]
): void {
  const byAsset = new Map<string, bigint>();
  for (const entry of entries) {
    byAsset.set(entry.asset, (byAsset.get(entry.asset) ?? 0n) + BigInt(entry.amountAtomic));
  }
  const unbalanced = Array.from(byAsset.entries()).filter(([, amount]) => amount !== 0n);
  if (unbalanced.length > 0) {
    throw new PayoutBatchValidationError("payout ledger transaction is not balanced");
  }
}

function readPayoutTransactionFailureMessage(
  transaction: PayoutTransactionRecord
): string {
  const message = transaction.error?.message;
  return typeof message === "string" && message.length > 0
    ? message
    : `payout transaction failed: ${transaction.id}`;
}

function normalizeReferrerPayoutHistoryLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return 50;
  }
  if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
    throw new PayoutBatchValidationError(
      "referrer payout history limit must be between 1 and 500"
    );
  }
  return limit;
}

function readReferrerPayoutHistoryStatus(
  accrual: CommissionAccrual,
  payout:
    | {
        item: PayoutItemRecord;
      }
    | undefined
): ReferrerPayoutHistoryStatus {
  if (payout?.item.status === "finalized") {
    return "paid";
  }
  if (accrual.status === "paid") {
    return "paid";
  }
  if (accrual.status === "pending_chain_verification") {
    return "pending";
  }
  if (accrual.status === "available") {
    return "available";
  }
  if (accrual.status === "held") {
    return "held";
  }
  return "in_flight";
}

function readMerchantObligationStatus(
  accrual: CommissionAccrual,
  payout:
    | {
        item: PayoutItemRecord;
      }
    | undefined
): ReferrerPayoutHistoryStatus {
  return readReferrerPayoutHistoryStatus(accrual, payout);
}

function buildPayoutAllocationIndex(
  batches: readonly PayoutBatchRecord[]
): Map<string, { batch: PayoutBatchRecord; item: PayoutItemRecord }> {
  const byAccrualId = new Map<
    string,
    { batch: PayoutBatchRecord; item: PayoutItemRecord }
  >();
  for (const batch of batches) {
    for (const item of batch.items) {
      for (const allocation of item.allocations) {
        byAccrualId.set(allocation.accrualId, { batch, item });
      }
    }
  }
  return byAccrualId;
}

function compareReferrerPayoutHistoryItems(
  left: ReferrerPayoutHistoryItem,
  right: ReferrerPayoutHistoryItem
): number {
  const created =
    Date.parse(right.createdAt) - Date.parse(left.createdAt);
  return created || left.accrualId.localeCompare(right.accrualId);
}

function createPreviewBatch(input: {
  merchantId: string;
  asset: string;
  itemMap: Map<string, MutablePayoutItem>;
  minimumPayoutAmount: bigint;
  maxRecipients: number | undefined;
  fundingByAsset: Map<string, bigint> | undefined;
  skippedAccruals: PayoutPreviewSkippedAccrual[];
}): PayoutPreviewBatch | undefined {
  const thresholdedItems = Array.from(input.itemMap.values())
    .sort(comparePayoutItems)
    .filter((item) => {
      if (item.amount >= input.minimumPayoutAmount) {
        return true;
      }
      for (const accrualId of item.accrualIds) {
        input.skippedAccruals.push({
          accrualId,
          reason: "below_minimum_threshold"
        });
      }
      return false;
    });
  const selectedItems =
    input.maxRecipients === undefined
      ? thresholdedItems
      : thresholdedItems.slice(0, input.maxRecipients);
  const limitedItems =
    input.maxRecipients === undefined
      ? []
      : thresholdedItems.slice(input.maxRecipients);
  for (const item of limitedItems) {
    for (const accrualId of item.accrualIds) {
      input.skippedAccruals.push({ accrualId, reason: "recipient_limit" });
    }
  }
  if (selectedItems.length === 0) {
    return undefined;
  }

  const totalAmount = selectedItems.reduce(
    (total, item) => total + item.amount,
    0n
  );
  const fundingAmount =
    input.fundingByAsset === undefined
      ? undefined
      : input.fundingByAsset.get(input.asset) ?? 0n;
  const fundingDeficit =
    fundingAmount === undefined ? undefined : maxBigInt(0n, totalAmount - fundingAmount);
  const fundingStatus: PayoutFundingStatus =
    fundingAmount === undefined
      ? "unknown"
      : fundingDeficit === 0n
        ? "covered"
        : "deficit";

  return {
    merchantId: input.merchantId,
    asset: input.asset,
    totalAmountAtomic: serializeAtomicAmount(totalAmount),
    itemCount: selectedItems.length,
    accrualCount: selectedItems.reduce(
      (total, item) => total + item.accrualIds.length,
      0
    ),
    fundingStatus,
    ...(fundingAmount === undefined
      ? {}
      : { fundingAmountAtomic: serializeAtomicAmount(fundingAmount) }),
    ...(fundingDeficit === undefined
      ? {}
      : { fundingDeficitAtomic: serializeAtomicAmount(fundingDeficit) }),
    items: selectedItems.map(toPreviewItem)
  };
}

function toPreviewItem(item: MutablePayoutItem): PayoutPreviewItem {
  const sortedAvailableTimes = [...item.availableTimes].sort();
  const oldestAvailableAt = sortedAvailableTimes[0];
  const newestAvailableAt =
    sortedAvailableTimes.length === 0
      ? undefined
      : sortedAvailableTimes[sortedAvailableTimes.length - 1];
  return {
    destinationWallet: item.destinationWallet,
    referrerWallets: Array.from(item.referrerWallets).sort(),
    amountAtomic: serializeAtomicAmount(item.amount),
    accrualIds: [...item.accrualIds].sort(),
    ...(oldestAvailableAt === undefined ? {} : { oldestAvailableAt }),
    ...(newestAvailableAt === undefined ? {} : { newestAvailableAt })
  };
}

function buildFundingBalanceMap(
  balances: readonly PayoutFundingBalance[] | undefined
): Map<string, bigint> | undefined {
  if (balances === undefined) {
    return undefined;
  }
  const byAsset = new Map<string, bigint>();
  for (const balance of balances) {
    const asset = assertNonEmptyString(balance.asset, "fundingBalances.asset");
    const amount = readAtomicAmount(
      balance.amountAtomic,
      "fundingBalances.amountAtomic"
    );
    byAsset.set(asset, (byAsset.get(asset) ?? 0n) + amount);
  }
  return byAsset;
}

function compareAccrualsForPayout(
  left: CommissionAccrual,
  right: CommissionAccrual
): number {
  return (
    left.asset.localeCompare(right.asset) ||
    left.payoutWallet.localeCompare(right.payoutWallet) ||
    compareOptionalTimestamp(left.availableAt, right.availableAt) ||
    compareOptionalTimestamp(left.createdAt, right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

function comparePayoutItems(
  left: MutablePayoutItem,
  right: MutablePayoutItem
): number {
  const oldestAvailable =
    compareOptionalTimestamp(
      [...left.availableTimes].sort()[0],
      [...right.availableTimes].sort()[0]
    );
  if (oldestAvailable !== 0) {
    return oldestAvailable;
  }
  if (right.amount !== left.amount) {
    return right.amount > left.amount ? 1 : -1;
  }
  return left.destinationWallet.localeCompare(right.destinationWallet);
}

function compareOptionalTimestamp(
  left: string | undefined,
  right: string | undefined
): number {
  if (left === undefined && right === undefined) {
    return 0;
  }
  if (left === undefined) {
    return -1;
  }
  if (right === undefined) {
    return 1;
  }
  return (
    Date.parse(normalizeTimestamp(left, "timestamp")) -
    Date.parse(normalizeTimestamp(right, "timestamp"))
  );
}

function readAtomicAmount(value: string, label: string): bigint {
  try {
    return parseAtomicAmount(value);
  } catch {
    throw new PayoutPreviewValidationError(
      `${label} must be a non-negative decimal atomic amount`
    );
  }
}

function readOptionalPositiveInteger(
  value: number | undefined,
  label: string
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new PayoutPreviewValidationError(`${label} must be a positive integer`);
  }
  return value;
}

function assertNonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new PayoutBatchValidationError(`${label} must be a non-negative integer`);
  }
  return value;
}

function assertPositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new PayoutBatchValidationError(`${label} must be a positive integer`);
  }
  return value;
}

function readSignedPayoutTransactionItems(
  items: readonly SaveSignedPayoutTransactionItemInput[] | undefined,
  payoutTransactionId: string
): PayoutTransactionItemRecord[] {
  if (items === undefined) {
    return [];
  }
  return items.map((item) => ({
    payoutTransactionId,
    payoutItemId: assertSplit402Id(
      item.payoutItemId,
      "payout transaction payoutItemId"
    ),
    amountAtomic: readPositiveAtomicAmount(
      item.amountAtomic,
      "payout transaction item amountAtomic"
    ).toString(),
    destinationWallet: assertNonEmptyString(
      item.destinationWallet,
      "payout transaction item destinationWallet"
    ),
    ...(item.destinationTokenAccount === undefined
      ? {}
      : {
          destinationTokenAccount: assertNonEmptyString(
            item.destinationTokenAccount,
            "payout transaction item destinationTokenAccount"
          )
        })
  }));
}

function latestAttemptBySequence(
  transactions: readonly PayoutTransactionRecord[]
): PayoutTransactionRecord[] {
  const bySequence = new Map<number, PayoutTransactionRecord>();
  for (const transaction of transactions) {
    const existing = bySequence.get(transaction.sequence);
    if (
      existing === undefined ||
      transaction.attempt > existing.attempt ||
      (transaction.attempt === existing.attempt &&
        transaction.createdAt.localeCompare(existing.createdAt) > 0)
    ) {
      bySequence.set(transaction.sequence, transaction);
    }
  }
  return Array.from(bySequence.values()).sort(
    (left, right) =>
      left.sequence - right.sequence ||
      left.attempt - right.attempt ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id)
  );
}

function payoutItemStatusForTransactionStatus(
  status: PayoutTransactionStatus
): PayoutItemStatus | undefined {
  switch (status) {
    case "submitted":
      return "submitted";
    case "confirmed":
      return "confirmed";
    case "finalized":
      return "finalized";
    case "failed":
      return "failed";
    case "planned":
    case "signed":
    case "expired":
    case "outcome_unknown":
      return undefined;
  }
}

function normalizeTimestamp(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PayoutPreviewValidationError(`${label} must be an ISO timestamp`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new PayoutPreviewValidationError(`${label} must be an ISO timestamp`);
  }
  return new Date(timestamp).toISOString();
}

function assertNonEmptyString(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PayoutPreviewValidationError(`${label} must be a non-empty string`);
  }
  return value;
}

function assertBase64String(value: string, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)
  ) {
    throw new PayoutBatchValidationError(`${label} must be base64`);
  }
  return value;
}

function assertSplit402Id(value: string, label: string): string {
  if (!/^[a-z]{3}_[0-9a-f]{32,}$/u.test(value)) {
    throw new PayoutBatchValidationError(`${label} must be a Split402 id`);
  }
  return value;
}

function createPayoutBatchId(): string {
  return `pbt_${randomBytes(16).toString("hex")}`;
}

function createPayoutItemId(): string {
  return `pit_${randomBytes(16).toString("hex")}`;
}

function createPayoutTransactionId(): string {
  return `ptx_${randomBytes(16).toString("hex")}`;
}

function createLedgerTransactionId(): string {
  return `ldg_${randomBytes(16).toString("hex")}`;
}

function createLedgerEntryId(): string {
  return `lde_${randomBytes(16).toString("hex")}`;
}

function readAttempt(transaction: SaveSignedPayoutTransactionInput): number {
  return transaction.attempt ?? 1;
}

function maxBigInt(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}
