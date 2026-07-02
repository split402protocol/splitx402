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
  WalletAuthRefreshTokenRecord,
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
  type CreateCampaignVersionInput,
  type ListMerchantCampaignsInput
} from "./campaigns.js";
import { ReceiptIngestionPersistenceConflictError } from "./errors.js";
import {
  MerchantRegistryConflictError,
  MerchantRegistryValidationError,
  assertMerchantOriginStatusTransition,
  assertMerchantStatusTransition,
  assertPayoutWalletStatusTransition,
  readOriginVerifiedAt,
  type AddMerchantPayoutWalletInput,
  type AddMerchantKeyInput,
  type AddMerchantOriginInput,
  type CreateMerchantInput,
  type MerchantKeyAlgorithm,
  type MerchantKeyPurpose,
  type MerchantKeyRecord,
  type MerchantOriginRecord,
  type MerchantOriginStatus,
  type MerchantOriginVerificationMethod,
  type MerchantPayoutWalletRecord,
  type MerchantPayoutWalletStatus,
  type MerchantProfile,
  type MerchantRecord,
  type MerchantRegistry,
  type MerchantStatus,
  type ResolveMerchantKeyInput,
  type RevokeMerchantKeyInput,
  type UpdateMerchantOriginStatusInput,
  type UpdateMerchantPayoutWalletStatusInput,
  type UpdateMerchantStatusInput
} from "./merchants.js";
import {
  InMemoryRouteRegistry,
  normalizeRouteSearchInput,
  RouteRegistryConflictError,
  RouteRegistryValidationError,
  type ActivateRouteInput,
  type CreateRouteDraftInput,
  type InMemoryRouteRegistryOptions,
  type RouteDraft,
  type RouteOperationScope,
  type RouteRecord,
  type RouteRegistry,
  type RouteVersionRecord,
  type RotateRoutePayoutInput,
  type SearchRoutesInput,
  type RouteStatus,
  type SuspendRouteInput
} from "./routes.js";
import type {
  AccrualStatus,
  CommissionAccrual,
  LedgerAccountType,
  LedgerEntry,
  LedgerTransaction,
  ListWebhookEventsInput,
  MarkOutboxEventDeliveredInput,
  MarkOutboxEventFailedInput,
  OutboxEventRecord,
  OutboxEventStore,
  ReceiptIngestSource,
  ReceiptIngestionSnapshot,
  ReceiptIngestionStore,
  ReceiptChainVerificationStore,
  MarkReceiptChainRejectedInput,
  MarkReceiptChainVerifiedInput,
  ReceiptRecord,
  ReceiptVerificationState,
  WebhookEventManagementStore
} from "./index.js";
import type {
  CreatePayoutBatchFromAvailableAccrualsInput,
  CreatePayoutBatchInput,
  ListPayoutEligibleAccrualsInput,
  PayoutAccrualStore,
  PayoutAllocationRecord,
  PayoutBatchRecord,
  PayoutBatchStore,
  PayoutBatchStatus,
  PayoutItemRecord,
  PayoutItemStatus,
  PayoutTransactionItemRecord,
  PayoutTransactionRecord,
  PayoutTransactionStatus,
  PayoutTransactionStore,
  SaveSignedPayoutTransactionsInput,
  MarkPayoutTransactionSubmittedInput,
  MarkPayoutTransactionFinalityInput,
  ClosePayoutBatchLedgerInput,
  MerchantObligationSummary,
  MerchantObligationViewInput,
  MerchantObligationViewStore,
  PayoutLedgerClosureStore,
  PayoutReconciliationItem,
  PayoutReconciliationStore,
  ListPayoutReconciliationItemsInput,
  ReferrerBalanceSummary,
  ReferrerPayoutHistoryItem,
  ReferrerPayoutViewInput,
  ReferrerPayoutViewStore,
  ListReferrerPayoutHistoryInput,
  ReleasePayoutBatchAllocationsInput
} from "./payouts.js";
import {
  PayoutBatchConflictError,
  attachPayoutTransactionItemMappings,
  createMerchantObligationSummary,
  createPayoutFinalizationLedgerTransaction,
  createPayoutBatchPlan,
  createPayoutReconciliationItem,
  createReferrerBalanceSummary,
  createReferrerPayoutHistoryItems,
  createSignedPayoutTransactionRecords,
  releasePayoutBatchAllocationsForBatch,
  summarizePayoutBatchTransactionItemFinality,
  verifyPayoutFinalizedTransfersBeforeLedgerClosure
} from "./payouts.js";
import {
  WEBHOOK_PAYOUT_CONFIRMED_EVENT_TYPE,
  WEBHOOK_PAYOUT_FAILED_EVENT_TYPE,
  WEBHOOK_PAYOUT_FINALIZED_EVENT_TYPE,
  WEBHOOK_PAYOUT_OUTCOME_UNKNOWN_EVENT_TYPE,
  WEBHOOK_PAYOUT_SUBMITTED_EVENT_TYPE
} from "./webhooks.js";

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

type PayoutLifecycleEventKind =
  | "submitted"
  | "confirmed"
  | "failed"
  | "outcome_unknown";

