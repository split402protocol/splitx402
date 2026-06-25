import { parseAtomicAmount, serializeAtomicAmount } from "@split402/protocol";
import { randomBytes } from "node:crypto";

import type { CommissionAccrual } from "./index.js";

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
}

export interface PayoutBatchFinalityRollup {
  batchStatus: PayoutBatchStatus;
  itemStatus?: PayoutItemStatus;
  failureCode?: string;
  failureMessage?: string;
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

      return {
        id: assertSplit402Id(
          transaction.id ?? idFactory(),
          "payout transaction id"
        ),
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
        createdAt
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

function readPayoutTransactionFailureMessage(
  transaction: PayoutTransactionRecord
): string {
  const message = transaction.error?.message;
  return typeof message === "string" && message.length > 0
    ? message
    : `payout transaction failed: ${transaction.id}`;
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

function readAttempt(transaction: SaveSignedPayoutTransactionInput): number {
  return transaction.attempt ?? 1;
}

function maxBigInt(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}
