import {
  Split402ReceiptV1Schema,
  type Split402ReceiptV1
} from "@split402/protocol";
import type { QueryResult, QueryResultRow } from "pg";

import { ReceiptIngestionPersistenceConflictError } from "./errors.js";
import type {
  AccrualStatus,
  CommissionAccrual,
  LedgerAccountType,
  LedgerEntry,
  LedgerTransaction,
  ReceiptIngestSource,
  ReceiptIngestionSnapshot,
  ReceiptIngestionStore,
  ReceiptRecord,
  ReceiptVerificationState
} from "./index.js";

export interface PostgresQueryExecutor {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<QueryResult<Row>>;
}

export interface PostgresTransactionClient extends PostgresQueryExecutor {
  release(): void;
}

export interface PostgresPool extends PostgresQueryExecutor {
  connect(): Promise<PostgresTransactionClient>;
}

interface PaymentReceiptRow extends QueryResultRow {
  id: string;
  receipt_hash: `sha256:${string}`;
  receipt_json: unknown;
  source: string;
  verification_state: string;
  ingestion_state: string;
  created_at: Date | string;
}

interface CommissionAccrualRow extends QueryResultRow {
  id: string;
  receipt_id: string;
  merchant_id: string;
  campaign_id: string;
  route_id: string;
  referrer_wallet: string;
  payout_wallet: string;
  asset_mint: string;
  amount_atomic: string;
  status: string;
  created_at: Date | string;
}

interface LedgerTransactionRow extends QueryResultRow {
  id: string;
  source_type: string;
  source_id: string;
  asset_mint: string;
  created_at: Date | string;
}

interface LedgerEntryRow extends QueryResultRow {
  id: string;
  transaction_id: string;
  account_type: string;
  account_reference: string;
  asset_mint: string;
  amount_atomic: string;
}

export class PostgresReceiptIngestionStore implements ReceiptIngestionStore {
  constructor(private readonly db: PostgresPool | PostgresQueryExecutor) {}

  async getByReceiptId(
    receiptId: string
  ): Promise<ReceiptIngestionSnapshot | undefined> {
    return this.loadSnapshot("id = $1", [receiptId]);
  }

  async getByReceiptHash(
    receiptHash: `sha256:${string}`
  ): Promise<ReceiptIngestionSnapshot | undefined> {
    return this.loadSnapshot("receipt_hash = $1", [receiptHash]);
  }

  async getByPaymentId(
    paymentId: string
  ): Promise<ReceiptIngestionSnapshot | undefined> {
    return this.loadSnapshot("payment_id = $1", [paymentId]);
  }

  async getBySettlementTxSignature(
    signature: string
  ): Promise<ReceiptIngestionSnapshot | undefined> {
    return this.loadSnapshot("settlement_tx_signature = $1", [signature]);
  }

  async save(snapshot: ReceiptIngestionSnapshot): Promise<void> {
    await this.withTransaction(async (client) => {
      await insertReceipt(client, snapshot.receipt);

      if (snapshot.accrual === undefined) {
        return;
      }

      await insertAccrual(client, snapshot.accrual);

      if (snapshot.ledgerTransaction === undefined) {
        return;
      }

      await insertLedgerTransaction(client, snapshot.ledgerTransaction);
      for (const entry of snapshot.ledgerTransaction.entries) {
        await insertLedgerEntry(client, entry);
      }
    });
  }

  private async loadSnapshot(
    whereClause: string,
    values: readonly unknown[]
  ): Promise<ReceiptIngestionSnapshot | undefined> {
    const receiptResult = await this.db.query<PaymentReceiptRow>(
      `select id, receipt_hash, receipt_json, source, verification_state, ingestion_state, created_at
         from payment_receipts
        where ${whereClause}
        limit 1`,
      values
    );
    const receiptRow = receiptResult.rows[0];
    if (receiptRow === undefined) {
      return undefined;
    }

    const receiptRecord = mapReceiptRecord(receiptRow);
    const accrual = await this.loadAccrual(receiptRecord.id);
    if (accrual === undefined) {
      return { receipt: receiptRecord };
    }

    const ledgerTransaction = await this.loadLedgerTransaction(accrual.id);
    return {
      receipt: receiptRecord,
      accrual,
      ...(ledgerTransaction === undefined ? {} : { ledgerTransaction })
    };
  }