interface PaymentReceiptRow extends QueryResultRow {
  id: string;
  receipt_hash: `sha256:${string}`;
  receipt_json: unknown;
  source: string;
  verification_state: string;
  verification_reason: string | null;
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

interface MerchantPayoutWalletRow extends QueryResultRow {
  id: string;
  merchant_id: string;
  network: string;
  wallet: string;
  asset_mint: string;
  signer_reference: string;
  status: string;
  created_at: Date | string;
}

interface PayoutBatchRow extends QueryResultRow {
  id: string;
  merchant_id: string;
  payout_wallet_id: string;
  network: string;
  asset_mint: string;
  status: string;
  total_amount_atomic: string;
  item_count: number;
  accrual_count: number;
  failure_code: string | null;
  failure_message: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface PayoutItemRow extends QueryResultRow {
  id: string;
  payout_batch_id: string;
  destination_wallet: string;
  destination_token_account: string | null;
  amount_atomic: string;
  status: string;
  created_at: Date | string;
}

interface PayoutAllocationRow extends QueryResultRow {
  payout_item_id: string;
  accrual_id: string;
  amount_atomic: string;
}

interface PayoutTransactionRow extends QueryResultRow {
  id: string;
  payout_batch_id: string;
  sequence: number;
  attempt: number;
  recent_blockhash: string | null;
  last_valid_block_height: number | string | null;
  signed_transaction_base64: string | null;
  expected_signature: string | null;
  status: string;
  submitted_at: Date | string | null;
  confirmed_at: Date | string | null;
  finalized_at: Date | string | null;
  error_json: unknown;
  created_at: Date | string;
}

interface PayoutTransactionItemRow extends QueryResultRow {
  payout_transaction_id: string;
  payout_item_id: string;
  amount_atomic: string;
  destination_wallet: string;
  destination_token_account: string | null;
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

interface WalletAuthRefreshTokenRow extends QueryResultRow {
  token_hash: string;
  refresh_token_id: string;
  session_id: string;
  wallet: string;
  network: string;
  purpose: string;
  challenge_id: string;
  issued_at: Date | string;
  expires_at: Date | string;
  revoked_at: Date | string | null;
  replaced_by_session_id: string | null;
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
  current_version: number;
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

interface RouteVersionRow extends QueryResultRow {
  route_id: string;
  version: number;
  campaign_version_min: number;
  payout_wallet: string;
  claim_hash: `sha256:${string}`;
  claim_json: unknown;
  signing_bytes_hex: string;
  issued_at: Date | string;
  expires_at: Date | string;
  nonce: string;
  metadata_hash: `sha256:${string}` | null;
  created_at: Date | string;
}

export interface PostgresMerchantRegistryOptions {
  now?: () => Date;
  merchantIdFactory?: () => string;
  merchantPayoutWalletIdFactory?: () => string;
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
  implements
    ReceiptIngestionStore,
    ReceiptChainVerificationStore,
    PayoutAccrualStore,
    PayoutBatchStore,
    PayoutTransactionStore,
    PayoutLedgerClosureStore,
    PayoutReconciliationStore,
    MerchantObligationViewStore,
    ReferrerPayoutViewStore {
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
            set verification_state = 'signature_verified',
                verification_reason = null
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

  async markReceiptChainRejected(
    input: MarkReceiptChainRejectedInput
  ): Promise<ReceiptIngestionSnapshot | undefined> {
    await this.withTransaction(async (client) => {
      await client.query(
        `update payment_receipts
            set verification_state = 'chain_rejected',
                verification_reason = $2
          where id = $1
            and verification_state = 'pending_chain_verification'`,
        [input.receiptId, input.reason]
      );
      await client.query(
        `update commission_accruals
            set status = 'rejected'
          where receipt_id = $1
            and status = 'pending_chain_verification'`,
        [input.receiptId]
      );
    });
    return this.getByReceiptId(input.receiptId);
  }

  async listPayoutEligibleAccruals(
    input: ListPayoutEligibleAccrualsInput
  ): Promise<CommissionAccrual[]> {
    return selectPayoutEligibleAccruals(this.db, input);
  }

  async createPayoutBatch(
    input: CreatePayoutBatchInput
  ): Promise<PayoutBatchRecord> {
    const batch = createPayoutBatchPlan(input);
    await this.withTransaction(async (client) => {
      await allocateAndInsertPayoutBatch(client, batch);
    });
    return batch;
  }

  async createPayoutBatchFromAvailableAccruals(
    input: CreatePayoutBatchFromAvailableAccrualsInput
  ): Promise<PayoutBatchRecord> {
    return this.withTransaction(async (client) => {
      const accruals = await selectPayoutEligibleAccruals(
        client,
        {
          merchantId: input.merchantId,
          asset: input.asset,
          ...(input.now === undefined ? {} : { now: input.now }),
          ...(input.campaignId === undefined ? {} : { campaignId: input.campaignId }),
          ...(input.routeId === undefined ? {} : { routeId: input.routeId }),
          ...(input.limit === undefined ? {} : { limit: input.limit })
        },
        { forUpdateSkipLocked: true }
      );
      const batch = createPayoutBatchPlan({
        merchantId: input.merchantId,
        payoutWalletId: input.payoutWalletId,
        network: input.network,
        asset: input.asset,
        accruals,
        ...(input.now === undefined ? {} : { now: input.now }),
        ...(input.batchId === undefined ? {} : { batchId: input.batchId }),
        ...(input.itemIdFactory === undefined
          ? {}
          : { itemIdFactory: input.itemIdFactory }),
        ...(input.minimumPayoutAmountAtomic === undefined
          ? {}
          : { minimumPayoutAmountAtomic: input.minimumPayoutAmountAtomic }),
        ...(input.maxRecipients === undefined
          ? {}
          : { maxRecipients: input.maxRecipients })
      });
      await allocateAndInsertPayoutBatch(client, batch);
      return batch;
    });
  }

  async getPayoutBatch(batchId: string): Promise<PayoutBatchRecord | undefined> {
    return loadPayoutBatch(this.db, batchId);
  }

  async releasePayoutBatchAllocations(
    input: ReleasePayoutBatchAllocationsInput
  ): Promise<PayoutBatchRecord | undefined> {
    return this.withTransaction(async (client) => {
      const batch = await loadPayoutBatch(client, input.payoutBatchId);
      if (batch === undefined) {
        return undefined;
      }
      const released = releasePayoutBatchAllocationsForBatch({
        batch,
        reason: input.reason,
        ...(input.now === undefined ? {} : { now: input.now })
      });
      await markPayoutBatchAllocationsReleased(client, released);
      return released;
    });
  }

  async saveSignedPayoutTransactions(
    input: SaveSignedPayoutTransactionsInput
  ): Promise<PayoutTransactionRecord[]> {
    const batch = await this.getPayoutBatch(input.payoutBatchId);
    if (batch === undefined) {
      throw new PayoutBatchConflictError(
        `unknown payout batch: ${input.payoutBatchId}`
      );
    }
    const records = attachPayoutTransactionItemMappings(
      createSignedPayoutTransactionRecords(input),
      batch
    );
    const existingRecords = await this.listPayoutTransactions(input.payoutBatchId);
    for (const record of records) {
      if (
        existingRecords.some(
          (existing) =>
            existing.sequence === record.sequence &&
            existing.attempt === record.attempt
        )
      ) {
        throw new PayoutBatchConflictError(
          `payout transaction already exists for sequence ${record.sequence} attempt ${record.attempt}`
        );
      }
    }
    await this.withTransaction(async (client) => {
      for (const record of records) {
        await insertPayoutTransaction(client, record);
        for (const item of record.items) {
          await insertPayoutTransactionItem(client, item);
        }
      }
    });
    return records;
  }

  async listPayoutTransactions(
    payoutBatchId: string
  ): Promise<PayoutTransactionRecord[]> {
    const result = await this.db.query<PayoutTransactionRow>(
      `select id, payout_batch_id, sequence, attempt, recent_blockhash,
              last_valid_block_height, signed_transaction_base64,
              expected_signature, status, submitted_at, confirmed_at,
              finalized_at, error_json, created_at
         from payout_transactions
        where payout_batch_id = $1
        order by sequence, attempt, created_at, id`,
      [payoutBatchId]
    );
    return mapPayoutTransactionsWithItems(
      result.rows,
      await this.listPayoutTransactionItems(result.rows.map((row) => row.id))
    );
  }

  async listPayoutReconciliationItems(
    input: ListPayoutReconciliationItemsInput
  ): Promise<PayoutReconciliationItem[]> {
    const limit = normalizePayoutReconciliationLimit(input.limit);
    const values: unknown[] = [input.merchantId, limit];
    const assetClause =
      input.asset === undefined ? "" : ` and asset_mint = $${values.push(input.asset)}`;
    const result = await this.db.query<PayoutBatchRow>(
      `select id, merchant_id, payout_wallet_id, network, asset_mint, status,
              total_amount_atomic, item_count, accrual_count, failure_code,
              failure_message, created_at, updated_at
         from payout_batches
        where merchant_id = $1
          and status = 'outcome_unknown'${assetClause}
        order by updated_at asc, id asc
        limit $2`,
      values
    );
    const items: PayoutReconciliationItem[] = [];
    for (const row of result.rows) {
      const batch = await loadPayoutBatch(this.db, row.id);
      if (batch === undefined) {
        continue;
      }
      const item = createPayoutReconciliationItem(
        batch,
        await this.listPayoutTransactions(batch.id)
      );
      if (item !== undefined) {
        items.push(item);
      }
    }
    return items;
  }

  async getReferrerBalanceSummary(
    input: ReferrerPayoutViewInput
  ): Promise<ReferrerBalanceSummary> {
    const accruals = await this.listReferrerAccruals(input);
    const payoutBatches = await this.listPayoutBatchesForAccruals(accruals);
    return createReferrerBalanceSummary({
      ...input,
      accruals,
      payoutBatches
    });
  }

  async listReferrerPayoutHistory(
    input: ListReferrerPayoutHistoryInput
  ): Promise<ReferrerPayoutHistoryItem[]> {
    const limit = input.limit ?? 50;
    normalizePayoutReconciliationLimit(limit);
    const accruals = await this.listReferrerAccruals(input);
    const payoutBatches = await this.listPayoutBatchesForAccruals(accruals);
    return createReferrerPayoutHistoryItems({
      ...input,
      limit,
      accruals,
      payoutBatches
    });
  }

  async getMerchantObligationSummary(
    input: MerchantObligationViewInput
  ): Promise<MerchantObligationSummary> {
    const accruals = await this.listMerchantAccruals(input);
    const payoutBatches = await this.listPayoutBatchesForAccruals(accruals);
    return createMerchantObligationSummary({
      ...input,
      accruals,
      payoutBatches
    });
  }

  private async listMerchantAccruals(
    input: MerchantObligationViewInput
  ): Promise<CommissionAccrual[]> {
    const values: unknown[] = [input.merchantId];
    const assetClause =
      input.asset === undefined ? "" : ` and asset_mint = $${values.push(input.asset)}`;
    const result = await this.db.query<CommissionAccrualRow>(
      `select id, receipt_id, merchant_id, campaign_id, route_id, referrer_wallet,
              payout_wallet, asset_mint, amount_atomic, status, available_at,
              created_at
         from commission_accruals
        where merchant_id = $1${assetClause}
        order by created_at desc, id asc`,
      values
    );
    return result.rows.map(mapAccrual);
  }

  private async listReferrerAccruals(
    input: ReferrerPayoutViewInput
  ): Promise<CommissionAccrual[]> {
    const values: unknown[] = [input.referrerWallet];
    const assetClause =
      input.asset === undefined ? "" : ` and asset_mint = $${values.push(input.asset)}`;
    const result = await this.db.query<CommissionAccrualRow>(
      `select id, receipt_id, merchant_id, campaign_id, route_id, referrer_wallet,
              payout_wallet, asset_mint, amount_atomic, status, available_at,
              created_at
         from commission_accruals
        where referrer_wallet = $1${assetClause}
        order by created_at desc, id asc`,
      values
    );
    return result.rows.map(mapAccrual);
  }

  private async listPayoutBatchesForAccruals(
    accruals: readonly CommissionAccrual[]
  ): Promise<PayoutBatchRecord[]> {
    if (accruals.length === 0) {
      return [];
    }
    const accrualIds = accruals.map((accrual) => accrual.id);
    const result = await this.db.query<Pick<PayoutBatchRow, "id">>(
      `select pb.id
         from payout_batches pb
         join payout_items pi on pi.payout_batch_id = pb.id
         join payout_allocations pa on pa.payout_item_id = pi.id
        where pa.accrual_id = any($1)
        group by pb.id, pb.updated_at
        order by pb.updated_at desc, pb.id asc`,
      [accrualIds]
    );
    const batches: PayoutBatchRecord[] = [];
    for (const row of result.rows) {
      const batch = await loadPayoutBatch(this.db, row.id);
      if (batch !== undefined) {
        batches.push(batch);
      }
    }
    return batches;
  }

  async markPayoutTransactionSubmitted(
    input: MarkPayoutTransactionSubmittedInput
  ): Promise<PayoutTransactionRecord | undefined> {
    const existing = await this.getPayoutTransaction(input.id);
    if (existing === undefined) {
      return undefined;
    }
    if (
      input.expectedSignature !== undefined &&
      existing.expectedSignature !== undefined &&
      existing.expectedSignature !== input.expectedSignature
    ) {
      throw new PayoutBatchConflictError(
        "submitted payout transaction signature does not match expected signature"
      );
    }
    const submittedAt = normalizeDateInput(input.submittedAt, "submittedAt");
    const expectedSignature = input.expectedSignature ?? existing.expectedSignature ?? null;
    return this.withTransaction(async (client) => {
      const result = await client.query<PayoutTransactionRow>(
        `update payout_transactions
            set status = 'submitted',
                submitted_at = $2,
                expected_signature = $3
          where id = $1
          returning id, payout_batch_id, sequence, attempt, recent_blockhash,
                    last_valid_block_height, signed_transaction_base64,
                    expected_signature, status, submitted_at, confirmed_at,
                    finalized_at, error_json, created_at`,
        [input.id, submittedAt, expectedSignature]
      );
      const row = result.rows[0];
      if (row === undefined) {
        return undefined;
      }
      const transaction = (
        await mapPayoutTransactionsWithItems(
          [row],
          await listPayoutTransactionItems(client, [row.id])
        )
      )[0];
      if (transaction === undefined) {
        return undefined;
      }
      await rollUpPayoutBatchFinality(client, transaction.payoutBatchId, submittedAt);
      await this.insertPayoutLifecycleEventsIfBatchMatches(
        client,
        transaction,
        "submitted",
        submittedAt
      );
      return transaction;
    });
  }

  async markPayoutTransactionFinality(
    input: MarkPayoutTransactionFinalityInput
  ): Promise<PayoutTransactionRecord | undefined> {
    const existing = await this.getPayoutTransaction(input.id);
    if (existing === undefined) {
      return undefined;
    }
    const observedAt = normalizeDateInput(input.observedAt, "observedAt");
    const confirmedAt =
      input.status === "confirmed"
        ? observedAt
        : input.status === "finalized"
          ? existing.confirmedAt ?? observedAt
          : existing.confirmedAt ?? null;
    const finalizedAt =
      input.status === "finalized"
        ? observedAt
        : existing.finalizedAt ?? null;
    const errorJson =
      input.error === undefined
        ? existing.error === undefined
          ? null
          : JSON.stringify(existing.error)
        : JSON.stringify(input.error);
    const lifecycleKind = payoutLifecycleKindForFinalityStatus(input.status);
    return this.withTransaction(async (client) => {
      const result = await client.query<PayoutTransactionRow>(
        `update payout_transactions
            set status = $2,
                confirmed_at = $3,
                finalized_at = $4,
                error_json = $5
          where id = $1
          returning id, payout_batch_id, sequence, attempt, recent_blockhash,
                    last_valid_block_height, signed_transaction_base64,
                    expected_signature, status, submitted_at, confirmed_at,
                    finalized_at, error_json, created_at`,
        [input.id, input.status, confirmedAt, finalizedAt, errorJson]
      );
      const row = result.rows[0];
      if (row === undefined) {
        return undefined;
      }
      const transaction = (
        await mapPayoutTransactionsWithItems(
          [row],
          await listPayoutTransactionItems(client, [row.id])
        )
      )[0];
      if (transaction === undefined) {
        return undefined;
      }
      await rollUpPayoutBatchFinality(client, transaction.payoutBatchId, observedAt);
      if (lifecycleKind !== undefined) {
        await this.insertPayoutLifecycleEventsIfBatchMatches(
          client,
          transaction,
          lifecycleKind,
          observedAt
        );
      }
      return transaction;
    });
  }

  private async getPayoutTransaction(
    id: string
  ): Promise<PayoutTransactionRecord | undefined> {
    const result = await this.db.query<PayoutTransactionRow>(
      `select id, payout_batch_id, sequence, attempt, recent_blockhash,
              last_valid_block_height, signed_transaction_base64,
              expected_signature, status, submitted_at, confirmed_at,
              finalized_at, error_json, created_at
         from payout_transactions
        where id = $1
        limit 1`,
      [id]
    );
    const row = result.rows[0];
    if (row === undefined) {
      return undefined;
    }
    return (
      await mapPayoutTransactionsWithItems(
        [row],
      await this.listPayoutTransactionItems([row.id])
      )
    )[0];
  }

  private async listPayoutTransactionItems(
    payoutTransactionIds: readonly string[]
  ): Promise<PayoutTransactionItemRecord[]> {
    return listPayoutTransactionItems(this.db, payoutTransactionIds);
  }

  async closeFinalizedPayoutBatchLedger(
    input: ClosePayoutBatchLedgerInput
  ): Promise<LedgerTransaction | undefined> {
    const existing = await this.loadLedgerTransactionBySource(
      "payout_batch",
      input.payoutBatchId
    );
    if (existing !== undefined) {
      return existing;
    }
    const batch = await this.getPayoutBatch(input.payoutBatchId);
    if (batch === undefined) {
      return undefined;
    }
    await verifyPayoutFinalizedTransfersBeforeLedgerClosure({
      batch,
      transactions: await this.listPayoutTransactions(batch.id),
      verifier: input.finalizedTransferVerifier
    });
    const transaction = createPayoutFinalizationLedgerTransaction({
      batch,
      ...(input.now === undefined ? {} : { now: input.now }),
      ...(input.transactionId === undefined
        ? {}
        : { transactionId: input.transactionId }),
      ...(input.entryIdFactory === undefined
        ? {}
        : { entryIdFactory: input.entryIdFactory })
    });
    await this.withTransaction(async (client) => {
      await insertLedgerTransaction(client, transaction);
      for (const entry of transaction.entries) {
        await insertLedgerEntry(client, entry);
      }
      await markBatchAccrualsPaid(client, batch);
      await insertOutboxEvent(
        client,
        this.createPayoutFinalizedEvent(batch, transaction)
      );
      await insertOutboxEvent(
        client,
        this.createWebhookPayoutFinalizedEvent(batch, transaction)
      );
    });
    return transaction;
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
      await insertOutboxEvent(client, this.createWebhookReceiptAcceptedEvent(snapshot));
    });
  }

