import { hashProtocolObject } from "../packages/protocol/src/canonical.js";

export interface Phase6DestinationAmountListPlan {
  batchId: string;
  network: string;
  asset: string;
  tokenProgramId: string;
  sourceTokenAccount: string;
  transactions: Phase6DestinationAmountListTransaction[];
}

export interface Phase6DestinationAmountListTransaction {
  index: number;
  items: Phase6DestinationAmountListItem[];
}

export interface Phase6DestinationAmountListItem {
  payoutItemId: string;
  destinationWallet: string;
  destinationTokenAccount: string;
  amountAtomic: string;
}

export function hashPhase6DestinationAmountList(
  value: unknown,
): `sha256:${string}` {
  const plan = readDestinationAmountListPlan(value);
  return hashProtocolObject({
    schema: "split402.solana.payout.destination_amount_list.v1",
    batchId: plan.batchId,
    network: plan.network,
    asset: plan.asset,
    tokenProgramId: plan.tokenProgramId,
    sourceTokenAccount: plan.sourceTokenAccount,
    transactions: plan.transactions.map((transaction) => ({
      index: transaction.index,
      items: transaction.items.map((item) => ({
        payoutItemId: item.payoutItemId,
        destinationWallet: item.destinationWallet,
        destinationTokenAccount: item.destinationTokenAccount,
        amountAtomic: item.amountAtomic,
      })),
    })),
  });
}

export function readDestinationAmountListPlan(
  value: unknown,
): Phase6DestinationAmountListPlan {
  const record = readRecord(value, "plan");
  const transactions = readArray(record.transactions, "transactions").map(
    (transaction, index) =>
      readDestinationAmountListTransaction(transaction, `transactions[${index}]`),
  );
  if (transactions.length === 0) {
    throw new Error("transactions must include at least one transaction");
  }

  return {
    batchId: readNonEmptyString(record.batchId, "batchId"),
    network: readNonEmptyString(record.network, "network"),
    asset: readNonEmptyString(record.asset, "asset"),
    tokenProgramId: readNonEmptyString(record.tokenProgramId, "tokenProgramId"),
    sourceTokenAccount: readNonEmptyString(
      record.sourceTokenAccount,
      "sourceTokenAccount",
    ),
    transactions,
  };
}

function readDestinationAmountListTransaction(
  value: unknown,
  label: string,
): Phase6DestinationAmountListTransaction {
  const record = readRecord(value, label);
  const items = readArray(record.items, `${label}.items`).map((item, index) =>
    readDestinationAmountListItem(item, `${label}.items[${index}]`),
  );
  if (items.length === 0) {
    throw new Error(`${label}.items must include at least one item`);
  }

  return {
    index: readNonNegativeInteger(record.index, `${label}.index`),
    items,
  };
}

function readDestinationAmountListItem(
  value: unknown,
  label: string,
): Phase6DestinationAmountListItem {
  const record = readRecord(value, label);
  return {
    payoutItemId: readNonEmptyString(record.payoutItemId, `${label}.payoutItemId`),
    destinationWallet: readNonEmptyString(
      record.destinationWallet,
      `${label}.destinationWallet`,
    ),
    destinationTokenAccount: readNonEmptyString(
      record.destinationTokenAccount,
      `${label}.destinationTokenAccount`,
    ),
    amountAtomic: readPositiveAtomicAmount(
      record.amountAtomic,
      `${label}.amountAtomic`,
    ),
  };
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function readArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

function readNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function readNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || typeof value !== "number" || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

function readPositiveAtomicAmount(value: unknown, label: string): string {
  const amount = readNonEmptyString(value, label);
  if (!/^[1-9][0-9]*$/u.test(amount)) {
    throw new Error(`${label} must be a positive atomic amount`);
  }
  return amount;
}