  private async loadAccrual(
    receiptId: string
  ): Promise<CommissionAccrual | undefined> {
    const accrualResult = await this.db.query<CommissionAccrualRow>(
      `select id, receipt_id, merchant_id, campaign_id, route_id, referrer_wallet,
              payout_wallet, asset_mint, amount_atomic, status, created_at
         from commission_accruals
        where receipt_id = $1
        limit 1`,
      [receiptId]
    );
    const row = accrualResult.rows[0];
    return row === undefined ? undefined : mapAccrual(row);
  }

  private async loadLedgerTransaction(
    accrualId: string
  ): Promise<LedgerTransaction | undefined> {
    const transactionResult = await this.db.query<LedgerTransactionRow>(
      `select id, source_type, source_id, asset_mint, created_at
         from ledger_transactions
        where source_type = 'commission_accrual'
          and source_id = $1
        limit 1`,
      [accrualId]
    );
    const row = transactionResult.rows[0];
    if (row === undefined) {
      return undefined;
    }

    const entriesResult = await this.db.query<LedgerEntryRow>(
      `select id, transaction_id, account_type, account_reference, asset_mint,
              amount_atomic
         from ledger_entries
        where transaction_id = $1
        order by created_at, id`,
      [row.id]
    );

    return mapLedgerTransaction(row, entriesResult.rows.map(mapLedgerEntry));
  }

  private async withTransaction(
    operation: (client: PostgresQueryExecutor) => Promise<void>
  ): Promise<void> {
    const client = await this.createTransactionClient();
    let transactionStarted = false;
    try {
      await client.query("begin");
      transactionStarted = true;
      await operation(client);
      await client.query("commit");
    } catch (error) {
      if (transactionStarted) {
        await rollbackQuietly(client);
      }
      throw mapWriteError(error);
    } finally {
      client.release?.();
    }
  }

  private async createTransactionClient(): Promise<
    PostgresQueryExecutor & { release?: () => void }
  > {
    if (isPostgresPool(this.db)) {
      return this.db.connect();
    }
    return this.db;
  }
}

function insertReceipt(
  client: PostgresQueryExecutor,
  receiptRecord: ReceiptRecord
): Promise<QueryResult> {
  const receipt = receiptRecord.receipt;
  return client.query(
    `insert into payment_receipts (
       id, receipt_hash, merchant_id, campaign_id, campaign_version, payment_id,
       settlement_tx_signature, network, asset_mint, payer_wallet, pay_to_wallet,
       receipt_json, source, verification_state, ingestion_state, created_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16
     )`,
    [
      receiptRecord.id,
      receiptRecord.receiptHash,
      receipt.merchantId,
      receipt.campaignId,
      receipt.campaignVersion,
      receipt.paymentId,
      receipt.settlementTxSignature,
      receipt.network,
      receipt.asset,
      receipt.payerWallet,
      receipt.payToWallet,
      JSON.stringify(receiptRecord.receipt),
      receiptRecord.source,
      receiptRecord.verificationState,
      receiptRecord.ingestionState,
      receiptRecord.createdAt
    ]
  );
}

function insertAccrual(
  client: PostgresQueryExecutor,
  accrual: CommissionAccrual
): Promise<QueryResult> {
  return client.query(
    `insert into commission_accruals (
       id, receipt_id, merchant_id, campaign_id, route_id, referrer_wallet,
       payout_wallet, asset_mint, amount_atomic, status, created_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
     )`,
    [
      accrual.id,
      accrual.receiptId,
      accrual.merchantId,
      accrual.campaignId,
      accrual.routeId,
      accrual.referrerWallet,
      accrual.payoutWallet,
      accrual.asset,
      accrual.amountAtomic,
      accrual.status,
      accrual.createdAt
    ]
  );
}

function insertLedgerTransaction(
  client: PostgresQueryExecutor,
  transaction: LedgerTransaction
): Promise<QueryResult> {
  return client.query(
    `insert into ledger_transactions (
       id, source_type, source_id, asset_mint, created_at
     ) values (
       $1, $2, $3, $4, $5
     )`,
    [
      transaction.id,
      transaction.sourceType,
      transaction.sourceId,
      transaction.asset,
      transaction.createdAt
    ]
  );
}

