import {
  Base58PublicKeySchema,
  Split402ReceiptV1Schema,
  Split402IdSchema,
  createPrefixedId,
  ReferralClaimV1Schema,
  type Split402ReceiptV1
} from "@split402/protocol";
import { randomUUID } from "node:crypto";
import type { QueryResult, QueryResultRow } from "pg";

import type {
  AuthenticatedWalletSession,
  WalletAuthChallengeRecord,
  WalletAuthStore
} from "./auth.js";
import {
  CampaignRegistryConflictError,
  CampaignRegistryValidationError,
  createCampaignVersionRecord,
  verifyCampaignTermsSignature,
  type ActivateCampaignVersionInput,
  type CampaignOperation,
  type CampaignProfile,
  type CampaignRecord,
  type CampaignRegistry,
  type CampaignStatus,
  type CampaignTerms,
  type CampaignVersionRecord,
  type CreateCampaignInput,
  type CreateCampaignVersionInput
} from "./campaigns.js";
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
import {
  InMemoryRouteRegistry,
  RouteRegistryConflictError,
  RouteRegistryValidationError,
  type ActivateRouteInput,
  type CreateRouteDraftInput,
  type InMemoryRouteRegistryOptions,
  type RouteDraft,
  type RouteOperationScope,
  type RouteRecord,
  type RouteRegistry,
  type RouteStatus,
  type SuspendRouteInput
} from "./routes.js";
import type {
  AccrualStatus,
  CommissionAccrual,
  LedgerAccountType,
  LedgerEntry,
  LedgerTransaction,
  MarkOutboxEventDeliveredInput,
  MarkOutboxEventFailedInput,
  OutboxEventRecord,
  OutboxEventStore,
  ReceiptIngestSource,
  ReceiptIngestionSnapshot,
  ReceiptIngestionStore,
  ReceiptChainVerificationStore,
  MarkReceiptChainVerifiedInput,
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
  available_at: Date | string | null;
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

interface OutboxEventRow extends QueryResultRow {
  id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: unknown;
  status: string;
  attempts: number;
  available_at: Date | string;
  locked_at: Date | string | null;
  last_error: string | null;
  created_at: Date | string;
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

interface CampaignRow extends QueryResultRow {
  id: string;
  merchant_id: string;
  resource_origin: string;
  status: string;
  current_version: number;
  created_at: Date | string;
  updated_at: Date | string;
}

interface CampaignVersionRow extends QueryResultRow {
  campaign_id: string;
  version: number;
  terms_hash: `sha256:${string}`;
  terms_json: unknown;
  signing_bytes_hex: string;
  network: string;
  asset_mint: string;
  commission_bps: number;
  protocol_fee_bps: number;
  payout_threshold_atomic: string;
  starts_at: Date | string;
  ends_at: Date | string | null;
  merchant_kid: string | null;
  merchant_signature: string | null;
  activated_at: Date | string | null;
  created_at: Date | string;
}

interface RouteRow extends QueryResultRow {
  id: string;
  campaign_id: string;
  campaign_version_min: number;
  referrer_wallet: string;
  payout_wallet: string;
  resource_origin: string;
  operation_ids: unknown;
  claim_hash: `sha256:${string}`;
  claim_json: unknown;
  signing_bytes_hex: string;
  status: string;
  issued_at: Date | string;
  expires_at: Date | string;
  nonce: string;
  metadata_hash: `sha256:${string}` | null;
  created_at: Date | string;
  activated_at: Date | string;
}

export interface PostgresMerchantRegistryOptions {
  now?: () => Date;
  merchantIdFactory?: () => string;
}

export interface PostgresCampaignRegistryOptions {
  now?: () => Date;
  campaignIdFactory?: () => string;
}

export interface PostgresReceiptIngestionStoreOptions {
  outboxEventIdFactory?: () => string;
}

export interface PostgresOutboxEventStoreOptions {
  now?: () => Date;
}

export type PostgresRouteRegistryOptions = InMemoryRouteRegistryOptions;

export class PostgresReceiptIngestionStore
  implements ReceiptIngestionStore, ReceiptChainVerificationStore {
  constructor(
    private readonly db: PostgresPool | PostgresQueryExecutor,
    private readonly options: PostgresReceiptIngestionStoreOptions = {}
  ) {}

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

  getReceiptForChainVerification(
    receiptId: string
  ): Promise<ReceiptIngestionSnapshot | undefined> {
    return this.getByReceiptId(receiptId);
  }

  async markReceiptChainVerified(
    input: MarkReceiptChainVerifiedInput
  ): Promise<ReceiptIngestionSnapshot | undefined> {
    await this.withTransaction(async (client) => {
      await client.query(
        `update payment_receipts
            set verification_state = 'signature_verified'
          where id = $1
            and verification_state = 'pending_chain_verification'`,
        [input.receiptId]
      );
      await client.query(
        `update commission_accruals
            set status = 'available',
                available_at = $2
          where receipt_id = $1
            and status = 'pending_chain_verification'`,
        [input.receiptId, input.verifiedAt]
      );
    });
    return this.getByReceiptId(input.receiptId);
  }

  async save(snapshot: ReceiptIngestionSnapshot): Promise<void> {
    await this.withTransaction(async (client) => {
      await insertReceipt(client, snapshot.receipt);

      if (snapshot.accrual !== undefined) {
        await insertAccrual(client, snapshot.accrual);

        if (snapshot.ledgerTransaction !== undefined) {
          await insertLedgerTransaction(client, snapshot.ledgerTransaction);
          for (const entry of snapshot.ledgerTransaction.entries) {
            await insertLedgerEntry(client, entry);
          }
        }
      }

      await insertOutboxEvent(client, this.createReceiptAcceptedEvent(snapshot));
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
              payout_wallet, asset_mint, amount_atomic, status, available_at,
              created_at
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

  private createReceiptAcceptedEvent(
    snapshot: ReceiptIngestionSnapshot
  ): OutboxEventRecord {
    return createReceiptAcceptedOutboxEvent(
      snapshot,
      this.options.outboxEventIdFactory?.() ?? randomUUID()
    );
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

export class PostgresOutboxEventStore implements OutboxEventStore {
  constructor(
    private readonly db: PostgresPool | PostgresQueryExecutor,
    private readonly options: PostgresOutboxEventStoreOptions = {}
  ) {}

  async getEvent(eventId: string): Promise<OutboxEventRecord | undefined> {
    const result = await this.db.query<OutboxEventRow>(
      `select id, event_type, aggregate_type, aggregate_id, payload, status,
              attempts, available_at, locked_at, last_error, created_at
         from outbox_events
        where id = $1::uuid
        limit 1`,
      [eventId]
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapOutboxEvent(row);
  }

  async claimNext(input: { now?: string } = {}): Promise<OutboxEventRecord | undefined> {
    const now = input.now ?? this.now();
    const result = await this.db.query<OutboxEventRow>(
      `update outbox_events
          set status = 'processing',
              attempts = attempts + 1,
              locked_at = $1,
              last_error = null
        where id = (
          select id
            from outbox_events
           where status = 'pending'
             and available_at <= $1
           order by available_at, created_at, id
           for update skip locked
           limit 1
        )
      returning id, event_type, aggregate_type, aggregate_id, payload, status,
                attempts, available_at, locked_at, last_error, created_at`,
      [now]
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapOutboxEvent(row);
  }

  async markDelivered(
    input: MarkOutboxEventDeliveredInput
  ): Promise<OutboxEventRecord | undefined> {
    const result = await this.db.query<OutboxEventRow>(
      `update outbox_events
          set status = 'delivered',
              locked_at = null,
              last_error = null
        where id = $1::uuid
          and status = 'processing'
      returning id, event_type, aggregate_type, aggregate_id, payload, status,
                attempts, available_at, locked_at, last_error, created_at`,
      [input.eventId]
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapOutboxEvent(row);
  }

  async markFailed(
    input: MarkOutboxEventFailedInput
  ): Promise<OutboxEventRecord | undefined> {
    const result = await this.db.query<OutboxEventRow>(
      `update outbox_events
          set status = $4,
              available_at = $3,
              locked_at = null,
              last_error = $2
        where id = $1::uuid
          and status = 'processing'
      returning id, event_type, aggregate_type, aggregate_id, payload, status,
                attempts, available_at, locked_at, last_error, created_at`,
      [
        input.eventId,
        input.lastError,
        input.availableAt,
        input.deadLetter === true ? "dead_letter" : "pending"
      ]
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapOutboxEvent(row);
  }

  private now(): string {
    return (this.options.now?.() ?? new Date()).toISOString();
  }
}

export class PostgresCampaignRegistry implements CampaignRegistry {
  constructor(
    private readonly db: PostgresPool | PostgresQueryExecutor,
    private readonly options: PostgresCampaignRegistryOptions = {}
  ) {}

  async createCampaign(input: CreateCampaignInput): Promise<CampaignProfile> {
    const now = this.now();
    const campaignId = assertCampaignSplit402Id(
      input.id ?? this.options.campaignIdFactory?.() ?? createPrefixedId("cmp"),
      "campaign id"
    );
    const merchantId = assertCampaignSplit402Id(input.merchantId, "merchant id");
    const version = createCampaignVersionRecord(
      { id: campaignId, merchantId },
      1,
      input,
      now
    );
    const campaign: CampaignRecord = {
      id: campaignId,
      merchantId,
      resourceOrigin: version.terms.resourceOrigin,
      status: "draft",
      currentVersion: 1,
      createdAt: now,
      updatedAt: now
    };

    try {
      await this.withTransaction(async (client) => {
        await insertCampaign(client, campaign);
        await insertCampaignVersion(client, version);
        await insertCampaignOperations(client, version);
      });
    } catch (error) {
      throw mapCampaignWriteError(error);
    }

    return { ...campaign, current: version };
  }

  async getCampaign(campaignId: string): Promise<CampaignProfile | undefined> {
    const campaign = await this.loadCampaign(campaignId);
    if (campaign === undefined) {
      return undefined;
    }
    const current = await this.getCampaignVersion(
      campaign.id,
      campaign.currentVersion
    );
    if (current === undefined) {
      throw new Error(`missing current campaign version: ${campaign.id}`);
    }
    return { ...campaign, current };
  }

  async getCampaignVersion(
    campaignId: string,
    version: number
  ): Promise<CampaignVersionRecord | undefined> {
    assertCampaignPositiveVersion(version);
    const result = await this.db.query<CampaignVersionRow>(
      `select campaign_id, version, terms_hash, terms_json, signing_bytes_hex,
              network, asset_mint, commission_bps, protocol_fee_bps,
              payout_threshold_atomic, starts_at, ends_at, merchant_kid,
              merchant_signature, activated_at, created_at
         from campaign_versions
        where campaign_id = $1
          and version = $2
        limit 1`,
      [campaignId, version]
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapCampaignVersion(row);
  }

  async createCampaignVersion(
    input: CreateCampaignVersionInput
  ): Promise<CampaignVersionRecord> {
    const campaign = await this.loadCampaign(input.campaignId);
    if (campaign === undefined) {
      throw new CampaignRegistryValidationError(
        `unknown campaign: ${input.campaignId}`
      );
    }
    if (campaign.status === "closed") {
      throw new CampaignRegistryValidationError("closed campaigns cannot be versioned");
    }

    const now = this.now();
    const nextVersion = campaign.currentVersion + 1;
    const version = createCampaignVersionRecord(campaign, nextVersion, input, now);

    try {
      await this.withTransaction(async (client) => {
        await insertCampaignVersion(client, version);
        await insertCampaignOperations(client, version);
        await client.query(
          `update campaigns
              set resource_origin = $2,
                  status = 'draft',
                  current_version = $3,
                  updated_at = $4
            where id = $1`,
          [campaign.id, version.terms.resourceOrigin, nextVersion, now]
        );
      });
    } catch (error) {
      throw mapCampaignWriteError(error);
    }

    return version;
  }

  async activateCampaignVersion(
    input: ActivateCampaignVersionInput
  ): Promise<CampaignProfile> {
    const campaign = await this.loadCampaign(input.campaignId);
    if (campaign === undefined) {
      throw new CampaignRegistryValidationError(`unknown campaign: ${input.campaignId}`);
    }
    if (campaign.status === "closed") {
      throw new CampaignRegistryValidationError("closed campaigns cannot be activated");
    }

    const versionNumber = assertCampaignPositiveVersion(
      input.version ?? campaign.currentVersion
    );
    if (versionNumber !== campaign.currentVersion) {
      throw new CampaignRegistryValidationError(
        "only the current campaign version can be activated"
      );
    }
    const version = await this.getCampaignVersion(campaign.id, versionNumber);
    if (version === undefined) {
      throw new CampaignRegistryValidationError(
        `unknown campaign version: ${campaign.id}:${versionNumber}`
      );
    }

    const merchantKid = assertCampaignNonEmptyString(
      input.merchantKid,
      "merchantKid"
    );
    const merchantPublicKey = assertCampaignBase58PublicKey(
      input.merchantPublicKey,
      "merchantPublicKey"
    );
    const merchantSignature = assertCampaignNonEmptyString(
      input.merchantSignature,
      "merchantSignature"
    );

    if (
      version.merchantKid !== undefined ||
      version.merchantSignature !== undefined
    ) {
      if (
        version.merchantKid === merchantKid &&
        version.merchantSignature === merchantSignature
      ) {
        return { ...campaign, current: version };
      }
      throw new CampaignRegistryConflictError(
        "campaign version is already activated with a different signature"
      );
    }

    if (
      !verifyCampaignTermsSignature(
        version.terms,
        merchantPublicKey,
        merchantSignature
      )
    ) {
      throw new CampaignRegistryValidationError("invalid campaign terms signature");
    }

    const now = this.now();
    const activatedVersion: CampaignVersionRecord = {
      ...version,
      merchantKid,
      merchantSignature,
      activatedAt: now
    };
    const activatedCampaign: CampaignRecord = {
      ...campaign,
      status: "active",
      updatedAt: now
    };

    let activationInserted = false;
    try {
      await this.withTransaction(async (client) => {
        const activationResult = await client.query(
          `update campaign_versions
              set merchant_kid = $3,
                  merchant_signature = $4,
                  activated_at = $5
            where campaign_id = $1
              and version = $2
              and merchant_kid is null
              and merchant_signature is null
              and activated_at is null`,
          [campaign.id, versionNumber, merchantKid, merchantSignature, now]
        );
        activationInserted = activationResult.rowCount === 1;
        if (!activationInserted) {
          return;
        }
        await client.query(
          `update campaigns
              set status = 'active',
                  updated_at = $2
            where id = $1`,
          [campaign.id, now]
        );
      });
    } catch (error) {
      throw mapCampaignWriteError(error);
    }

    if (activationInserted) {
      return { ...activatedCampaign, current: activatedVersion };
    }

    const latest = await this.getCampaign(campaign.id);
    if (latest === undefined) {
      throw new Error(`missing campaign after activation race: ${campaign.id}`);
    }
    if (
      latest.current.merchantKid === merchantKid &&
      latest.current.merchantSignature === merchantSignature
    ) {
      return latest;
    }
    throw new CampaignRegistryConflictError(
      "campaign version is already activated with a different signature"
    );
  }

  private async loadCampaign(campaignId: string): Promise<CampaignRecord | undefined> {
    const result = await this.db.query<CampaignRow>(
      `select id, merchant_id, resource_origin, status, current_version,
              created_at, updated_at
         from campaigns
        where id = $1
        limit 1`,
      [campaignId]
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapCampaign(row);
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
      throw error;
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

  private now(): string {
    return (this.options.now?.() ?? new Date()).toISOString();
  }
}

export class PostgresRouteRegistry implements RouteRegistry {
  constructor(
    private readonly db: PostgresPool | PostgresQueryExecutor,
    private readonly options: PostgresRouteRegistryOptions = {}
  ) {}

  createRouteDraft(input: CreateRouteDraftInput): RouteDraft {
    return this.memoryRegistry().createRouteDraft(input);
  }

  async activateRoute(input: ActivateRouteInput): Promise<RouteRecord> {
    const route = this.memoryRegistry().activateRoute(input);
    try {
      await insertRoute(this.db, route);
      return route;
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const existingByClaimHash = await this.getRouteByClaimHash(route.claimHash);
      if (existingByClaimHash !== undefined) {
        return existingByClaimHash;
      }
      const existingById = await this.getRoute(route.id);
      if (existingById !== undefined) {
        throw new RouteRegistryConflictError(`route already exists: ${route.id}`);
      }
      throw mapRouteWriteError(error);
    }
  }

  async getRoute(routeId: string): Promise<RouteRecord | undefined> {
    const result = await this.db.query<RouteRow>(
      `select id, campaign_id, campaign_version_min, referrer_wallet,
              payout_wallet, resource_origin, operation_ids, claim_hash,
              claim_json, signing_bytes_hex, status, issued_at, expires_at,
              nonce, metadata_hash, created_at, activated_at
         from routes
        where id = $1
        limit 1`,
      [routeId]
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapRoute(row);
  }

  async suspendRoute(input: SuspendRouteInput): Promise<RouteRecord | undefined> {
    const existing = await this.getRoute(input.routeId);
    if (existing === undefined) {
      return undefined;
    }
    if (existing.status === "suspended") {
      return existing;
    }
    if (existing.status !== "active") {
      throw new RouteRegistryValidationError(
        `route must be active to suspend; current status is ${existing.status}`
      );
    }

    const result = await this.db.query<RouteRow>(
      `update routes
          set status = 'suspended'
        where id = $1
          and status = 'active'
        returning id, campaign_id, campaign_version_min, referrer_wallet,
                  payout_wallet, resource_origin, operation_ids, claim_hash,
                  claim_json, signing_bytes_hex, status, issued_at, expires_at,
                  nonce, metadata_hash, created_at, activated_at`,
      [input.routeId]
    );
    const row = result.rows[0];
    if (row !== undefined) {
      return mapRoute(row);
    }

    const current = await this.getRoute(input.routeId);
    if (current?.status === "suspended") {
      return current;
    }
    if (current === undefined) {
      return undefined;
    }
    throw new RouteRegistryValidationError(
      `route must be active to suspend; current status is ${current.status}`
    );
  }

  private async getRouteByClaimHash(
    claimHash: `sha256:${string}`
  ): Promise<RouteRecord | undefined> {
    const result = await this.db.query<RouteRow>(
      `select id, campaign_id, campaign_version_min, referrer_wallet,
              payout_wallet, resource_origin, operation_ids, claim_hash,
              claim_json, signing_bytes_hex, status, issued_at, expires_at,
              nonce, metadata_hash, created_at, activated_at
         from routes
        where claim_hash = $1
        limit 1`,
      [claimHash]
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapRoute(row);
  }

  private memoryRegistry(): InMemoryRouteRegistry {
    return new InMemoryRouteRegistry(this.options);
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

function insertCampaign(
  client: PostgresQueryExecutor,
  campaign: CampaignRecord
): Promise<QueryResult> {
  return client.query(
    `insert into campaigns (
       id, merchant_id, resource_origin, status, current_version, created_at,
       updated_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7
     )`,
    [
      campaign.id,
      campaign.merchantId,
      campaign.resourceOrigin,
      campaign.status,
      campaign.currentVersion,
      campaign.createdAt,
      campaign.updatedAt
    ]
  );
}

function insertCampaignVersion(
  client: PostgresQueryExecutor,
  version: CampaignVersionRecord
): Promise<QueryResult> {
  return client.query(
    `insert into campaign_versions (
       campaign_id, version, terms_hash, terms_json, signing_bytes_hex, network,
       asset_mint, commission_bps, protocol_fee_bps, payout_threshold_atomic,
       starts_at, ends_at, merchant_kid, merchant_signature, activated_at,
       created_at
     ) values (
       $1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
       $15, $16
     )`,
    [
      version.campaignId,
      version.version,
      version.termsHash,
      JSON.stringify(version.terms),
      version.signingBytesHex,
      version.terms.network,
      version.terms.asset,
      version.terms.commissionBps,
      version.terms.protocolFeeBps,
      version.terms.payoutThresholdAtomic,
      version.terms.startsAt,
      version.terms.endsAt,
      version.merchantKid ?? null,
      version.merchantSignature ?? null,
      version.activatedAt ?? null,
      version.createdAt
    ]
  );
}

async function insertCampaignOperations(
  client: PostgresQueryExecutor,
  version: CampaignVersionRecord
): Promise<void> {
  for (const operation of version.terms.operations) {
    await client.query(
      `insert into campaign_operations (
         campaign_id, campaign_version, operation_id, method, path_template,
         input_schema
       ) values (
         $1, $2, $3, $4, $5, $6::jsonb
       )`,
      [
        version.campaignId,
        version.version,
        operation.operationId,
        operation.method,
        operation.pathTemplate,
        operation.inputSchema === undefined
          ? null
          : JSON.stringify(operation.inputSchema)
      ]
    );
  }
}

function insertRoute(
  client: PostgresQueryExecutor,
  route: RouteRecord
): Promise<QueryResult> {
  return client.query(
    `insert into routes (
       id, campaign_id, campaign_version_min, referrer_wallet, payout_wallet,
       resource_origin, operation_ids, claim_hash, claim_json, signing_bytes_hex,
       status, issued_at, expires_at, nonce, metadata_hash, created_at,
       activated_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10, $11, $12, $13,
       $14, $15, $16, $17
     )`,
    [
      route.id,
      route.campaignId,
      route.campaignVersionMin,
      route.referrerWallet,
      route.payoutWallet,
      route.resourceOrigin,
      JSON.stringify(route.operationIds),
      route.claimHash,
      JSON.stringify(route.claim),
      route.signingBytesHex,
      route.status,
      route.issuedAt,
      route.expiresAt,
      route.nonce,
      route.metadataHash ?? null,
      route.createdAt,
      route.activatedAt
    ]
  );
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

function insertOutboxEvent(
  client: PostgresQueryExecutor,
  event: OutboxEventRecord
): Promise<QueryResult> {
  return client.query(
    `insert into outbox_events (
       id, event_type, aggregate_type, aggregate_id, payload, status, attempts,
       available_at, locked_at, last_error, created_at
     ) values (
       $1::uuid, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11
     )`,
    [
      event.id,
      event.eventType,
      event.aggregateType,
      event.aggregateId,
      JSON.stringify(event.payload),
      event.status,
      event.attempts,
      event.availableAt,
      event.lockedAt ?? null,
      event.lastError ?? null,
      event.createdAt
    ]
  );
}

function createReceiptAcceptedOutboxEvent(
  snapshot: ReceiptIngestionSnapshot,
  id: string
): OutboxEventRecord {
  const receipt = snapshot.receipt.receipt;
  return {
    id,
    eventType: "receipt.accepted.v1",
    aggregateType: "receipt",
    aggregateId: snapshot.receipt.id,
    payload: {
      receiptId: snapshot.receipt.id,
      receiptHash: snapshot.receipt.receiptHash,
      merchantId: receipt.merchantId,
      campaignId: receipt.campaignId,
      routeId: receipt.routeId ?? null,
      paymentId: receipt.paymentId,
      settlementTxSignature: receipt.settlementTxSignature,
      network: receipt.network,
      asset: receipt.asset,
      source: snapshot.receipt.source,
      verificationState: snapshot.receipt.verificationState,
      accrualId: snapshot.accrual?.id ?? null,
      ledgerTransactionId: snapshot.ledgerTransaction?.id ?? null
    },
    status: "pending",
    attempts: 0,
    availableAt: snapshot.receipt.createdAt,
    createdAt: snapshot.receipt.createdAt
  };
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
    ...(row.available_at === null ? {} : { availableAt: toIsoString(row.available_at) }),
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

function mapOutboxEvent(row: OutboxEventRow): OutboxEventRecord {
  return {
    id: row.id,
    eventType: row.event_type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    payload: parseOutboxPayload(row.payload),
    status: readOutboxEventStatus(row.status),
    attempts: row.attempts,
    availableAt: toIsoString(row.available_at),
    ...(row.locked_at === null ? {} : { lockedAt: toIsoString(row.locked_at) }),
    ...(row.last_error === null ? {} : { lastError: row.last_error }),
    createdAt: toIsoString(row.created_at)
  };
}

function parseReceiptJson(value: unknown): Split402ReceiptV1 {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return Split402ReceiptV1Schema.parse(parsed);
}

function parseOutboxPayload(value: unknown): Record<string, unknown> {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("outbox payload must be an object");
  }
  return parsed as Record<string, unknown>;
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

function readOutboxEventStatus(value: string): OutboxEventRecord["status"] {
  if (
    value === "pending" ||
    value === "processing" ||
    value === "delivered" ||
    value === "dead_letter"
  ) {
    return value;
  }
  throw new Error(`unsupported outbox event status: ${value}`);
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

function mapCampaign(row: CampaignRow): CampaignRecord {
  return {
    id: row.id,
    merchantId: row.merchant_id,
    resourceOrigin: row.resource_origin,
    status: readCampaignStatus(row.status),
    currentVersion: row.current_version,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapCampaignVersion(row: CampaignVersionRow): CampaignVersionRecord {
  return {
    campaignId: row.campaign_id,
    version: row.version,
    terms: parseCampaignTermsJson(row.terms_json),
    termsHash: row.terms_hash,
    signingBytesHex: row.signing_bytes_hex,
    ...(row.merchant_kid === null ? {} : { merchantKid: row.merchant_kid }),
    ...(row.merchant_signature === null
      ? {}
      : { merchantSignature: row.merchant_signature }),
    ...(row.activated_at === null
      ? {}
      : { activatedAt: toIsoString(row.activated_at) }),
    createdAt: toIsoString(row.created_at)
  };
}

function mapRoute(row: RouteRow): RouteRecord {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    campaignVersionMin: row.campaign_version_min,
    referrerWallet: row.referrer_wallet,
    payoutWallet: row.payout_wallet,
    resourceOrigin: row.resource_origin,
    operationIds: parseRouteOperationScope(row.operation_ids),
    claimHash: row.claim_hash,
    claim: parseReferralClaimJson(row.claim_json),
    signingBytesHex: row.signing_bytes_hex,
    status: readRouteStatus(row.status),
    issuedAt: toIsoString(row.issued_at),
    expiresAt: toIsoString(row.expires_at),
    nonce: row.nonce,
    ...(row.metadata_hash === null ? {} : { metadataHash: row.metadata_hash }),
    createdAt: toIsoString(row.created_at),
    activatedAt: toIsoString(row.activated_at)
  };
}

function parseReferralClaimJson(value: unknown): RouteRecord["claim"] {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return ReferralClaimV1Schema.parse(parsed);
}

function parseRouteOperationScope(value: unknown): RouteOperationScope {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("route operation_ids must be a non-empty array");
  }
  if (parsed.includes("*")) {
    if (parsed.length !== 1 || parsed[0] !== "*") {
      throw new Error("route operation_ids wildcard must be the only entry");
    }
    return ["*"];
  }
  return parsed.map((item) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new Error("route operation_ids entries must be non-empty strings");
    }
    return item;
  });
}

function parseCampaignTermsJson(value: unknown): CampaignTerms {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("campaign terms_json must be an object");
  }
  const terms = parsed as Record<string, unknown>;
  return {
    protocolVersion: readLiteral(terms.protocolVersion, "0.1", "protocolVersion"),
    campaignId: readJsonString(terms.campaignId, "campaignId"),
    campaignVersion: readJsonNumber(terms.campaignVersion, "campaignVersion"),
    merchantId: readJsonString(terms.merchantId, "merchantId"),
    resourceOrigin: readJsonString(terms.resourceOrigin, "resourceOrigin"),
    operations: readCampaignOperationsJson(terms.operations),
    network: readJsonString(terms.network, "network"),
    asset: readJsonString(terms.asset, "asset"),
    requiredAmountAtomic: readJsonString(
      terms.requiredAmountAtomic,
      "requiredAmountAtomic"
    ),
    payToWallet: readJsonString(terms.payToWallet, "payToWallet"),
    commissionBps: readJsonNumber(terms.commissionBps, "commissionBps"),
    protocolFeeBps: readJsonNumber(terms.protocolFeeBps, "protocolFeeBps"),
    commissionBase: readLiteral(
      terms.commissionBase,
      "required_amount",
      "commissionBase"
    ),
    settlementMode: readLiteral(terms.settlementMode, "accrual", "settlementMode"),
    attributionRequired: readJsonBoolean(
      terms.attributionRequired,
      "attributionRequired"
    ),
    allowSelfReferral: readJsonBoolean(
      terms.allowSelfReferral,
      "allowSelfReferral"
    ),
    payoutThresholdAtomic: readJsonString(
      terms.payoutThresholdAtomic,
      "payoutThresholdAtomic"
    ),
    startsAt: readJsonString(terms.startsAt, "startsAt"),
    endsAt: readJsonNullableString(terms.endsAt, "endsAt")
  };
}

function readCampaignOperationsJson(value: unknown): CampaignOperation[] {
  if (!Array.isArray(value)) {
    throw new Error("campaign operations must be an array");
  }
  return value.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error("campaign operation must be an object");
    }
    const operation = item as Record<string, unknown>;
    return {
      operationId: readJsonString(operation.operationId, "operationId"),
      method: readJsonString(operation.method, "method"),
      pathTemplate: readJsonString(operation.pathTemplate, "pathTemplate"),
      ...(operation.inputSchema === undefined
        ? {}
        : { inputSchema: operation.inputSchema })
    };
  });
}

function readJsonString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  return value;
}

function readJsonNullableString(value: unknown, label: string): string | null {
  return value === null ? null : readJsonString(value, label);
}

function readJsonNumber(value: unknown, label: string): number {
  if (typeof value !== "number") {
    throw new Error(`${label} must be a number`);
  }
  return value;
}

function readJsonBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function readLiteral<Value extends string>(
  value: unknown,
  expected: Value,
  label: string
): Value {
  if (value !== expected) {
    throw new Error(`${label} must be ${expected}`);
  }
  return expected;
}

function assertCampaignSplit402Id(value: string, label: string): string {
  if (!Split402IdSchema.safeParse(value).success) {
    throw new CampaignRegistryValidationError(`${label} must be a Split402 id`);
  }
  return value;
}

function assertCampaignBase58PublicKey(value: string, label: string): string {
  if (!Base58PublicKeySchema.safeParse(value).success) {
    throw new CampaignRegistryValidationError(
      `${label} must be a base58 public key`
    );
  }
  return value;
}

function assertCampaignNonEmptyString(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CampaignRegistryValidationError(
      `${label} must be a non-empty string`
    );
  }
  return value;
}

function assertCampaignPositiveVersion(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new CampaignRegistryValidationError(
      "version must be a positive integer"
    );
  }
  return value;
}

function readCampaignStatus(value: string): CampaignStatus {
  if (
    value === "draft" ||
    value === "active" ||
    value === "paused" ||
    value === "closed"
  ) {
    return value;
  }
  throw new Error(`unsupported campaign status: ${value}`);
}

function readRouteStatus(value: string): RouteStatus {
  if (
    value === "active" ||
    value === "suspended" ||
    value === "expired" ||
    value === "revoked"
  ) {
    return value;
  }
  throw new Error(`unsupported route status: ${value}`);
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

function mapCampaignWriteError(error: unknown): unknown {
  return isUniqueViolation(error)
    ? new CampaignRegistryConflictError("campaign registry record already exists")
    : error;
}

function mapRouteWriteError(error: unknown): unknown {
  return isUniqueViolation(error)
    ? new RouteRegistryConflictError("route registry record already exists")
    : error;
}