  private async loadSnapshot(
    whereClause: string,
    values: readonly unknown[]
  ): Promise<ReceiptIngestionSnapshot | undefined> {
    const receiptResult = await this.db.query<PaymentReceiptRow>(
      `select id, receipt_hash, receipt_json, source, verification_state,
              verification_reason, ingestion_state, created_at
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
    return this.loadLedgerTransactionBySource("commission_accrual", accrualId);
  }

  private async loadLedgerTransactionBySource(
    sourceType: LedgerTransaction["sourceType"],
    sourceId: string
  ): Promise<LedgerTransaction | undefined> {
    const transactionResult = await this.db.query<LedgerTransactionRow>(
      `select id, source_type, source_id, asset_mint, created_at
         from ledger_transactions
        where source_type = $1
          and source_id = $2
        limit 1`,
      [sourceType, sourceId]
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

  private createWebhookReceiptAcceptedEvent(
    snapshot: ReceiptIngestionSnapshot
  ): OutboxEventRecord {
    return createWebhookReceiptAcceptedOutboxEvent(
      snapshot,
      this.options.outboxEventIdFactory?.() ?? randomUUID()
    );
  }

  private createPayoutFinalizedEvent(
    batch: PayoutBatchRecord,
    transaction: LedgerTransaction
  ): OutboxEventRecord {
    return createPayoutFinalizedOutboxEvent(
      batch,
      transaction,
      this.options.outboxEventIdFactory?.() ?? randomUUID(),
      "payout.finalized.v1"
    );
  }

  private createWebhookPayoutFinalizedEvent(
    batch: PayoutBatchRecord,
    transaction: LedgerTransaction
  ): OutboxEventRecord {
    return createPayoutFinalizedOutboxEvent(
      batch,
      transaction,
      this.options.outboxEventIdFactory?.() ?? randomUUID(),
      WEBHOOK_PAYOUT_FINALIZED_EVENT_TYPE
    );
  }

  private async insertPayoutLifecycleEventsIfBatchMatches(
    client: PostgresQueryExecutor,
    transaction: PayoutTransactionRecord,
    kind: PayoutLifecycleEventKind,
    occurredAt: string
  ): Promise<void> {
    const batch = await loadPayoutBatch(client, transaction.payoutBatchId);
    if (batch === undefined || !doesBatchMatchPayoutLifecycleKind(batch, kind)) {
      return;
    }
    await insertOutboxEventOnce(
      client,
      this.createPayoutLifecycleEvent(batch, transaction, kind, false, occurredAt)
    );
    await insertOutboxEventOnce(
      client,
      this.createPayoutLifecycleEvent(batch, transaction, kind, true, occurredAt)
    );
  }

  private createPayoutLifecycleEvent(
    batch: PayoutBatchRecord,
    transaction: PayoutTransactionRecord,
    kind: PayoutLifecycleEventKind,
    webhook: boolean,
    occurredAt: string
  ): OutboxEventRecord {
    return createPayoutLifecycleOutboxEvent(
      batch,
      transaction,
      this.options.outboxEventIdFactory?.() ?? randomUUID(),
      kind,
      webhook,
      occurredAt
    );
  }

  private async withTransaction<Result>(
    operation: (client: PostgresQueryExecutor) => Promise<Result>
  ): Promise<Result> {
    const client = await this.createTransactionClient();
    let transactionStarted = false;
    try {
      await client.query("begin");
      transactionStarted = true;
      const result = await operation(client);
      await client.query("commit");
      return result;
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

export class PostgresOutboxEventStore
  implements OutboxEventStore, WebhookEventManagementStore {
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

  async listWebhookEvents(
    input: ListWebhookEventsInput
  ): Promise<OutboxEventRecord[]> {
    const merchantId = assertNonEmptyString(input.merchantId, "merchantId");
    const limit = assertOutboxListLimit(input.limit ?? 50);
    const eventTypes = normalizeOutboxEventTypes(input.eventTypes);
    const values: unknown[] = [merchantId, eventTypes];
    const where = [
      "payload ->> 'merchantId' = $1",
      "($2::text[] is null or event_type = any($2::text[]))"
    ];
    if (input.status !== undefined) {
      values.push(readOutboxEventStatus(input.status));
      where.push(`status = $${values.length}`);
    }
    values.push(limit);
    const result = await this.db.query<OutboxEventRow>(
      `select id, event_type, aggregate_type, aggregate_id, payload, status,
              attempts, available_at, locked_at, last_error, created_at
         from outbox_events
        where ${where.join(" and ")}
        order by created_at desc, id desc
        limit $${values.length}`,
      values
    );
    return result.rows.map(mapOutboxEvent);
  }

  async claimNext(
    input: { eventTypes?: string[]; now?: string } = {}
  ): Promise<OutboxEventRecord | undefined> {
    const now = input.now ?? this.now();
    const eventTypes = normalizeOutboxEventTypes(input.eventTypes);
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
             and ($2::text[] is null or event_type = any($2::text[]))
           order by available_at, created_at, id
           for update skip locked
           limit 1
        )
      returning id, event_type, aggregate_type, aggregate_id, payload, status,
                attempts, available_at, locked_at, last_error, created_at`,
      [now, eventTypes]
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

  async listMerchantCampaigns(
    input: ListMerchantCampaignsInput
  ): Promise<CampaignProfile[]> {
    const merchantId = assertCampaignSplit402Id(input.merchantId, "merchant id");
    const status =
      input.status === undefined ? undefined : assertCampaignStatus(input.status);
    const limit = assertCampaignListLimit(input.limit ?? 100);
    const values: unknown[] = [merchantId];
    const where = ["merchant_id = $1"];
    if (status !== undefined) {
      values.push(status);
      where.push(`status = $${values.length}`);
    }
    values.push(limit);
    const result = await this.db.query<CampaignRow>(
      `select id, merchant_id, resource_origin, status, current_version,
              created_at, updated_at
         from campaigns
        where ${where.join(" and ")}
        order by created_at desc, id desc
        limit $${values.length}`,
      values
    );
    const campaigns = result.rows.map(mapCampaign);
    return Promise.all(
      campaigns.map(async (campaign) => {
        const current = await this.getCampaignVersion(
          campaign.id,
          campaign.currentVersion
        );
        if (current === undefined) {
          throw new Error(`missing current campaign version: ${campaign.id}`);
        }
        return { ...campaign, current };
      })
    );
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
      const existingVersionByClaimHash = await this.getRouteVersionByClaimHash(
        route.claimHash
      );
      if (existingVersionByClaimHash !== undefined) {
        const existingRoute = await this.getRoute(existingVersionByClaimHash.routeId);
        if (existingRoute !== undefined) {
          return existingRoute;
        }
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
      `select id, current_version, campaign_id, campaign_version_min, referrer_wallet,
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

  async listRouteVersions(routeId: string): Promise<RouteVersionRecord[]> {
    const result = await this.db.query<RouteVersionRow>(
      `select route_id, version, campaign_version_min, payout_wallet,
              claim_hash, claim_json, signing_bytes_hex, issued_at, expires_at,
              nonce, metadata_hash, created_at
         from route_versions
        where route_id = $1
        order by version asc`,
      [routeId]
    );
    return result.rows.map(mapRouteVersion);
  }

  async rotateRoutePayout(input: RotateRoutePayoutInput): Promise<RouteRecord> {
    const existing = await this.getRoute(input.routeId);
    if (existing === undefined) {
      throw new RouteRegistryValidationError(`unknown route: ${input.routeId}`);
    }
    if (existing.status !== "active") {
      throw new RouteRegistryValidationError(
        `route must be active to rotate payout; current status is ${existing.status}`
      );
    }

    const validated = this.memoryRegistry().activateRoute({ claim: input.claim });
    assertPostgresRouteRotation(existing, validated);
    const existingVersion = await this.getRouteVersionByClaimHash(
      validated.claimHash
    );
    if (existingVersion !== undefined) {
      if (existingVersion.routeId !== existing.id) {
        throw new RouteRegistryConflictError(
          `route claim already exists for another route: ${existingVersion.routeId}`
        );
      }
      return existing;
    }

    const nextVersion = existing.currentVersion + 1;
    const now = this.now();
    const rotated: RouteRecord = {
      ...existing,
      currentVersion: nextVersion,
      campaignVersionMin: validated.campaignVersionMin,
      payoutWallet: validated.payoutWallet,
      claimHash: validated.claimHash,
      claim: validated.claim,
      signingBytesHex: validated.signingBytesHex,
      issuedAt: validated.issuedAt,
      expiresAt: validated.expiresAt,
      nonce: validated.nonce
    };
    if (validated.metadataHash === undefined) {
      delete rotated.metadataHash;
    } else {
      rotated.metadataHash = validated.metadataHash;
    }
    const version: RouteVersionRecord = {
      routeId: rotated.id,
      version: nextVersion,
      campaignVersionMin: rotated.campaignVersionMin,
      payoutWallet: rotated.payoutWallet,
      claimHash: rotated.claimHash,
      claim: rotated.claim,
      signingBytesHex: rotated.signingBytesHex,
      issuedAt: rotated.issuedAt,
      expiresAt: rotated.expiresAt,
      nonce: rotated.nonce,
      ...(rotated.metadataHash === undefined
        ? {}
        : { metadataHash: rotated.metadataHash }),
      createdAt: now
    };

    try {
      await insertRouteVersion(this.db, version);
      const updated = await updateRouteCurrentVersion(this.db, rotated);
      return updated ?? rotated;
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const duplicate = await this.getRouteVersionByClaimHash(rotated.claimHash);
      if (duplicate !== undefined && duplicate.routeId === rotated.id) {
        const current = await this.getRoute(rotated.id);
        if (current !== undefined) {
          return current;
        }
      }
      throw mapRouteWriteError(error);
    }
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
        returning id, current_version, campaign_id, campaign_version_min, referrer_wallet,
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

  async searchRoutes(input: SearchRoutesInput = {}): Promise<RouteRecord[]> {
    const search = normalizeRouteSearchInput(input, this.now());
    const values: unknown[] = [];
    const pushValue = (value: unknown): number => {
      values.push(value);
      return values.length;
    };
    const where = [`status = $${pushValue(search.status)}`];
    if (search.status === "active") {
      where.push(`expires_at > $${pushValue(search.now)}`);
    }
    if (search.campaignId !== undefined) {
      where.push(`campaign_id = $${pushValue(search.campaignId)}`);
    }
    if (search.referrerWallet !== undefined) {
      where.push(`referrer_wallet = $${pushValue(search.referrerWallet)}`);
    }
    if (search.resourceOrigin !== undefined) {
      where.push(`resource_origin = $${pushValue(search.resourceOrigin)}`);
    }
    if (search.operationId !== undefined) {
      const operationIdParam = pushValue(search.operationId);
      const wildcardParam = pushValue("*");
      where.push(
        `(operation_ids ? $${operationIdParam} or operation_ids ? $${wildcardParam})`
      );
    }
    const limitParam = pushValue(search.limit);
    const result = await this.db.query<RouteRow>(
      `select id, current_version, campaign_id, campaign_version_min, referrer_wallet,
              payout_wallet, resource_origin, operation_ids, claim_hash,
              claim_json, signing_bytes_hex, status, issued_at, expires_at,
              nonce, metadata_hash, created_at, activated_at
         from routes
        where ${where.join(" and ")}
        order by created_at desc, id desc
        limit $${limitParam}`,
      values
    );
    return result.rows.map(mapRoute);
  }

  private async getRouteByClaimHash(
    claimHash: `sha256:${string}`
  ): Promise<RouteRecord | undefined> {
    const result = await this.db.query<RouteRow>(
      `select id, current_version, campaign_id, campaign_version_min, referrer_wallet,
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

  private async getRouteVersionByClaimHash(
    claimHash: `sha256:${string}`
  ): Promise<RouteVersionRecord | undefined> {
    const result = await this.db.query<RouteVersionRow>(
      `select route_id, version, campaign_version_min, payout_wallet,
              claim_hash, claim_json, signing_bytes_hex, issued_at, expires_at,
              nonce, metadata_hash, created_at
         from route_versions
        where claim_hash = $1
        limit 1`,
      [claimHash]
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapRouteVersion(row);
  }

  private now(): string {
    return (this.options.now?.() ?? new Date()).toISOString();
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
    const payoutWalletsResult = await this.db.query<MerchantPayoutWalletRow>(
      `select id, merchant_id, network, wallet, asset_mint, signer_reference,
              status, created_at
         from merchant_payout_wallets
        where merchant_id = $1
        order by created_at, id`,
      [merchantId]
    );

    return {
      ...mapMerchant(merchantRow),
      origins: originsResult.rows.map(mapMerchantOrigin),
      keys: keysResult.rows.map(mapMerchantKey),
      payoutWallets: payoutWalletsResult.rows.map(mapMerchantPayoutWallet)
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

  async addPayoutWallet(
    input: AddMerchantPayoutWalletInput
  ): Promise<MerchantPayoutWalletRecord> {
    await this.assertMerchantExists(input.merchantId);
    const wallet: MerchantPayoutWalletRecord = {
      id: assertSplit402Id(
        input.id ??
          this.options.merchantPayoutWalletIdFactory?.() ??
          createMerchantPayoutWalletId(),
        "merchant payout wallet id"
      ),
      merchantId: input.merchantId,
      network: assertNonEmptyString(input.network, "network"),
      wallet: assertBase58PublicKey(input.wallet, "wallet"),
      asset: assertBase58PublicKey(input.asset, "asset"),
      signerReference: assertNonEmptyString(input.signerReference, "signerReference"),
      status: input.status ?? "active",
      createdAt: this.now()
    };
    assertMerchantPayoutWalletStatus(wallet.status);

    try {
      const result = await this.db.query<MerchantPayoutWalletRow>(
        `insert into merchant_payout_wallets (
           id, merchant_id, network, wallet, asset_mint, signer_reference,
           status, created_at
         ) values (
           $1, $2, $3, $4, $5, $6, $7, $8
         )
         returning id, merchant_id, network, wallet, asset_mint,
                   signer_reference, status, created_at`,
        [
          wallet.id,
          wallet.merchantId,
          wallet.network,
          wallet.wallet,
          wallet.asset,
          wallet.signerReference,
          wallet.status,
          wallet.createdAt
        ]
      );
      return mapMerchantPayoutWallet(requiredRow(result));
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

  async updateMerchantStatus(
    input: UpdateMerchantStatusInput
  ): Promise<MerchantRecord | undefined> {
    assertMerchantStatusTransition(input.status);
    const result = await this.db.query<MerchantRow>(
      `update merchants
          set status = $2,
              updated_at = $3
        where id = $1
        returning id, slug, display_name, owner_wallet, status, created_at, updated_at`,
      [input.merchantId, input.status, this.now()]
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapMerchant(row);
  }

  async updateOriginStatus(
    input: UpdateMerchantOriginStatusInput
  ): Promise<MerchantOriginRecord | undefined> {
    assertMerchantOriginStatusTransition(input.status);
    const verifiedAt = readOriginVerifiedAt(input, () => this.now());
    const result = await this.db.query<MerchantOriginRow>(
      `update merchant_origins
          set status = $3,
              verified_at = $4
        where merchant_id = $1
          and origin = $2
        returning merchant_id, origin, verification_method, status, verified_at, created_at`,
      [input.merchantId, input.origin, input.status, verifiedAt ?? null]
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapMerchantOrigin(row);
  }

  async updatePayoutWalletStatus(
    input: UpdateMerchantPayoutWalletStatusInput
  ): Promise<MerchantPayoutWalletRecord | undefined> {
    assertMerchantPayoutWalletStatus(input.status);
    const result = await this.db.query<MerchantPayoutWalletRow>(
      `update merchant_payout_wallets
          set status = $3
        where merchant_id = $1
          and id = $2
          and (status <> 'retired' or $3 = 'retired')
        returning id, merchant_id, network, wallet, asset_mint, signer_reference,
                  status, created_at`,
      [input.merchantId, input.payoutWalletId, input.status]
    );
    const row = result.rows[0];
    if (row !== undefined) {
      return mapMerchantPayoutWallet(row);
    }

    const existing = await this.db.query<MerchantPayoutWalletRow>(
      `select id, merchant_id, network, wallet, asset_mint, signer_reference,
              status, created_at
         from merchant_payout_wallets
        where merchant_id = $1
        order by created_at, id`,
      [input.merchantId]
    );
    const wallet = existing.rows.find(
      (candidate) => candidate.id === input.payoutWalletId
    );
    if (wallet === undefined) {
      return undefined;
    }
    assertPayoutWalletStatusTransition(
      wallet.status as MerchantPayoutWalletRecord["status"],
      input.status
    );
    return mapMerchantPayoutWallet(wallet);
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

  async saveRefreshToken(
    tokenHash: string,
    refreshToken: WalletAuthRefreshTokenRecord
  ): Promise<void> {
    await this.db.query(
      `insert into wallet_auth_refresh_tokens (
         token_hash, refresh_token_id, session_id, wallet, network, purpose,
         challenge_id, issued_at, expires_at, revoked_at, replaced_by_session_id
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
       )`,
      [
        tokenHash,
        refreshToken.refreshTokenId,
        refreshToken.sessionId,
        refreshToken.wallet,
        refreshToken.network,
        refreshToken.purpose,
        refreshToken.challengeId,
        refreshToken.issuedAt,
        refreshToken.expiresAt,
        refreshToken.revokedAt ?? null,
        refreshToken.replacedBySessionId ?? null
      ]
    );
  }

  async getRefreshToken(
    tokenHash: string
  ): Promise<WalletAuthRefreshTokenRecord | undefined> {
    const result = await this.db.query<WalletAuthRefreshTokenRow>(
      `select token_hash, refresh_token_id, session_id, wallet, network, purpose,
              challenge_id, issued_at, expires_at, revoked_at, replaced_by_session_id
         from wallet_auth_refresh_tokens
        where token_hash = $1
        limit 1`,
      [tokenHash]
    );
    const row = result.rows[0];
    return row === undefined ? undefined : mapWalletAuthRefreshToken(row);
  }

  async revokeRefreshToken(
    tokenHash: string,
    revokedAt: string,
    replacedBySessionId?: string
  ): Promise<boolean> {
    const result = await this.db.query<Pick<WalletAuthRefreshTokenRow, "token_hash">>(
      `update wallet_auth_refresh_tokens
          set revoked_at = $2,
              replaced_by_session_id = $3
        where token_hash = $1
          and revoked_at is null
        returning token_hash`,
      [tokenHash, revokedAt, replacedBySessionId ?? null]
    );
    return result.rows[0] !== undefined;
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
      version.terms.protocolFeeBpsOfCommission,
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
  const version: RouteVersionRecord = {
    routeId: route.id,
    version: route.currentVersion,
    campaignVersionMin: route.campaignVersionMin,
    payoutWallet: route.payoutWallet,
    claimHash: route.claimHash,
    claim: route.claim,
    signingBytesHex: route.signingBytesHex,
    issuedAt: route.issuedAt,
    expiresAt: route.expiresAt,
    nonce: route.nonce,
    ...(route.metadataHash === undefined ? {} : { metadataHash: route.metadataHash }),
    createdAt: route.activatedAt
  };
  return client.query(
    `insert into routes (
       id, current_version, campaign_id, campaign_version_min, referrer_wallet,
       payout_wallet, resource_origin, operation_ids, claim_hash, claim_json,
       signing_bytes_hex, status, issued_at, expires_at, nonce, metadata_hash,
       created_at, activated_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10::jsonb, $11, $12, $13,
       $14, $15, $16, $17, $18
     )`,
    [
      route.id,
      route.currentVersion,
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
  ).then(async (result) => {
    await insertRouteVersion(client, version);
    return result;
  });
}

function insertRouteVersion(
  client: PostgresQueryExecutor,
  version: RouteVersionRecord
): Promise<QueryResult> {
  return client.query(
    `insert into route_versions (
       route_id, version, campaign_version_min, payout_wallet, claim_hash,
       claim_json, signing_bytes_hex, issued_at, expires_at, nonce,
       metadata_hash, created_at
     ) values (
       $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12
     )`,
    [
      version.routeId,
      version.version,
      version.campaignVersionMin,
      version.payoutWallet,
      version.claimHash,
      JSON.stringify(version.claim),
      version.signingBytesHex,
      version.issuedAt,
      version.expiresAt,
      version.nonce,
      version.metadataHash ?? null,
      version.createdAt
    ]
  );
}

async function updateRouteCurrentVersion(
  client: PostgresQueryExecutor,
  route: RouteRecord
): Promise<RouteRecord | undefined> {
  const result = await client.query<RouteRow>(
    `update routes
        set current_version = $2,
            campaign_version_min = $3,
            payout_wallet = $4,
            claim_hash = $5,
            claim_json = $6::jsonb,
            signing_bytes_hex = $7,
            issued_at = $8,
            expires_at = $9,
            nonce = $10,
            metadata_hash = $11
      where id = $1
        and current_version = $12
      returning id, current_version, campaign_id, campaign_version_min,
                referrer_wallet, payout_wallet, resource_origin, operation_ids,
                claim_hash, claim_json, signing_bytes_hex, status, issued_at,
                expires_at, nonce, metadata_hash, created_at, activated_at`,
    [
      route.id,
      route.currentVersion,
      route.campaignVersionMin,
      route.payoutWallet,
      route.claimHash,
      JSON.stringify(route.claim),
      route.signingBytesHex,
      route.issuedAt,
      route.expiresAt,
      route.nonce,
      route.metadataHash ?? null,
      route.currentVersion - 1
    ]
  );
  const row = result.rows[0];
  return row === undefined ? undefined : mapRoute(row);
}

function assertPostgresRouteRotation(
  existing: RouteRecord,
  validated: RouteRecord
): void {
  if (validated.id !== existing.id) {
    throw new RouteRegistryValidationError("rotated claim routeId must match route");
  }
  if (validated.campaignId !== existing.campaignId) {
    throw new RouteRegistryValidationError(
      "rotated claim campaignId must match route"
    );
  }
  if (validated.campaignVersionMin !== existing.campaignVersionMin) {
    throw new RouteRegistryValidationError(
      "rotated claim campaignVersionMin must match route"
    );
  }
  if (validated.referrerWallet !== existing.referrerWallet) {
    throw new RouteRegistryValidationError(
      "rotated claim referrerWallet must match route"
    );
  }
  if (validated.resourceOrigin !== existing.resourceOrigin) {
    throw new RouteRegistryValidationError(
      "rotated claim resourceOrigin must match route"
    );
  }
  if (!routeOperationScopesEqual(validated.operationIds, existing.operationIds)) {
    throw new RouteRegistryValidationError(
      "rotated claim operationIds must match route"
    );
  }
}

function routeOperationScopesEqual(
  left: RouteOperationScope,
  right: RouteOperationScope
): boolean {
  return (
    left.length === right.length &&
    left.every((operationId, index) => operationId === right[index])
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
       receipt_json, source, verification_state, verification_reason,
       ingestion_state, created_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16, $17
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
      receiptRecord.verificationReason ?? null,
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

async function selectPayoutEligibleAccruals(
  db: PostgresQueryExecutor,
  input: ListPayoutEligibleAccrualsInput,
  options: { forUpdateSkipLocked?: boolean } = {}
): Promise<CommissionAccrual[]> {
  const now = input.now ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(now))) {
    throw new MerchantRegistryValidationError("now must be an ISO timestamp");
  }
  if (
    input.limit !== undefined &&
    (!Number.isInteger(input.limit) || input.limit <= 0)
  ) {
    throw new MerchantRegistryValidationError("limit must be a positive integer");
  }

  const values: unknown[] = [input.merchantId, now];
  const conditions = [
    "merchant_id = $1",
    "status = 'available'",
    "(available_at is null or available_at <= $2)"
  ];
  if (input.asset !== undefined) {
    values.push(input.asset);
    conditions.push(`asset_mint = $${values.length}`);
  }
  if (input.campaignId !== undefined) {
    values.push(input.campaignId);
    conditions.push(`campaign_id = $${values.length}`);
  }
  if (input.routeId !== undefined) {
    values.push(input.routeId);
    conditions.push(`route_id = $${values.length}`);
  }

  let limitClause = "";
  if (input.limit !== undefined) {
    values.push(input.limit);
    limitClause = `limit $${values.length}`;
  }
  const lockClause = options.forUpdateSkipLocked === true
    ? "for update skip locked"
    : "";

  const result = await db.query<CommissionAccrualRow>(
    `select id, receipt_id, merchant_id, campaign_id, route_id, referrer_wallet,
            payout_wallet, asset_mint, amount_atomic, status, available_at,
            created_at
       from commission_accruals
      where ${conditions.join("\n        and ")}
      order by asset_mint, payout_wallet, available_at nulls first, created_at, id
      ${limitClause}
      ${lockClause}`,
    values
  );
  return result.rows.map(mapAccrual);
}

async function allocateAndInsertPayoutBatch(
  client: PostgresQueryExecutor,
  batch: PayoutBatchRecord
): Promise<void> {
  for (const item of batch.items) {
    for (const allocation of item.allocations) {
      const result = await client.query<Pick<CommissionAccrualRow, "id">>(
        `update commission_accruals
            set status = 'allocated'
          where id = $1
            and merchant_id = $2
            and asset_mint = $3
            and status = 'available'
          returning id`,
        [allocation.accrualId, batch.merchantId, batch.asset]
      );
      if (result.rows[0] === undefined) {
        throw new PayoutBatchConflictError(
          `accrual is not available for payout: ${allocation.accrualId}`
        );
      }
    }
  }

  await insertPayoutBatch(client, batch);
  for (const item of batch.items) {
    await insertPayoutItem(client, item);
    for (const allocation of item.allocations) {
      await insertPayoutAllocation(client, allocation);
    }
  }
}

function insertPayoutBatch(
  client: PostgresQueryExecutor,
  batch: PayoutBatchRecord
): Promise<QueryResult> {
  return client.query(
    `insert into payout_batches (
       id, merchant_id, payout_wallet_id, network, asset_mint, status,
       total_amount_atomic, item_count, accrual_count, failure_code,
       failure_message, created_at, updated_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
     )`,
    [
      batch.id,
      batch.merchantId,
      batch.payoutWalletId,
      batch.network,
      batch.asset,
      batch.status,
      batch.totalAmountAtomic,
      batch.itemCount,
      batch.accrualCount,
      batch.failureCode ?? null,
      batch.failureMessage ?? null,
      batch.createdAt,
      batch.updatedAt
    ]
  );
}

function insertPayoutItem(
  client: PostgresQueryExecutor,
  item: PayoutItemRecord
): Promise<QueryResult> {
  return client.query(
    `insert into payout_items (
       id, payout_batch_id, destination_wallet, destination_token_account,
       amount_atomic, status, created_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7
     )`,
    [
      item.id,
      item.payoutBatchId,
      item.destinationWallet,
      item.destinationTokenAccount ?? null,
      item.amountAtomic,
      item.status,
      item.createdAt
    ]
  );
}

function insertPayoutAllocation(
  client: PostgresQueryExecutor,
  allocation: PayoutAllocationRecord
): Promise<QueryResult> {
  return client.query(
    `insert into payout_allocations (
       payout_item_id, accrual_id, amount_atomic
     ) values (
       $1, $2, $3
     )`,
    [
      allocation.payoutItemId,
      allocation.accrualId,
      allocation.amountAtomic
    ]
  );
}

async function markBatchAccrualsPaid(
  client: PostgresQueryExecutor,
  batch: PayoutBatchRecord
): Promise<void> {
  const finalizedAccrualIds = batch.items
    .filter((item) => item.status === "finalized")
    .flatMap((item) => item.allocations.map((allocation) => allocation.accrualId));
  for (const accrualId of finalizedAccrualIds) {
    await client.query(
      `update commission_accruals
          set status = 'paid'
        where id = $1
          and status = 'allocated'`,
      [accrualId]
    );
  }
}

async function markPayoutBatchAllocationsReleased(
  client: PostgresQueryExecutor,
  batch: PayoutBatchRecord
): Promise<void> {
  await client.query(
    `update payout_batches
        set status = $2,
            failure_code = $3,
            failure_message = $4,
            updated_at = $5
      where id = $1`,
    [
      batch.id,
      batch.status,
      batch.failureCode ?? null,
      batch.failureMessage ?? null,
      batch.updatedAt
    ]
  );
  await client.query(
    `update payout_items
        set status = 'released'
      where payout_batch_id = $1`,
    [batch.id]
  );
  await client.query(
    `update commission_accruals ca
        set status = 'available'
       from payout_allocations pa
       join payout_items pi on pi.id = pa.payout_item_id
      where ca.id = pa.accrual_id
        and pi.payout_batch_id = $1
        and ca.status = 'allocated'`,
    [batch.id]
  );
}

function insertPayoutTransaction(
  client: PostgresQueryExecutor,
  transaction: PayoutTransactionRecord
): Promise<QueryResult> {
  return client.query(
    `insert into payout_transactions (
       id, payout_batch_id, sequence, attempt, recent_blockhash,
       last_valid_block_height, signed_transaction_base64, expected_signature,
       status, submitted_at, confirmed_at, finalized_at, error_json, created_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
     )`,
    [
      transaction.id,
      transaction.payoutBatchId,
      transaction.sequence,
      transaction.attempt,
      transaction.recentBlockhash ?? null,
      transaction.lastValidBlockHeight ?? null,
      transaction.signedTransactionBase64 ?? null,
      transaction.expectedSignature ?? null,
      transaction.status,
      transaction.submittedAt ?? null,
      transaction.confirmedAt ?? null,
      transaction.finalizedAt ?? null,
      transaction.error === undefined ? null : JSON.stringify(transaction.error),
      transaction.createdAt
    ]
  );
}

function insertPayoutTransactionItem(
  client: PostgresQueryExecutor,
  item: PayoutTransactionItemRecord
): Promise<QueryResult> {
  return client.query(
    `insert into payout_transaction_items (
       payout_transaction_id, payout_item_id, amount_atomic,
       destination_wallet, destination_token_account
     ) values (
       $1, $2, $3, $4, $5
     )`,
    [
      item.payoutTransactionId,
      item.payoutItemId,
      item.amountAtomic,
      item.destinationWallet,
      item.destinationTokenAccount ?? null
    ]
  );
}

async function listPayoutTransactionItems(
  db: PostgresQueryExecutor,
  payoutTransactionIds: readonly string[]
): Promise<PayoutTransactionItemRecord[]> {
  if (payoutTransactionIds.length === 0) {
    return [];
  }
  const result = await db.query<PayoutTransactionItemRow>(
    `select payout_transaction_id, payout_item_id, amount_atomic,
            destination_wallet, destination_token_account
       from payout_transaction_items
      where payout_transaction_id = any($1)
      order by payout_transaction_id, payout_item_id`,
    [payoutTransactionIds]
  );
  return result.rows.map(mapPayoutTransactionItem);
}

async function rollUpPayoutBatchFinality(
  db: PostgresQueryExecutor,
  payoutBatchId: string,
  updatedAt: string
): Promise<void> {
  const result = await db.query<PayoutTransactionRow>(
    `select id, payout_batch_id, sequence, attempt, recent_blockhash,
            last_valid_block_height, signed_transaction_base64,
            expected_signature, status, submitted_at, confirmed_at,
            finalized_at, error_json, created_at
       from payout_transactions
      where payout_batch_id = $1
      order by sequence, attempt, created_at, id`,
    [payoutBatchId]
  );
  const batch = await loadPayoutBatch(db, payoutBatchId);
  if (batch === undefined) {
    return;
  }
  const transactions = mapPayoutTransactionsWithItems(
    result.rows,
    await listPayoutTransactionItems(db, result.rows.map((row) => row.id))
  );
  const rollup = summarizePayoutBatchTransactionItemFinality({
    batch,
    transactions
  });
  if (rollup === undefined) {
    return;
  }
  await db.query(
    `update payout_batches
        set status = $2,
            failure_code = $3,
            failure_message = $4,
            updated_at = $5
      where id = $1`,
    [
      payoutBatchId,
      rollup.batchStatus,
      rollup.failureCode ?? null,
      rollup.failureMessage ?? null,
      updatedAt
    ]
  );
  for (const item of rollup.updatedItems) {
    await db.query(
      `update payout_items
          set status = $2
        where id = $1`,
      [item.payoutItemId, item.status]
    );
  }
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
    outboxEventValues(event)
  );
}

function insertOutboxEventOnce(
  client: PostgresQueryExecutor,
  event: OutboxEventRecord
): Promise<QueryResult> {
  return client.query(
    `insert into outbox_events (
       id, event_type, aggregate_type, aggregate_id, payload, status, attempts,
       available_at, locked_at, last_error, created_at
     ) values (
       $1::uuid, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11
     )
     on conflict (event_type, aggregate_type, aggregate_id) do nothing`,
    outboxEventValues(event)
  );
}

function outboxEventValues(event: OutboxEventRecord): readonly unknown[] {
  return [
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
  ];
}

function createReceiptAcceptedOutboxEvent(
  snapshot: ReceiptIngestionSnapshot,
  id: string
): OutboxEventRecord {
  return createReceiptOutboxEvent(snapshot, id, "receipt.accepted.v1");
}

function createWebhookReceiptAcceptedOutboxEvent(
  snapshot: ReceiptIngestionSnapshot,
  id: string
): OutboxEventRecord {
  return createReceiptOutboxEvent(snapshot, id, "webhook.receipt.accepted.v1");
}

function createReceiptOutboxEvent(
  snapshot: ReceiptIngestionSnapshot,
  id: string,
  eventType: "receipt.accepted.v1" | "webhook.receipt.accepted.v1"
): OutboxEventRecord {
  const receipt = snapshot.receipt.receipt;
  return {
    id,
    eventType,
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

function createPayoutFinalizedOutboxEvent(
  batch: PayoutBatchRecord,
  transaction: LedgerTransaction,
  id: string,
  eventType: "payout.finalized.v1" | typeof WEBHOOK_PAYOUT_FINALIZED_EVENT_TYPE
): OutboxEventRecord {
  return {
    id,
    eventType,
    aggregateType: "payout_batch",
    aggregateId: batch.id,
    payload: {
      payoutBatchId: batch.id,
      merchantId: batch.merchantId,
      payoutWalletId: batch.payoutWalletId,
      network: batch.network,
      asset: batch.asset,
      status: batch.status,
      totalAmountAtomic: batch.totalAmountAtomic,
      itemCount: batch.itemCount,
      accrualCount: batch.accrualCount,
      ledgerTransactionId: transaction.id,
      finalizedAt: transaction.createdAt,
      items: batch.items.map((item) => ({
        payoutItemId: item.id,
        destinationWallet: item.destinationWallet,
        destinationTokenAccount: item.destinationTokenAccount ?? null,
        amountAtomic: item.amountAtomic,
        status: item.status,
        accrualIds: item.allocations.map((allocation) => allocation.accrualId)
      }))
    },
    status: "pending",
    attempts: 0,
    availableAt: transaction.createdAt,
    createdAt: transaction.createdAt
  };
}

function createPayoutLifecycleOutboxEvent(
  batch: PayoutBatchRecord,
  transaction: PayoutTransactionRecord,
  id: string,
  kind: PayoutLifecycleEventKind,
  webhook: boolean,
  occurredAt: string
): OutboxEventRecord {
  return {
    id,
    eventType: webhook
      ? payoutLifecycleWebhookEventType(kind)
      : `payout.${kind}.v1`,
    aggregateType: "payout_batch",
    aggregateId: batch.id,
    payload: {
      payoutBatchId: batch.id,
      payoutTransactionId: transaction.id,
      merchantId: batch.merchantId,
      payoutWalletId: batch.payoutWalletId,
      network: batch.network,
      asset: batch.asset,
      status: batch.status,
      transactionStatus: transaction.status,
      totalAmountAtomic: batch.totalAmountAtomic,
      itemCount: batch.itemCount,
      accrualCount: batch.accrualCount,
      expectedSignature: transaction.expectedSignature ?? null,
      submittedAt: transaction.submittedAt ?? null,
      confirmedAt: transaction.confirmedAt ?? null,
      finalizedAt: transaction.finalizedAt ?? null,
      failureCode: batch.failureCode ?? null,
      failureMessage: batch.failureMessage ?? null,
      transactionError: transaction.error ?? null,
      occurredAt
    },
    status: "pending",
    attempts: 0,
    availableAt: occurredAt,
    createdAt: occurredAt
  };
}

function payoutLifecycleWebhookEventType(kind: PayoutLifecycleEventKind): string {
  switch (kind) {
    case "submitted":
      return WEBHOOK_PAYOUT_SUBMITTED_EVENT_TYPE;
    case "confirmed":
      return WEBHOOK_PAYOUT_CONFIRMED_EVENT_TYPE;
    case "failed":
      return WEBHOOK_PAYOUT_FAILED_EVENT_TYPE;
    case "outcome_unknown":
      return WEBHOOK_PAYOUT_OUTCOME_UNKNOWN_EVENT_TYPE;
  }
}

function payoutLifecycleKindForFinalityStatus(
  status: MarkPayoutTransactionFinalityInput["status"]
): PayoutLifecycleEventKind | undefined {
  switch (status) {
    case "confirmed":
      return "confirmed";
    case "failed":
      return "failed";
    case "expired":
    case "outcome_unknown":
      return "outcome_unknown";
    case "finalized":
      return undefined;
  }
}

function doesBatchMatchPayoutLifecycleKind(
  batch: PayoutBatchRecord,
  kind: PayoutLifecycleEventKind
): boolean {
  switch (kind) {
    case "submitted":
      return batch.status === "submitted";
    case "confirmed":
      return batch.status === "confirmed";
    case "failed":
      return batch.status === "failed";
    case "outcome_unknown":
      return batch.status === "outcome_unknown";
  }
}

async function loadPayoutBatch(
  db: PostgresQueryExecutor,
  batchId: string
): Promise<PayoutBatchRecord | undefined> {
  const batchResult = await db.query<PayoutBatchRow>(
    `select id, merchant_id, payout_wallet_id, network, asset_mint, status,
            total_amount_atomic, item_count, accrual_count, failure_code,
            failure_message, created_at, updated_at
       from payout_batches
      where id = $1
      limit 1`,
    [batchId]
  );
  const batchRow = batchResult.rows[0];
  if (batchRow === undefined) {
    return undefined;
  }
  const itemsResult = await db.query<PayoutItemRow>(
    `select id, payout_batch_id, destination_wallet, destination_token_account,
            amount_atomic, status, created_at
       from payout_items
      where payout_batch_id = $1
      order by created_at, id`,
    [batchId]
  );
  const allocationsResult = await db.query<PayoutAllocationRow>(
    `select payout_item_id, accrual_id, amount_atomic
       from payout_allocations
      where payout_item_id = any($1)
      order by payout_item_id, accrual_id`,
    [itemsResult.rows.map((item) => item.id)]
  );
  return mapPayoutBatch(batchRow, itemsResult.rows, allocationsResult.rows);
}

function normalizeOutboxEventTypes(
  eventTypes: string[] | undefined
): string[] | null {
  if (eventTypes === undefined) {
    return null;
  }
  if (eventTypes.length === 0) {
    throw new Error("eventTypes must not be empty");
  }
  return eventTypes;
}

function assertOutboxListLimit(value: number): number {
  if (!Number.isInteger(value) || value <= 0 || value > 100) {
    throw new Error("limit must be an integer from 1 to 100");
  }
  return value;
}

function normalizePayoutReconciliationLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return 50;
  }
  if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
    throw new PayoutBatchConflictError(
      "payout reconciliation limit must be between 1 and 500"
    );
  }
  return limit;
}

function mapReceiptRecord(row: PaymentReceiptRow): ReceiptRecord {
  const parsedReceipt = parseReceiptJson(row.receipt_json);
  return {
    id: row.id,
    receiptHash: row.receipt_hash,
    receipt: parsedReceipt,
    source: readReceiptSource(row.source),
    verificationState: readReceiptVerificationState(row.verification_state),
    ...(row.verification_reason === null
      ? {}
      : { verificationReason: row.verification_reason }),
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
  if (row.source_type !== "commission_accrual" && row.source_type !== "payout_batch") {
    throw new Error(`unsupported ledger source type: ${row.source_type}`);
  }

  return {
    id: row.id,
    sourceType: row.source_type,
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

function mapPayoutBatch(
  batch: PayoutBatchRow,
  itemRows: PayoutItemRow[],
  allocationRows: PayoutAllocationRow[]
): PayoutBatchRecord {
  const allocationsByItemId = new Map<string, PayoutAllocationRecord[]>();
  for (const row of allocationRows) {
    const allocation = mapPayoutAllocation(row);
    allocationsByItemId.set(row.payout_item_id, [
      ...(allocationsByItemId.get(row.payout_item_id) ?? []),
      allocation
    ]);
  }
  return {
    id: batch.id,
    merchantId: batch.merchant_id,
    payoutWalletId: batch.payout_wallet_id,
    network: batch.network,
    asset: batch.asset_mint,
    status: readPayoutBatchStatus(batch.status),
    totalAmountAtomic: batch.total_amount_atomic,
    itemCount: batch.item_count,
    accrualCount: batch.accrual_count,
    ...(batch.failure_code === null ? {} : { failureCode: batch.failure_code }),
    ...(batch.failure_message === null
      ? {}
      : { failureMessage: batch.failure_message }),
    createdAt: toIsoString(batch.created_at),
    updatedAt: toIsoString(batch.updated_at),
    items: itemRows.map((item) =>
      mapPayoutItem(item, allocationsByItemId.get(item.id) ?? [])
    )
  };
}

function mapPayoutItem(
  row: PayoutItemRow,
  allocations: PayoutAllocationRecord[]
): PayoutItemRecord {
  return {
    id: row.id,
    payoutBatchId: row.payout_batch_id,
    destinationWallet: row.destination_wallet,
    ...(row.destination_token_account === null
      ? {}
      : { destinationTokenAccount: row.destination_token_account }),
    amountAtomic: row.amount_atomic,
    status: readPayoutItemStatus(row.status),
    createdAt: toIsoString(row.created_at),
    allocations
  };
}

function mapPayoutAllocation(row: PayoutAllocationRow): PayoutAllocationRecord {
  return {
    payoutItemId: row.payout_item_id,
    accrualId: row.accrual_id,
    amountAtomic: row.amount_atomic
  };
}

function mapPayoutTransaction(row: PayoutTransactionRow): PayoutTransactionRecord {
  return {
    id: row.id,
    payoutBatchId: row.payout_batch_id,
    sequence: row.sequence,
    attempt: row.attempt,
    ...(row.recent_blockhash === null
      ? {}
      : { recentBlockhash: row.recent_blockhash }),
    ...(row.last_valid_block_height === null
      ? {}
      : { lastValidBlockHeight: Number(row.last_valid_block_height) }),
    ...(row.signed_transaction_base64 === null
      ? {}
      : { signedTransactionBase64: row.signed_transaction_base64 }),
    ...(row.expected_signature === null
      ? {}
      : { expectedSignature: row.expected_signature }),
    status: readPayoutTransactionStatus(row.status),
    ...(row.submitted_at === null
      ? {}
      : { submittedAt: toIsoString(row.submitted_at) }),
    ...(row.confirmed_at === null
      ? {}
      : { confirmedAt: toIsoString(row.confirmed_at) }),
    ...(row.finalized_at === null
      ? {}
      : { finalizedAt: toIsoString(row.finalized_at) }),
    ...(row.error_json === null ? {} : { error: parseOptionalJsonObject(row.error_json) }),
    createdAt: toIsoString(row.created_at),
    items: []
  };
}

function mapPayoutTransactionsWithItems(
  rows: readonly PayoutTransactionRow[],
  itemRows: readonly PayoutTransactionItemRecord[]
): PayoutTransactionRecord[] {
  const itemsByTransactionId = new Map<string, PayoutTransactionItemRecord[]>();
  for (const item of itemRows) {
    itemsByTransactionId.set(item.payoutTransactionId, [
      ...(itemsByTransactionId.get(item.payoutTransactionId) ?? []),
      item
    ]);
  }
  return rows.map((row) => ({
    ...mapPayoutTransaction(row),
    items: itemsByTransactionId.get(row.id) ?? []
  }));
}

function mapPayoutTransactionItem(
  row: PayoutTransactionItemRow
): PayoutTransactionItemRecord {
  return {
    payoutTransactionId: row.payout_transaction_id,
    payoutItemId: row.payout_item_id,
    amountAtomic: row.amount_atomic,
    destinationWallet: row.destination_wallet,
    ...(row.destination_token_account === null
      ? {}
      : { destinationTokenAccount: row.destination_token_account })
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

function parseOptionalJsonObject(value: unknown): Record<string, unknown> {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("json value must be an object");
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
  if (
    value === "signature_verified" ||
    value === "pending_chain_verification" ||
    value === "chain_rejected"
  ) {
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
    value === "held" ||
    value === "allocated" ||
    value === "paid" ||
    value === "rejected" ||
    value === "reversed"
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

function readPayoutBatchStatus(value: string): PayoutBatchStatus {
  if (
    value === "draft" ||
    value === "planned" ||
    value === "signing" ||
    value === "submitted" ||
    value === "confirmed" ||
    value === "finalized" ||
    value === "failed" ||
    value === "cancelled" ||
    value === "outcome_unknown"
  ) {
    return value;
  }
  throw new Error(`unsupported payout batch status: ${value}`);
}

function readPayoutItemStatus(value: string): PayoutItemStatus {
  if (
    value === "allocated" ||
    value === "submitted" ||
    value === "confirmed" ||
    value === "finalized" ||
    value === "failed" ||
    value === "released"
  ) {
    return value;
  }
  throw new Error(`unsupported payout item status: ${value}`);
}

function readPayoutTransactionStatus(value: string): PayoutTransactionStatus {
  if (
    value === "planned" ||
    value === "signed" ||
    value === "submitted" ||
    value === "confirmed" ||
    value === "finalized" ||
    value === "expired" ||
    value === "failed" ||
    value === "outcome_unknown"
  ) {
    return value;
  }
  throw new Error(`unsupported payout transaction status: ${value}`);
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function normalizeDateInput(value: string | undefined, label: string): string {
  const date = value === undefined ? new Date() : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`${label} must be an ISO timestamp`);
  }
  return date.toISOString();
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

function mapMerchantPayoutWallet(
  row: MerchantPayoutWalletRow
): MerchantPayoutWalletRecord {
  return {
    id: row.id,
    merchantId: row.merchant_id,
    network: row.network,
    wallet: row.wallet,
    asset: row.asset_mint,
    signerReference: row.signer_reference,
    status: readMerchantPayoutWalletStatus(row.status),
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

function mapWalletAuthRefreshToken(
  row: WalletAuthRefreshTokenRow
): WalletAuthRefreshTokenRecord {
  return {
    refreshTokenId: row.refresh_token_id,
    sessionId: row.session_id,
    wallet: row.wallet,
    network: row.network,
    purpose: readWalletAuthPurpose(row.purpose),
    challengeId: row.challenge_id,
    issuedAt: toIsoString(row.issued_at),
    expiresAt: toIsoString(row.expires_at),
    ...(row.revoked_at === null ? {} : { revokedAt: toIsoString(row.revoked_at) }),
    ...(row.replaced_by_session_id === null
      ? {}
      : { replacedBySessionId: row.replaced_by_session_id })
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
    currentVersion: row.current_version,
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

function mapRouteVersion(row: RouteVersionRow): RouteVersionRecord {
  return {
    routeId: row.route_id,
    version: row.version,
    campaignVersionMin: row.campaign_version_min,
    payoutWallet: row.payout_wallet,
    claimHash: row.claim_hash,
    claim: parseReferralClaimJson(row.claim_json),
    signingBytesHex: row.signing_bytes_hex,
    issuedAt: toIsoString(row.issued_at),
    expiresAt: toIsoString(row.expires_at),
    nonce: row.nonce,
    ...(row.metadata_hash === null ? {} : { metadataHash: row.metadata_hash }),
    createdAt: toIsoString(row.created_at)
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
    protocolFeeBpsOfCommission: readJsonNumber(
      terms.protocolFeeBpsOfCommission ?? terms.protocolFeeBps,
      "protocolFeeBpsOfCommission"
    ),
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

function assertCampaignListLimit(value: number): number {
  if (!Number.isInteger(value) || value <= 0 || value > 100) {
    throw new CampaignRegistryValidationError("limit must be an integer from 1 to 100");
  }
  return value;
}

function assertCampaignStatus(value: CampaignStatus): CampaignStatus {
  if (
    value === "draft" ||
    value === "active" ||
    value === "paused" ||
    value === "closed"
  ) {
    return value;
  }
  throw new CampaignRegistryValidationError(
    "status must be draft, active, paused, or closed"
  );
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

function assertMerchantPayoutWalletStatus(
  value: MerchantPayoutWalletStatus
): void {
  readMerchantPayoutWalletStatus(value);
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

function readMerchantPayoutWalletStatus(value: string): MerchantPayoutWalletStatus {
  if (value === "active" || value === "paused" || value === "retired") {
    return value;
  }
  throw new Error(`unsupported merchant payout wallet status: ${value}`);
}

function createMerchantPayoutWalletId(): string {
  return `mpw_${randomUUID().replaceAll("-", "")}`;
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