function insertLedgerEntry(
  client: PostgresQueryExecutor,
  entry: LedgerEntry
): Promise<QueryResult> {
  return client.query(
    `insert into ledger_entries (
       id, transaction_id, account_type, account_reference, asset_mint,
       amount_atomic
     ) values (
       $1, $2, $3, $4, $5, $6
     )`,
    [
      entry.id,
      entry.transactionId,
      entry.accountType,
      entry.accountReference,
      entry.asset,
      entry.amountAtomic
    ]
  );
}

function mapReceiptRecord(row: PaymentReceiptRow): ReceiptRecord {
  const parsedReceipt = parseReceiptJson(row.receipt_json);
  return {
    id: row.id,
    receiptHash: row.receipt_hash,
    receipt: parsedReceipt,
    source: readReceiptSource(row.source),
    verificationState: readReceiptVerificationState(row.verification_state),
    ingestionState: readIngestionState(row.ingestion_state),
    createdAt: toIsoString(row.created_at)
  };
}

function mapAccrual(row: CommissionAccrualRow): CommissionAccrual {
  return {
    id: row.id,
    receiptId: row.receipt_id,
    merchantId: row.merchant_id,
    campaignId: row.campaign_id,
    routeId: row.route_id,
    referrerWallet: row.referrer_wallet,
    payoutWallet: row.payout_wallet,
    asset: row.asset_mint,
    amountAtomic: row.amount_atomic,
    status: readAccrualStatus(row.status),
    createdAt: toIsoString(row.created_at)
  };
}

function mapLedgerTransaction(
  row: LedgerTransactionRow,
  entries: LedgerEntry[]
): LedgerTransaction {
  if (row.source_type !== "commission_accrual") {
    throw new Error(`unsupported ledger source type: ${row.source_type}`);
  }

  return {
    id: row.id,
    sourceType: "commission_accrual",
    sourceId: row.source_id,
    asset: row.asset_mint,
    entries,
    createdAt: toIsoString(row.created_at)
  };
}

function mapLedgerEntry(row: LedgerEntryRow): LedgerEntry {
  return {
    id: row.id,
    transactionId: row.transaction_id,
    accountType: readLedgerAccountType(row.account_type),
    accountReference: row.account_reference,
    asset: row.asset_mint,
    amountAtomic: row.amount_atomic
  };
}

function parseReceiptJson(value: unknown): Split402ReceiptV1 {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return Split402ReceiptV1Schema.parse(parsed);
}

function readReceiptSource(value: string): ReceiptIngestSource {
  if (
    value === "buyer" ||
    value === "merchant" ||
    value === "relay" ||
    value === "unknown"
  ) {
    return value;
  }
  throw new Error(`unsupported receipt source: ${value}`);
}

function readReceiptVerificationState(value: string): ReceiptVerificationState {
  if (value === "signature_verified" || value === "pending_chain_verification") {
    return value;
  }
  throw new Error(`unsupported receipt verification state: ${value}`);
}

function readIngestionState(value: string): "accepted" {
  if (value === "accepted") {
    return value;
  }
  throw new Error(`unsupported receipt ingestion state: ${value}`);
}

function readAccrualStatus(value: string): AccrualStatus {
  if (
    value === "pending_chain_verification" ||
    value === "available" ||
    value === "held"
  ) {
    return value;
  }
  throw new Error(`unsupported accrual status: ${value}`);
}

function readLedgerAccountType(value: string): LedgerAccountType {
  if (
    value === "merchant_commission_liability" ||
    value === "referrer_payable" ||
    value === "protocol_fee_payable"
  ) {
    return value;
  }
  throw new Error(`unsupported ledger account type: ${value}`);
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function isPostgresPool(value: unknown): value is PostgresPool {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { connect?: unknown }).connect === "function"
  );
}

async function rollbackQuietly(client: PostgresQueryExecutor): Promise<void> {
  try {
    await client.query("rollback");
  } catch {
    // Ignore rollback failures so the original write error is preserved.
  }
}

function mapWriteError(error: unknown): unknown {
  return isUniqueViolation(error)
    ? new ReceiptIngestionPersistenceConflictError(error)
    : error;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "23505"
  );
}
