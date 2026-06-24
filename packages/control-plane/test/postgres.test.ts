import {
  createSampleProtocolArtifacts,
  type Split402ReceiptV1
} from "@split402/protocol";
import type { QueryResult, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";

import {
  InMemoryReceiptIngestionStore,
  PostgresReceiptIngestionStore,
  ReceiptIngestionPersistenceConflictError,
  ReceiptIngestor,
  type PostgresPool,
  type PostgresTransactionClient,
  type ReceiptIngestionSnapshot
} from "../src/index.js";

describe("PostgresReceiptIngestionStore", () => {
  it("persists and loads a credited receipt snapshot", async () => {
    const bundle = createSampleProtocolArtifacts();
    const fakePool = new FakePostgresPool();
    const store = new PostgresReceiptIngestionStore(fakePool);
    const ingestor = new ReceiptIngestor(store, {
      resolveMerchantPublicKey: () => bundle.keys.merchantPublicKey,
      now: () => new Date("2026-06-24T00:02:00Z")
    });

    const result = await ingestor.ingest({
      receipt: bundle.artifacts.receipt,
      source: "buyer"
    });
    const loaded = await store.getByReceiptId(bundle.artifacts.receipt.receiptId);

    expect(result.status).toBe("created");
    expect(fakePool.client.commands).toEqual(
      expect.arrayContaining(["begin", "commit"])
    );
    expect(fakePool.client.rollbackCount).toBe(0);
    expect(fakePool.client.releaseCount).toBe(1);
    expect(loaded?.receipt.id).toBe(bundle.artifacts.receipt.receiptId);
    expect(loaded?.receipt.source).toBe("buyer");
    expect(loaded?.accrual).toEqual(
      expect.objectContaining({
        receiptId: bundle.artifacts.receipt.receiptId,
        amountAtomic: "2000"
      })
    );
    expect(loaded?.ledgerTransaction?.entries).toHaveLength(3);
  });

  it("persists receipt snapshots without accrual or ledger rows", async () => {
    const bundle = createSampleProtocolArtifacts();
    const fakePool = new FakePostgresPool();
    const store = new PostgresReceiptIngestionStore(fakePool);
    const snapshot = await createSnapshot(bundle.artifacts.receipt);
    const zeroSnapshot: ReceiptIngestionSnapshot = {
      receipt: snapshot.receipt
    };

    await store.save(zeroSnapshot);
    const loaded = await store.getByReceiptHash(snapshot.receipt.receiptHash);

    expect(loaded?.receipt.id).toBe(snapshot.receipt.id);
    expect(loaded?.accrual).toBeUndefined();
    expect(loaded?.ledgerTransaction).toBeUndefined();
    expect(fakePool.database.accruals).toHaveLength(0);
    expect(fakePool.database.ledgerTransactions).toHaveLength(0);
    expect(fakePool.database.ledgerEntries).toHaveLength(0);
  });

  it("rolls back and maps unique violations to persistence conflicts", async () => {
    const bundle = createSampleProtocolArtifacts();
    const fakePool = new FakePostgresPool();
    fakePool.database.failNextInsertWithUniqueViolation = true;
    const store = new PostgresReceiptIngestionStore(fakePool);
    const snapshot = await createSnapshot(bundle.artifacts.receipt);

    await expect(store.save(snapshot)).rejects.toBeInstanceOf(
      ReceiptIngestionPersistenceConflictError
    );
    expect(fakePool.client.rollbackCount).toBe(1);
    expect(fakePool.client.releaseCount).toBe(1);
    expect(fakePool.database.receipts).toHaveLength(0);
  });
});

async function createSnapshot(
  receipt: Split402ReceiptV1
): Promise<ReceiptIngestionSnapshot> {
  const bundle = createSampleProtocolArtifacts();
  const store = new InMemoryReceiptIngestionStore();
  const ingestor = new ReceiptIngestor(store, {
    resolveMerchantPublicKey: () => bundle.keys.merchantPublicKey,
    now: () => new Date("2026-06-24T00:02:00Z")
  });
  const result = await ingestor.ingest({ receipt, source: "buyer" });
  if (result.status !== "created") {
    throw new Error("expected snapshot creation");
  }
  return result;
}

class FakePostgresPool implements PostgresPool {
  readonly database = new FakePostgresDatabase();
  readonly client = new FakePostgresClient(this.database);

  async connect(): Promise<PostgresTransactionClient> {
    return this.client;
  }

  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<QueryResult<Row>> {
    return this.client.query<Row>(text, values);
  }
}

class FakePostgresClient implements PostgresTransactionClient {
  readonly commands: string[] = [];
  releaseCount = 0;
  rollbackCount = 0;

  constructor(private readonly database: FakePostgresDatabase) {}

  release(): void {
    this.releaseCount += 1;
  }

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<QueryResult<Row>> {
    const normalized = normalizeSql(text);
    this.commands.push(normalized);

    if (normalized === "begin") {
      return result([]);
    }
    if (normalized === "commit") {
      return result([]);
    }
    if (normalized === "rollback") {
      this.rollbackCount += 1;
      return result([]);
    }

    if (normalized.startsWith("insert into payment_receipts")) {
      this.database.insertReceipt(values);
      return result([]);
    }
    if (normalized.startsWith("insert into commission_accruals")) {
      this.database.insertAccrual(values);
      return result([]);
    }
    if (normalized.startsWith("insert into ledger_transactions")) {
      this.database.insertLedgerTransaction(values);
      return result([]);
    }
    if (normalized.startsWith("insert into ledger_entries")) {
      this.database.insertLedgerEntry(values);
      return result([]);
    }
    if (normalized.includes("from payment_receipts")) {
      return result(this.database.selectReceipt(normalized, values) as unknown as Row[]);
    }
    if (normalized.includes("from commission_accruals")) {
      return result(this.database.selectAccrual(values[0]) as unknown as Row[]);
    }
    if (normalized.includes("from ledger_transactions")) {
      return result(
        this.database.selectLedgerTransaction(values[0]) as unknown as Row[]
      );
    }
    if (normalized.includes("from ledger_entries")) {
      return result(this.database.selectLedgerEntries(values[0]) as unknown as Row[]);
    }

    throw new Error(`unsupported query: ${normalized}`);
  }
}

class FakePostgresDatabase {
  receipts: StoredReceiptRow[] = [];
  accruals: StoredAccrualRow[] = [];
  ledgerTransactions: StoredLedgerTransactionRow[] = [];
  ledgerEntries: StoredLedgerEntryRow[] = [];
  failNextInsertWithUniqueViolation = false;

  insertReceipt(values: readonly unknown[]): void {
    if (this.failNextInsertWithUniqueViolation) {
      this.failNextInsertWithUniqueViolation = false;
      throw Object.assign(new Error("duplicate key"), { code: "23505" });
    }

    this.receipts.push({
      id: readString(values[0]),
      receipt_hash: readString(values[1]) as `sha256:${string}`,
      merchant_id: readString(values[2]),
      campaign_id: readString(values[3]),
      campaign_version: readNumber(values[4]),
      payment_id: readString(values[5]),
      settlement_tx_signature: readString(values[6]),
      network: readString(values[7]),
      asset_mint: readString(values[8]),
      payer_wallet: readString(values[9]),
      pay_to_wallet: readString(values[10]),
      receipt_json: readString(values[11]),
      source: readString(values[12]),
      verification_state: readString(values[13]),
      ingestion_state: readString(values[14]),
      created_at: readString(values[15])
    });
  }

  insertAccrual(values: readonly unknown[]): void {
    this.accruals.push({
      id: readString(values[0]),
      receipt_id: readString(values[1]),
      merchant_id: readString(values[2]),
      campaign_id: readString(values[3]),
      route_id: readString(values[4]),
      referrer_wallet: readString(values[5]),
      payout_wallet: readString(values[6]),
      asset_mint: readString(values[7]),
      amount_atomic: readString(values[8]),
      status: readString(values[9]),
      created_at: readString(values[10])
    });
  }

  insertLedgerTransaction(values: readonly unknown[]): void {
    this.ledgerTransactions.push({
      id: readString(values[0]),
      source_type: readString(values[1]),
      source_id: readString(values[2]),
      asset_mint: readString(values[3]),
      created_at: readString(values[4])
    });
  }

  insertLedgerEntry(values: readonly unknown[]): void {
    this.ledgerEntries.push({
      id: readString(values[0]),
      transaction_id: readString(values[1]),
      account_type: readString(values[2]),
      account_reference: readString(values[3]),
      asset_mint: readString(values[4]),
      amount_atomic: readString(values[5]),
      created_at: "2026-06-24T00:02:00Z"
    });
  }

  selectReceipt(
    normalizedSql: string,
    values: readonly unknown[]
  ): StoredReceiptRow[] {
    const value = readString(values[0]);
    const receipt = this.receipts.find((row) => {
      if (normalizedSql.includes("where id = $1")) {
        return row.id === value;
      }
      if (normalizedSql.includes("where receipt_hash = $1")) {
        return row.receipt_hash === value;
      }
      if (normalizedSql.includes("where payment_id = $1")) {
        return row.payment_id === value;
      }
      if (normalizedSql.includes("where settlement_tx_signature = $1")) {
        return row.settlement_tx_signature === value;
      }
      return false;
    });
    return receipt === undefined ? [] : [receipt];
  }

  selectAccrual(receiptId: unknown): StoredAccrualRow[] {
    const accrual = this.accruals.find(
      (row) => row.receipt_id === readString(receiptId)
    );
    return accrual === undefined ? [] : [accrual];
  }

  selectLedgerTransaction(accrualId: unknown): StoredLedgerTransactionRow[] {
    const transaction = this.ledgerTransactions.find(
      (row) =>
        row.source_type === "commission_accrual" &&
        row.source_id === readString(accrualId)
    );
    return transaction === undefined ? [] : [transaction];
  }

  selectLedgerEntries(transactionId: unknown): StoredLedgerEntryRow[] {
    return this.ledgerEntries.filter(
      (row) => row.transaction_id === readString(transactionId)
    );
  }
}

type StoredReceiptRow = QueryResultRow & {
  id: string;
  receipt_hash: `sha256:${string}`;
  merchant_id: string;
  campaign_id: string;
  campaign_version: number;
  payment_id: string;
  settlement_tx_signature: string;
  network: string;
  asset_mint: string;
  payer_wallet: string;
  pay_to_wallet: string;
  receipt_json: string;
  source: string;
  verification_state: string;
  ingestion_state: string;
  created_at: string;
};

type StoredAccrualRow = QueryResultRow & {
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
  created_at: string;
};

type StoredLedgerTransactionRow = QueryResultRow & {
  id: string;
  source_type: string;
  source_id: string;
  asset_mint: string;
  created_at: string;
};

type StoredLedgerEntryRow = QueryResultRow & {
  id: string;
  transaction_id: string;
  account_type: string;
  account_reference: string;
  asset_mint: string;
  amount_atomic: string;
  created_at: string;
};

function result<Row extends QueryResultRow>(rows: Row[]): QueryResult<Row> {
  return {
    command: rows.length === 0 ? "INSERT" : "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows
  };
}

function normalizeSql(text: string): string {
  return text.replace(/\s+/gu, " ").trim().toLowerCase();
}

function readString(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("expected string query value");
  }
  return value;
}

function readNumber(value: unknown): number {
  if (typeof value !== "number") {
    throw new Error("expected number query value");
  }
  return value;
}
