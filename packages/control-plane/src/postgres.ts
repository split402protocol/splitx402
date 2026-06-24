import {
  Base58PublicKeySchema,
  Split402ReceiptV1Schema,
  Split402IdSchema,
  createPrefixedId,
  type Split402ReceiptV1
} from "@split402/protocol";
import type { QueryResult, QueryResultRow } from "pg";

import type {
  AuthenticatedWalletSession,
  WalletAuthChallengeRecord,
  WalletAuthStore
} from "./auth.js";
import { ReceiptIngestionPersistenceConflictError } from "./errors.js";
import {
  MerchantRegistryConflictError,
  MerchantRegistryValidationError,
  type AddMerchantKeyInput,
  type AddMerchantOriginInput,
  type CreateMerchantInput,
  type MerchantKeyAlgorithm,
  type MerchantKeyPurpose,
  type MerchantKeyRecord,
  type MerchantOriginRecord,
  type MerchantOriginStatus,
  type MerchantOriginVerificationMethod,
  type MerchantProfile,
  type MerchantRecord,
  type MerchantRegistry,
  type MerchantStatus,
  type ResolveMerchantKeyInput,
  type RevokeMerchantKeyInput
} from "./merchants.js";
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

interface MerchantRow extends QueryResultRow {
  id: string;
  slug: string;
  display_name: string;
  owner_wallet: string;
  status: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface MerchantOriginRow extends QueryResultRow {
  merchant_id: string;
  origin: string;
  verification_method: string;
  status: string;
  verified_at: Date | string | null;
  created_at: Date | string;
}

interface MerchantKeyRow extends QueryResultRow {
  merchant_id: string;
  kid: string;
  algorithm: string;
  public_key: string;
  purpose: string;
  valid_from: Date | string;
  valid_until: Date | string | null;
  revoked_at: Date | string | null;
  revocation_reason: string | null;
  created_at: Date | string;
}

interface WalletAuthChallengeRow extends QueryResultRow {
  id: string;
  wallet: string;
  network: string;
  purpose: string;
  nonce: string;
  message: string;
  expires_at: Date | string;
  created_at: Date | string;
  consumed_at: Date | string | null;
}

interface WalletAuthSessionRow extends QueryResultRow {
  token_hash: string;
  session_id: string;
  wallet: string;
  network: string;
  purpose: string;
  challenge_id: string;
  issued_at: Date | string;
  expires_at: Date | string;
}

export interface PostgresMerchantRegistryOptions {
  now?: () => Date;
  merchantIdFactory?: () => string;
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

export class PostgresMerchantRegistry implements MerchantRegistry {
  constructor(
    private readonly db: PostgresQueryExecutor,
    private readonly options: PostgresMerchantRegistryOptions = {}
  ) {}

  async createMerchant(input: CreateMerchantInput): Promise<MerchantRecord> {
    const now = this.now();
    const merchant: MerchantRecord = {
      id: assertSplit402Id(
        input.id ?? this.options.merchantIdFactory?.() ?? createPrefixedId("mrc"),
        "merchant id"
      ),
      slug: assertMerchantSlug(input.slug),
      displayName: assertNonEmptyString(input.displayName, "displayName"),
      ownerWallet: assertBase58PublicKey(input.ownerWallet, "ownerWallet"),
      status: input.status ?? "pending",
      createdAt: now,
      updatedAt: now
    };
    assertMerchantStatus(merchant.status);

    try {
      const result = await this.db.query<MerchantRow>(
        `insert into merchants (
           id, slug, display_name, owner_wallet, status, created_at, updated_at
         ) values (
           $1, $2, $3, $4, $5, $6, $7
         )
         returning id, slug, display_name, owner_wallet, status, created_at, updated_at`,
        [
          merchant.id,
          merchant.slug,
          merchant.displayName,
          merchant.ownerWallet,
          merchant.status,
          merchant.createdAt,
          merchant.updatedAt
        ]
      );
      return mapMerchant(requiredRow(result));
    } catch (error) {
      throw mapMerchantWriteError(error);
    }
  }

  async getMerchantProfile(
    merchantId: string
  ): Promise<MerchantProfile | undefined> {
    const merchantResult = await this.db.query<MerchantRow>(
      `select id, slug, display_name, owner_wallet, status, created_at, updated_at
         from merchants
        where id = $1
        limit 1`,
      [merchantId]
    );
    const merchantRow = merchantResult.rows[0];
    if (merchantRow === undefined) {
      return undefined;
    }

    const originsResult = await this.db.query<MerchantOriginRow>(
      `select merchant_id, origin, verification_method, status, verified_at, created_at
         from merchant_origins
        where merchant_id = $1
        order by created_at, origin`,
      [merchantId]
    );
    const keysResult = await this.db.query<MerchantKeyRow>(
      `select merchant_id, kid, algorithm, public_key, purpose, valid_from,
              valid_until, revoked_at, revocation_reason, created_at
         from merchant_keys
        where merchant_id = $1
        order by created_at, kid`,
      [merchantId]
    );

    return {
      ...mapMerchant(merchantRow),
      origins: originsResult.rows.map(mapMerchantOrigin),
      keys: keysResult.rows.map(mapMerchantKey)
    };
  }

  async addOrigin(
    input: AddMerchantOriginInput
  ): Promise<MerchantOriginRecord> {
    await this.assertMerchantExists(input.merchantId);
    const origin: MerchantOriginRecord = {
      merchantId: input.merchantId,
      origin: assertUrlOrigin(input.origin),
      verificationMethod: input.verificationMethod ?? "well_known",
      status: input.status ?? "pending",
      ...(input.verifiedAt === undefined
        ? {}
        : { verifiedAt: assertUtcTimestamp(input.verifiedAt) }),
      createdAt: this.now()
    };
    assertOriginVerificationMethod(origin.verificationMethod);
    assertMerchantOriginStatus(origin.status);

    try {
      const result = await this.db.query<MerchantOriginRow>(
        `insert into merchant_origins (
           merchant_id, origin, verification_method, status, verified_at, created_at
         ) values (
           $1, $2, $3, $4, $5, $6
         )
         returning merchant_id, origin, verification_method, status, verified_at, created_at`,
        [
          origin.merchantId,
          origin.origin,
          origin.verificationMethod,
          origin.status,
          origin.verifiedAt ?? null,
          origin.createdAt
        ]
      );
      return mapMerchantOrigin(requiredRow(result));
    } catch (error) {
      throw mapMerchantWriteError(error);
    }
  }

  async addKey(input: AddMerchantKeyInput): Promise<MerchantKeyRecord> {
    await this.assertMerchantExists(input.merchantId);
    const now = this.now();
    const key: MerchantKeyRecord = {
      merchantId: input.merchantId,
      kid: assertNonEmptyString(input.kid, "kid"),
      algorithm: input.algorithm ?? "Ed25519",
      publicKey: assertBase58PublicKey(input.publicKey, "publicKey"),
      purpose: input.purpose ?? "offer_receipt",
      validFrom: input.validFrom ?? now,
      ...(input.validUntil === undefined
        ? {}
        : { validUntil: assertUtcTimestamp(input.validUntil) }),
      createdAt: now
    };
    assertMerchantKeyAlgorithm(key.algorithm);
    assertMerchantKeyPurpose(key.purpose);
    assertUtcTimestamp(key.validFrom);
    assertChronologicalRange(key.validFrom, key.validUntil);

    try {
      const result = await this.db.query<MerchantKeyRow>(
        `insert into merchant_keys (
           merchant_id, kid, algorithm, public_key, purpose, valid_from,
           valid_until, created_at
         ) values (
           $1, $2, $3, $4, $5, $6, $7, $8
         )
         returning merchant_id, kid, algorithm, public_key, purpose, valid_from,
                   valid_until, revoked_at, revocation_reason, created_at`,
        [
          key.merchantId,
          key.kid,
          key.algorithm,
          key.publicKey,
          key.purpose,
          key.validFrom,
          key.validUntil ?? null,
          key.createdAt
        ]
      );
      return mapMerchantKey(requiredRow(result));
    } catch (error) {
      throw mapMerchantWriteError(error);
    }
  }

  async revokeKey(
    input: RevokeMerchantKeyInput
  ): Promise<MerchantKeyRecord | undefined> {
    const revokedAt = input.revokedAt ?? this.now();
    assertUtcTimestamp(revokedAt);
    const reason =
      input.reason === undefined
        ? undefined
        : assertNonEmptyString(input.reason, "reason");

    const result = await this.db.query<MerchantKeyRow>(
      `update merchant_keys
          set revoked_at = $3,
              revocation_reason = $4
        where merchant_id = $1
          and kid = $2
        returning merchant_id, kid, algorithm, public_key, purpose, valid_from,
                  valid_until, revoked_at, revocation_reason, created_at`,
      [input.merchantId, input.kid, revokedAt, reason ?? null]
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapMerchantKey(row);
  }

  async resolveKey(
    input: ResolveMerchantKeyInput
  ): Promise<MerchantKeyRecord | undefined> {
    const at = assertUtcTimestamp(input.at ?? this.now());
    const result = await this.db.query<MerchantKeyRow>(
      `select merchant_id, kid, algorithm, public_key, purpose, valid_from,
              valid_until, revoked_at, revocation_reason, created_at
         from merchant_keys
        where merchant_id = $1
          and kid = $2
          and purpose = $3
          and valid_from <= $4
          and (valid_until is null or valid_until > $4)
          and (revoked_at is null or revoked_at > $4)
        limit 1`,
      [input.merchantId, input.kid, input.purpose ?? "offer_receipt", at]
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapMerchantKey(row);
  }

  private async assertMerchantExists(merchantId: string): Promise<void> {
    const result = await this.db.query<Pick<MerchantRow, "id">>(
      "select id from merchants where id = $1 limit 1",
      [merchantId]
    );
    if (result.rows[0] === undefined) {
      throw new MerchantRegistryValidationError(`unknown merchant: ${merchantId}`);
    }
  }

  private now(): string {
    return (this.options.now?.() ?? new Date()).toISOString();
  }
}

export class PostgresWalletAuthStore implements WalletAuthStore {
  constructor(private readonly db: PostgresQueryExecutor) {}

  async saveChallenge(challenge: WalletAuthChallengeRecord): Promise<void> {
    await this.db.query(
      `insert into wallet_auth_challenges (
         id, wallet, network, purpose, nonce, message, expires_at, created_at,
         consumed_at
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9
       )`,
      [
        challenge.challengeId,
        challenge.wallet,
        challenge.network,
        challenge.purpose,
        challenge.nonce,
        challenge.message,
        challenge.expiresAt,
        challenge.createdAt,
        challenge.consumedAt ?? null
      ]
    );
  }

  async getChallenge(
    challengeId: string
  ): Promise<WalletAuthChallengeRecord | undefined> {
    const result = await this.db.query<WalletAuthChallengeRow>(
      `select id, wallet, network, purpose, nonce, message, expires_at,
              created_at, consumed_at
         from wallet_auth_challenges
        where id = $1
        limit 1`,
      [challengeId]
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapWalletAuthChallenge(row);
  }

  async consumeChallenge(
    challengeId: string,
    consumedAt: string
  ): Promise<boolean> {
    const result = await this.db.query<Pick<WalletAuthChallengeRow, "id">>(
      `update wallet_auth_challenges
          set consumed_at = $2
        where id = $1
          and consumed_at is null
        returning id`,
      [challengeId, consumedAt]
    );
    return result.rows[0] !== undefined;
  }

  async saveSession(
    tokenHash: string,
    session: AuthenticatedWalletSession
  ): Promise<void> {
    await this.db.query(
      `insert into wallet_auth_sessions (
         token_hash, session_id, wallet, network, purpose, challenge_id,
         issued_at, expires_at
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8
       )`,
      [
        tokenHash,
        session.sessionId,
        session.wallet,
        session.network,
        session.purpose,
        session.challengeId,
        session.issuedAt,
        session.expiresAt
      ]
    );
  }

  async getSession(
    tokenHash: string
  ): Promise<AuthenticatedWalletSession | undefined> {
    const result = await this.db.query<WalletAuthSessionRow>(
      `select token_hash, session_id, wallet, network, purpose, challenge_id,
              issued_at, expires_at
         from wallet_auth_sessions
        where token_hash = $1
        limit 1`,
      [tokenHash]
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapWalletAuthSession(row);
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

function mapMerchant(row: MerchantRow): MerchantRecord {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    ownerWallet: row.owner_wallet,
    status: readMerchantStatus(row.status),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapMerchantOrigin(row: MerchantOriginRow): MerchantOriginRecord {
  return {
    merchantId: row.merchant_id,
    origin: row.origin,
    verificationMethod: readOriginVerificationMethod(row.verification_method),
    status: readMerchantOriginStatus(row.status),
    ...(row.verified_at === null ? {} : { verifiedAt: toIsoString(row.verified_at) }),
    createdAt: toIsoString(row.created_at)
  };
}

function mapMerchantKey(row: MerchantKeyRow): MerchantKeyRecord {
  return {
    merchantId: row.merchant_id,
    kid: row.kid,
    algorithm: readMerchantKeyAlgorithm(row.algorithm),
    publicKey: row.public_key,
    purpose: readMerchantKeyPurpose(row.purpose),
    validFrom: toIsoString(row.valid_from),
    ...(row.valid_until === null ? {} : { validUntil: toIsoString(row.valid_until) }),
    ...(row.revoked_at === null ? {} : { revokedAt: toIsoString(row.revoked_at) }),
    ...(row.revocation_reason === null ? {} : { revocationReason: row.revocation_reason }),
    createdAt: toIsoString(row.created_at)
  };
}

function mapWalletAuthChallenge(
  row: WalletAuthChallengeRow
): WalletAuthChallengeRecord {
  return {
    challengeId: row.id,
    wallet: row.wallet,
    network: row.network,
    purpose: readWalletAuthPurpose(row.purpose),
    nonce: row.nonce,
    message: row.message,
    expiresAt: toIsoString(row.expires_at),
    createdAt: toIsoString(row.created_at),
    ...(row.consumed_at === null
      ? {}
      : { consumedAt: toIsoString(row.consumed_at) })
  };
}

function mapWalletAuthSession(
  row: WalletAuthSessionRow
): AuthenticatedWalletSession {
  return {
    sessionId: row.session_id,
    wallet: row.wallet,
    network: row.network,
    purpose: readWalletAuthPurpose(row.purpose),
    challengeId: row.challenge_id,
    issuedAt: toIsoString(row.issued_at),
    expiresAt: toIsoString(row.expires_at)
  };
}

function requiredRow<Row extends QueryResultRow>(result: QueryResult<Row>): Row {
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("database did not return a row");
  }
  return row;
}

function assertSplit402Id(value: string, label: string): string {
  if (!Split402IdSchema.safeParse(value).success) {
    throw new MerchantRegistryValidationError(`${label} must be a Split402 id`);
  }
  return value;
}

function assertBase58PublicKey(value: string, label: string): string {
  if (!Base58PublicKeySchema.safeParse(value).success) {
    throw new MerchantRegistryValidationError(`${label} must be a base58 public key`);
  }
  return value;
}

function assertNonEmptyString(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new MerchantRegistryValidationError(`${label} must be a non-empty string`);
  }
  return value;
}

function assertMerchantSlug(value: string): string {
  if (!/^[a-z0-9][a-z0-9-]{2,62}$/u.test(value)) {
    throw new MerchantRegistryValidationError(
      "slug must be 3-63 lowercase URL-safe characters"
    );
  }
  return value;
}

function assertUrlOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (url.origin !== value || !["http:", "https:"].includes(url.protocol)) {
      throw new Error("invalid origin");
    }
    return value;
  } catch {
    throw new MerchantRegistryValidationError("origin must be an http(s) URL origin");
  }
}

function assertUtcTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || !value.endsWith("Z")) {
    throw new MerchantRegistryValidationError("timestamp must be UTC RFC3339");
  }
  return value;
}

function assertChronologicalRange(validFrom: string, validUntil?: string): void {
  if (validUntil !== undefined && Date.parse(validUntil) <= Date.parse(validFrom)) {
    throw new MerchantRegistryValidationError("validUntil must be after validFrom");
  }
}

function assertMerchantStatus(value: MerchantStatus): void {
  readMerchantStatus(value);
}

function assertOriginVerificationMethod(
  value: MerchantOriginVerificationMethod
): void {
  readOriginVerificationMethod(value);
}

function assertMerchantOriginStatus(value: MerchantOriginStatus): void {
  readMerchantOriginStatus(value);
}

function assertMerchantKeyAlgorithm(value: MerchantKeyAlgorithm): void {
  readMerchantKeyAlgorithm(value);
}

function assertMerchantKeyPurpose(value: MerchantKeyPurpose): void {
  readMerchantKeyPurpose(value);
}

function readMerchantStatus(value: string): MerchantStatus {
  if (
    value === "pending" ||
    value === "active" ||
    value === "suspended" ||
    value === "closed"
  ) {
    return value;
  }
  throw new Error(`unsupported merchant status: ${value}`);
}

function readOriginVerificationMethod(value: string): MerchantOriginVerificationMethod {
  if (value === "well_known" || value === "dns") {
    return value;
  }
  throw new Error(`unsupported origin verification method: ${value}`);
}

function readMerchantOriginStatus(value: string): MerchantOriginStatus {
  if (
    value === "pending" ||
    value === "verified" ||
    value === "failed" ||
    value === "revoked"
  ) {
    return value;
  }
  throw new Error(`unsupported merchant origin status: ${value}`);
}

function readMerchantKeyAlgorithm(value: string): MerchantKeyAlgorithm {
  if (value === "Ed25519" || value === "ES256") {
    return value;
  }
  throw new Error(`unsupported merchant key algorithm: ${value}`);
}

function readMerchantKeyPurpose(value: string): MerchantKeyPurpose {
  if (value === "offer_receipt" || value === "webhook") {
    return value;
  }
  throw new Error(`unsupported merchant key purpose: ${value}`);
}

function readWalletAuthPurpose(value: string): "merchant-session" {
  if (value === "merchant-session") {
    return value;
  }
  throw new Error(`unsupported wallet auth purpose: ${value}`);
}

function mapMerchantWriteError(error: unknown): unknown {
  return isUniqueViolation(error)
    ? new MerchantRegistryConflictError("merchant registry record already exists")
    : error;
}
