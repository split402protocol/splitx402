import {
  ReferralClaimV1Schema,
  Split402ReceiptV1Schema,
  hashProtocolObject,
  verifySplit402ReceiptObject,
  type ReferralClaimV1,
  type Split402ReceiptV1
} from "@split402/protocol";
import express from "express";
import type { NextFunction, Request, Response, Router } from "express";
import { Pool, type PoolConfig } from "pg";

import {
  WalletAuthenticator,
  isWalletAuthRejectedError,
  isWalletAuthValidationError,
  type AuthenticatedWalletSession,
  type WalletAuthenticatorOptions,
  type WalletAuthPurpose
} from "./auth.js";
import {
  CampaignRegistryValidationError,
  isCampaignRegistryConflictError,
  isCampaignRegistryValidationError,
  type CampaignCommissionBase,
  type CampaignOperation,
  type CampaignProfile,
  type CampaignRegistry,
  type CampaignTermsInput
} from "./campaigns.js";
import { isReceiptIngestionPersistenceConflict } from "./errors.js";
import {
  createMerchantReceiptKeyResolver,
  MerchantRegistryValidationError,
  isMerchantRegistryConflict,
  isMerchantRegistryValidationError,
  type MerchantKeyAlgorithm,
  type MerchantKeyPurpose,
  type MerchantOriginStatus,
  type MerchantOriginVerificationMethod,
  type MerchantPayoutWalletStatus,
  type MerchantRegistry,
  type MerchantStatus
} from "./merchants.js";
import {
  RouteRegistryValidationError,
  isRouteRegistryConflictError,
  isRouteRegistryValidationError,
  type RouteOperationScope,
  type RouteRegistry,
  type RouteStatus
} from "./routes.js";
import {
  PostgresCampaignRegistry,
  PostgresMerchantRegistry,
  PostgresOutboxEventStore,
  PostgresReceiptIngestionStore,
  PostgresRouteRegistry,
  PostgresWalletAuthStore,
  type PostgresPool
} from "./postgres.js";
import {
  PayoutBatchConflictError,
  createPayoutBatchPlan,
  createSignedPayoutTransactionRecords,
  createPayoutPreview,
  filterPayoutEligibleAccruals,
  isPayoutBatchConflictError,
  isPayoutBatchValidationError,
  isPayoutPreviewValidationError,
  type CreatePayoutBatchFromAvailableAccrualsInput,
  type ListPayoutEligibleAccrualsInput,
  type PayoutAccrualStore,
  type PayoutBatchRecord,
  type PayoutBatchStore,
  type PayoutFundingBalance,
  type PayoutTransactionRecord,
  type PayoutTransactionStore,
  type MarkPayoutTransactionSubmittedInput,
  type SaveSignedPayoutTransactionsInput
} from "./payouts.js";

export type ReceiptIngestSource = "buyer" | "merchant" | "relay" | "unknown";
export type ReceiptVerificationState =
  | "signature_verified"
  | "pending_chain_verification";
export type AccrualStatus =
  | "pending_chain_verification"
  | "available"
  | "held"
  | "allocated";
export type LedgerAccountType =
  | "merchant_commission_liability"
  | "referrer_payable"
  | "protocol_fee_payable";
export type OutboxEventStatus =
  | "pending"
  | "processing"
  | "delivered"
  | "dead_letter";

export interface ReceiptRecord {
  id: string;
  receiptHash: `sha256:${string}`;
  receipt: Split402ReceiptV1;
  source: ReceiptIngestSource;
  verificationState: ReceiptVerificationState;
  ingestionState: "accepted";
  createdAt: string;
}

export interface CommissionAccrual {
  id: string;
  receiptId: string;
  merchantId: string;
  campaignId: string;
  routeId: string;
  referrerWallet: string;
  payoutWallet: string;
  asset: string;
  amountAtomic: string;
  status: AccrualStatus;
  availableAt?: string;
  createdAt: string;
}

export interface LedgerTransaction {
  id: string;
  sourceType: "commission_accrual";
  sourceId: string;
  asset: string;
  entries: LedgerEntry[];
  createdAt: string;
}

export interface LedgerEntry {
  id: string;
  transactionId: string;
  accountType: LedgerAccountType;
  accountReference: string;
  asset: string;
  amountAtomic: string;
}

export interface OutboxEventRecord {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  status: OutboxEventStatus;
  attempts: number;
  availableAt: string;
  lockedAt?: string;
  lastError?: string;
  createdAt: string;
}

export interface ClaimNextOutboxEventInput {
  eventTypes?: string[];
  now?: string;
}

export interface MarkOutboxEventDeliveredInput {
  eventId: string;
}

export interface MarkOutboxEventFailedInput {
  eventId: string;
  lastError: string;
  availableAt: string;
  deadLetter?: boolean;
}

export interface OutboxEventStore {
  getEvent(
    eventId: string
  ): Promise<OutboxEventRecord | undefined> | OutboxEventRecord | undefined;
  claimNext(
    input?: ClaimNextOutboxEventInput
  ): Promise<OutboxEventRecord | undefined> | OutboxEventRecord | undefined;
  markDelivered(
    input: MarkOutboxEventDeliveredInput
  ): Promise<OutboxEventRecord | undefined> | OutboxEventRecord | undefined;
  markFailed(
    input: MarkOutboxEventFailedInput
  ): Promise<OutboxEventRecord | undefined> | OutboxEventRecord | undefined;
}

export interface MarkReceiptChainVerifiedInput {
  receiptId: string;
  verifiedAt: string;
}

export interface ReceiptChainVerificationStore {
  getReceiptForChainVerification(
    receiptId: string
  ): Promise<ReceiptIngestionSnapshot | undefined> | ReceiptIngestionSnapshot | undefined;
  markReceiptChainVerified(
    input: MarkReceiptChainVerifiedInput
  ): Promise<ReceiptIngestionSnapshot | undefined> | ReceiptIngestionSnapshot | undefined;
}

export interface ReceiptIngestionSnapshot {
  receipt: ReceiptRecord;
  accrual?: CommissionAccrual;
  ledgerTransaction?: LedgerTransaction;
}

export interface ReceiptIngestInput {
  receipt: unknown;
  source?: ReceiptIngestSource;
}

export type ReceiptIngestResult =
  | ({
      status: "created";
      statusCode: 201;
    } & ReceiptIngestionSnapshot)
  | ({
      status: "duplicate";
      statusCode: 200;
    } & ReceiptIngestionSnapshot)
  | {
      status: "conflict";
      statusCode: 409;
      conflictField: "receiptId" | "paymentId" | "settlementTxSignature";
      existingReceiptId: string;
      receiptHash: `sha256:${string}`;
    }
  | {
      status: "rejected";
      statusCode: 400;
      errors: string[];
    };

export interface ReceiptIngestorOptions {
  resolveMerchantPublicKey: (
    receipt: Split402ReceiptV1
  ) => Promise<string | undefined> | string | undefined;
  now?: () => Date;
  idFactory?: (prefix: "acr" | "ldg" | "lde") => string;
}

export interface ReceiptIngestionStore {
  getByReceiptId(
    receiptId: string
  ): Promise<ReceiptIngestionSnapshot | undefined> | ReceiptIngestionSnapshot | undefined;
  getByReceiptHash(
    receiptHash: `sha256:${string}`
  ): Promise<ReceiptIngestionSnapshot | undefined> | ReceiptIngestionSnapshot | undefined;
  getByPaymentId(
    paymentId: string
  ): Promise<ReceiptIngestionSnapshot | undefined> | ReceiptIngestionSnapshot | undefined;
  getBySettlementTxSignature(
    signature: string
  ): Promise<ReceiptIngestionSnapshot | undefined> | ReceiptIngestionSnapshot | undefined;
  save(snapshot: ReceiptIngestionSnapshot): Promise<void> | void;
}

const RECEIPT_INGEST_SOURCES = ["buyer", "merchant", "relay", "unknown"] as const;

export class InMemoryReceiptIngestionStore
  implements
    ReceiptIngestionStore,
    PayoutAccrualStore,
    PayoutBatchStore,
    PayoutTransactionStore {
  private readonly receiptsById = new Map<string, ReceiptIngestionSnapshot>();
  private readonly receiptIdByHash = new Map<`sha256:${string}`, string>();
  private readonly receiptIdByPaymentId = new Map<string, string>();
  private readonly receiptIdBySettlementTx = new Map<string, string>();
  private readonly payoutBatchesById = new Map<string, PayoutBatchRecord>();
  private readonly payoutTransactionsById = new Map<
    string,
    PayoutTransactionRecord
  >();

  getByReceiptId(receiptId: string): ReceiptIngestionSnapshot | undefined {
    return this.receiptsById.get(receiptId);
  }

  getByReceiptHash(receiptHash: `sha256:${string}`): ReceiptIngestionSnapshot | undefined {
    const receiptId = this.receiptIdByHash.get(receiptHash);
    return receiptId === undefined ? undefined : this.receiptsById.get(receiptId);
  }

  getByPaymentId(paymentId: string): ReceiptIngestionSnapshot | undefined {
    const receiptId = this.receiptIdByPaymentId.get(paymentId);
    return receiptId === undefined ? undefined : this.receiptsById.get(receiptId);
  }

  getBySettlementTxSignature(signature: string): ReceiptIngestionSnapshot | undefined {
    const receiptId = this.receiptIdBySettlementTx.get(signature);
    return receiptId === undefined ? undefined : this.receiptsById.get(receiptId);
  }

  save(snapshot: ReceiptIngestionSnapshot): void {
    this.receiptsById.set(snapshot.receipt.id, snapshot);
    this.receiptIdByHash.set(snapshot.receipt.receiptHash, snapshot.receipt.id);
    this.receiptIdByPaymentId.set(
      snapshot.receipt.receipt.paymentId,
      snapshot.receipt.id
    );
    this.receiptIdBySettlementTx.set(
      snapshot.receipt.receipt.settlementTxSignature,
      snapshot.receipt.id
    );
  }

  listAccruals(): CommissionAccrual[] {
    return Array.from(this.receiptsById.values())
      .map((snapshot) => snapshot.accrual)
      .filter((accrual): accrual is CommissionAccrual => accrual !== undefined);
  }

  listPayoutEligibleAccruals(
    input: ListPayoutEligibleAccrualsInput
  ): CommissionAccrual[] {
    return filterPayoutEligibleAccruals(this.listAccruals(), input);
  }

  createPayoutBatch(
    input: Parameters<PayoutBatchStore["createPayoutBatch"]>[0]
  ): PayoutBatchRecord {
    const batch = createPayoutBatchPlan(input);
    const selectedAccrualIds = new Set(
      batch.items.flatMap((item) =>
        item.allocations.map((allocation) => allocation.accrualId)
      )
    );
    const snapshotsToAllocate: ReceiptIngestionSnapshot[] = [];
    for (const snapshot of this.receiptsById.values()) {
      if (
        snapshot.accrual !== undefined &&
        selectedAccrualIds.has(snapshot.accrual.id)
      ) {
        if (snapshot.accrual.status !== "available") {
          throw new PayoutBatchConflictError(
            `accrual is not available for payout: ${snapshot.accrual.id}`
          );
        }
        snapshotsToAllocate.push(snapshot);
      }
    }
    if (snapshotsToAllocate.length !== selectedAccrualIds.size) {
      throw new PayoutBatchConflictError("one or more selected accruals were not found");
    }

    for (const snapshot of snapshotsToAllocate) {
      if (snapshot.accrual === undefined) {
        continue;
      }
      this.save({
        ...snapshot,
        accrual: {
          ...snapshot.accrual,
          status: "allocated"
        }
      });
    }
    this.payoutBatchesById.set(batch.id, batch);
    return batch;
  }

  createPayoutBatchFromAvailableAccruals(
    input: CreatePayoutBatchFromAvailableAccrualsInput
  ): PayoutBatchRecord {
    const accruals = this.listPayoutEligibleAccruals({
      merchantId: input.merchantId,
      asset: input.asset,
      ...(input.now === undefined ? {} : { now: input.now }),
      ...(input.campaignId === undefined ? {} : { campaignId: input.campaignId }),
      ...(input.routeId === undefined ? {} : { routeId: input.routeId }),
      ...(input.limit === undefined ? {} : { limit: input.limit })
    });
    return this.createPayoutBatch({
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
  }

  getPayoutBatch(batchId: string): PayoutBatchRecord | undefined {
    return this.payoutBatchesById.get(batchId);
  }

  saveSignedPayoutTransactions(
    input: SaveSignedPayoutTransactionsInput
  ): PayoutTransactionRecord[] {
    if (!this.payoutBatchesById.has(input.payoutBatchId)) {
      throw new PayoutBatchConflictError(
        `unknown payout batch: ${input.payoutBatchId}`
      );
    }
    const records = createSignedPayoutTransactionRecords(input);
    for (const record of records) {
      if (this.payoutTransactionsById.has(record.id)) {
        throw new PayoutBatchConflictError(
          `payout transaction already exists: ${record.id}`
        );
      }
      const existingForAttempt = this.listPayoutTransactions(record.payoutBatchId)
        .find((existing) =>
          existing.sequence === record.sequence &&
          existing.attempt === record.attempt
        );
      if (existingForAttempt !== undefined) {
        throw new PayoutBatchConflictError(
          `payout transaction already exists for sequence ${record.sequence} attempt ${record.attempt}`
        );
      }
      if (
        record.expectedSignature !== undefined &&
        Array.from(this.payoutTransactionsById.values()).some(
          (existing) => existing.expectedSignature === record.expectedSignature
        )
      ) {
        throw new PayoutBatchConflictError(
          `payout transaction expected signature already exists: ${record.expectedSignature}`
        );
      }
    }
    for (const record of records) {
      this.payoutTransactionsById.set(record.id, record);
    }
    return records;
  }

  listPayoutTransactions(payoutBatchId: string): PayoutTransactionRecord[] {
    return Array.from(this.payoutTransactionsById.values())
      .filter((transaction) => transaction.payoutBatchId === payoutBatchId)
      .sort(comparePayoutTransactions);
  }

  markPayoutTransactionSubmitted(
    input: MarkPayoutTransactionSubmittedInput
  ): PayoutTransactionRecord | undefined {
    const existing = this.payoutTransactionsById.get(input.id);
    if (existing === undefined) {
      return undefined;
    }
    if (input.expectedSignature !== undefined) {
      if (
        existing.expectedSignature !== undefined &&
        existing.expectedSignature !== input.expectedSignature
      ) {
        throw new PayoutBatchConflictError(
          "submitted payout transaction signature does not match expected signature"
        );
      }
    }
    const submitted: PayoutTransactionRecord = {
      ...existing,
      status: "submitted",
      ...(input.expectedSignature === undefined
        ? {}
        : { expectedSignature: input.expectedSignature }),
      submittedAt: (input.submittedAt === undefined
        ? new Date()
        : new Date(input.submittedAt)
      ).toISOString()
    };
    this.payoutTransactionsById.set(submitted.id, submitted);
    return submitted;
  }
}

export class ReceiptIngestor {
  private sequence = 0;

  constructor(
    private readonly store: ReceiptIngestionStore,
    private readonly options: ReceiptIngestorOptions
  ) {}

  async ingest(input: ReceiptIngestInput): Promise<ReceiptIngestResult> {
    const parsed = Split402ReceiptV1Schema.safeParse(input.receipt);
    if (!parsed.success) {
      return {
        status: "rejected",
        statusCode: 400,
        errors: parsed.error.issues.map((issue) => issue.message)
      };
    }

    const receipt = parsed.data;
    const receiptHash = hashProtocolObject(receipt);
    const duplicate = await this.store.getByReceiptHash(receiptHash);
    if (duplicate !== undefined) {
      return { status: "duplicate", statusCode: 200, ...duplicate };
    }

    const conflict = await this.findConflict(receipt, receiptHash);
    if (conflict !== undefined) {
      return conflict;
    }

    const merchantPublicKey = await this.options.resolveMerchantPublicKey(receipt);
    if (merchantPublicKey === undefined) {
      return {
        status: "rejected",
        statusCode: 400,
        errors: [`unknown merchant public key for ${receipt.merchantId}`]
      };
    }

    const verification = verifySplit402ReceiptObject(receipt, merchantPublicKey);
    if (!verification.ok) {
      return {
        status: "rejected",
        statusCode: 400,
        errors: verification.errors
      };
    }

    const snapshot = this.createSnapshot(
      receipt,
      receiptHash,
      input.source ?? "unknown"
    );
    try {
      await this.store.save(snapshot);
    } catch (error) {
      if (!isReceiptIngestionPersistenceConflict(error)) {
        throw error;
      }

      const duplicateAfterConflict = await this.store.getByReceiptHash(receiptHash);
      if (duplicateAfterConflict !== undefined) {
        return { status: "duplicate", statusCode: 200, ...duplicateAfterConflict };
      }

      const writeConflict = await this.findConflict(receipt, receiptHash);
      if (writeConflict !== undefined) {
        return writeConflict;
      }

      throw error;
    }
    return { status: "created", statusCode: 201, ...snapshot };
  }

  private async findConflict(
    receipt: Split402ReceiptV1,
    receiptHash: `sha256:${string}`
  ): Promise<Extract<ReceiptIngestResult, { status: "conflict" }> | undefined> {
    const byReceiptId = await this.store.getByReceiptId(receipt.receiptId);
    if (byReceiptId !== undefined) {
      return conflict("receiptId", byReceiptId, receiptHash);
    }

    const byPaymentId = await this.store.getByPaymentId(receipt.paymentId);
    if (byPaymentId !== undefined) {
      return conflict("paymentId", byPaymentId, receiptHash);
    }

    const bySettlementTx = await this.store.getBySettlementTxSignature(
      receipt.settlementTxSignature
    );
    if (bySettlementTx !== undefined) {
      return conflict("settlementTxSignature", bySettlementTx, receiptHash);
    }

    return undefined;
  }

  private createSnapshot(
    receipt: Split402ReceiptV1,
    receiptHash: `sha256:${string}`,
    source: ReceiptIngestSource
  ): ReceiptIngestionSnapshot {
    const createdAt = (this.options.now?.() ?? new Date()).toISOString();
    const receiptRecord: ReceiptRecord = {
      id: receipt.receiptId,
      receiptHash,
      receipt,
      source,
      verificationState: "pending_chain_verification",
      ingestionState: "accepted",
      createdAt
    };
    const accrual = this.createAccrual(receipt, createdAt);
    const ledgerTransaction =
      accrual === undefined
        ? undefined
        : this.createLedgerTransaction(receipt, accrual, createdAt);

    return {
      receipt: receiptRecord,
      ...(accrual === undefined ? {} : { accrual }),
      ...(ledgerTransaction === undefined ? {} : { ledgerTransaction })
    };
  }

  private createAccrual(
    receipt: Split402ReceiptV1,
    createdAt: string
  ): CommissionAccrual | undefined {
    if (
      receipt.routeId === undefined ||
      receipt.referrerWallet === undefined ||
      receipt.payoutWallet === undefined ||
      BigInt(receipt.referrerCreditAtomic) <= 0n
    ) {
      return undefined;
    }

    return {
      id: this.nextId("acr"),
      receiptId: receipt.receiptId,
      merchantId: receipt.merchantId,
      campaignId: receipt.campaignId,
      routeId: receipt.routeId,
      referrerWallet: receipt.referrerWallet,
      payoutWallet: receipt.payoutWallet,
      asset: receipt.asset,
      amountAtomic: receipt.referrerCreditAtomic,
      status: "pending_chain_verification",
      createdAt
    };
  }

  private createLedgerTransaction(
    receipt: Split402ReceiptV1,
    accrual: CommissionAccrual,
    createdAt: string
  ): LedgerTransaction {
    const transactionId = this.nextId("ldg");
    const entries: LedgerEntry[] = [
      {
        id: this.nextId("lde"),
        transactionId,
        accountType: "merchant_commission_liability",
        accountReference: receipt.merchantId,
        asset: receipt.asset,
        amountAtomic: negateAtomic(receipt.commissionAmountAtomic)
      },
      {
        id: this.nextId("lde"),
        transactionId,
        accountType: "referrer_payable",
        accountReference: accrual.payoutWallet,
        asset: receipt.asset,
        amountAtomic: receipt.referrerCreditAtomic
      },
      {
        id: this.nextId("lde"),
        transactionId,
        accountType: "protocol_fee_payable",
        accountReference: "split402",
        asset: receipt.asset,
        amountAtomic: receipt.protocolFeeAtomic
      }
    ];
    assertLedgerBalances(entries);
    return {
      id: transactionId,
      sourceType: "commission_accrual",
      sourceId: accrual.id,
      asset: receipt.asset,
      entries,
      createdAt
    };
  }

  private nextId(prefix: "acr" | "ldg" | "lde"): string {
    if (this.options.idFactory !== undefined) {
      return this.options.idFactory(prefix);
    }
    this.sequence += 1;
    return `${prefix}_${this.sequence.toString().padStart(32, "0")}`;
  }
}

export interface ControlPlaneAppOptions {
  ingestor: ReceiptIngestor;
  merchantRegistry?: MerchantRegistry;
  campaignRegistry?: CampaignRegistry;
  routeRegistry?: RouteRegistry;
  payoutAccrualStore?: PayoutAccrualStore;
  payoutBatchStore?: PayoutBatchStore;
  auth?: ControlPlaneAuthOptions;
  jsonLimit?: string;
}

export interface ControlPlaneAuthOptions {
  authenticator: WalletAuthenticator;
  requireMerchantAuth?: boolean;
}

export type ControlPlaneRuntimeAuthPolicy = "disabled" | "optional" | "required";

export interface CreateControlPlaneRuntimeOptions {
  db: PostgresPool;
  authPolicy?: ControlPlaneRuntimeAuthPolicy;
  close?: () => Promise<void> | void;
  jsonLimit?: string;
  walletAuth?: WalletAuthenticatorOptions;
}

export interface CreateControlPlaneRuntimeFromEnvOptions {
  env?: NodeJS.ProcessEnv;
  poolFactory?: (config: PoolConfig) => PostgresPool;
  walletAuth?: WalletAuthenticatorOptions;
}

export interface ControlPlaneRuntime {
  app: express.Express;
  authPolicy: ControlPlaneRuntimeAuthPolicy;
  campaignRegistry: PostgresCampaignRegistry;
  close(): Promise<void>;
  db: PostgresPool;
  ingestor: ReceiptIngestor;
  merchantRegistry: PostgresMerchantRegistry;
  outboxStore: PostgresOutboxEventStore;
  receiptStore: PostgresReceiptIngestionStore;
  routeRegistry: PostgresRouteRegistry;
  authenticator?: WalletAuthenticator;
}

export function createControlPlaneRuntime(
  options: CreateControlPlaneRuntimeOptions
): ControlPlaneRuntime {
  const authPolicy = readRuntimeAuthPolicy(options.authPolicy ?? "required");
  const merchantRegistry = new PostgresMerchantRegistry(options.db);
  const campaignRegistry = new PostgresCampaignRegistry(options.db);
  const routeRegistry = new PostgresRouteRegistry(options.db);
  const receiptStore = new PostgresReceiptIngestionStore(options.db);
  const outboxStore = new PostgresOutboxEventStore(options.db);
  const ingestor = new ReceiptIngestor(receiptStore, {
    resolveMerchantPublicKey: createMerchantReceiptKeyResolver(merchantRegistry)
  });
  const authenticator =
    authPolicy === "disabled"
      ? undefined
      : new WalletAuthenticator(
          new PostgresWalletAuthStore(options.db),
          options.walletAuth
        );
  const app = createControlPlaneApp({
    ingestor,
    merchantRegistry,
    campaignRegistry,
    routeRegistry,
    payoutAccrualStore: receiptStore,
    payoutBatchStore: receiptStore,
    ...(options.jsonLimit === undefined ? {} : { jsonLimit: options.jsonLimit }),
    ...(authenticator === undefined
      ? {}
      : {
          auth: {
            authenticator,
            requireMerchantAuth: authPolicy === "required"
          }
        })
  });

  return {
    app,
    authPolicy,
    db: options.db,
    ingestor,
    merchantRegistry,
    campaignRegistry,
    routeRegistry,
    receiptStore,
    outboxStore,
    ...(authenticator === undefined ? {} : { authenticator }),
    close: async () => {
      await options.close?.();
    }
  };
}

export function createControlPlaneRuntimeFromEnv(
  options: CreateControlPlaneRuntimeFromEnvOptions = {}
): ControlPlaneRuntime {
  const env = options.env ?? process.env;
  const pool = createRuntimePool(env, options.poolFactory);
  return createControlPlaneRuntime({
    db: pool,
    authPolicy: readRuntimeAuthPolicy(
      env.SPLIT402_CONTROL_PLANE_AUTH_POLICY ?? "required"
    ),
    ...(env.SPLIT402_CONTROL_PLANE_JSON_LIMIT === undefined
      ? {}
      : { jsonLimit: env.SPLIT402_CONTROL_PLANE_JSON_LIMIT }),
    walletAuth: {
      ...readWalletAuthEnvOptions(env),
      ...options.walletAuth
    },
    close: async () => {
      await closeRuntimePool(pool);
    }
  });
}

export function createControlPlaneApp(
  options: ControlPlaneAppOptions
): express.Express {
  const app = express();
  app.disable("x-powered-by");

  app.get("/v1/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "split402-control-plane",
      phase: "phase-4"
    });
  });

  if (options.auth !== undefined) {
    app.use(createWalletAuthRouter(options.auth.authenticator, options));
  }
  app.use(createReceiptIngestionRouter(options));
  if (options.merchantRegistry !== undefined) {
    app.use(createMerchantRegistryRouter(options.merchantRegistry, options));
  }
  if (options.campaignRegistry !== undefined) {
    app.use(createCampaignRegistryRouter(options.campaignRegistry, options));
  }
  if (options.routeRegistry !== undefined) {
    app.use(createRouteRegistryRouter(options.routeRegistry, options));
  }
  if (options.payoutAccrualStore !== undefined) {
    app.use(createPayoutRouter(options.payoutAccrualStore, options));
  }

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  app.use(
    (
      error: unknown,
      _req: Request,
      res: Response,
      _next: NextFunction
    ) => {
      res.status(500).json({
        error: "internal_server_error",
        message: error instanceof Error ? error.message : "unknown error"
      });
    }
  );

  return app;
}

export function createWalletAuthRouter(
  authenticator: WalletAuthenticator,
  options: Pick<ControlPlaneAppOptions, "jsonLimit"> = {}
): Router {
  const router = express.Router();
  router.use(express.json({ limit: options.jsonLimit ?? "128kb" }));

  router.post("/v1/auth/challenges", async (req, res, next) => {
    try {
      const body = requireJsonObject(req.body);
      const purpose = readOptionalWalletAuthPurpose(body.purpose);
      const challenge = await authenticator.createChallenge({
        wallet: readRequiredString(body.wallet, "wallet"),
        network: readRequiredString(body.network, "network"),
        ...(purpose === undefined ? {} : { purpose })
      });
      res.status(201).json({ challenge });
    } catch (error) {
      if (!sendWalletAuthError(res, error) && !sendMerchantRegistryError(res, error)) {
        next(error);
      }
    }
  });

  router.post("/v1/auth/sessions", async (req, res, next) => {
    try {
      const body = requireJsonObject(req.body);
      const publicKey = readOptionalString(body.publicKey, "publicKey");
      const session = await authenticator.createSession({
        challengeId: readRequiredString(body.challengeId, "challengeId"),
        signature: readRequiredString(body.signature, "signature"),
        ...(publicKey === undefined ? {} : { publicKey })
      });
      res.status(201).json({ session });
    } catch (error) {
      if (!sendWalletAuthError(res, error) && !sendMerchantRegistryError(res, error)) {
        next(error);
      }
    }
  });

  router.post("/v1/auth/sessions/refresh", async (req, res, next) => {
    try {
      const body = requireJsonObject(req.body);
      const session = await authenticator.refreshSession({
        refreshToken: readRequiredString(body.refreshToken, "refreshToken")
      });
      res.status(201).json({ session });
    } catch (error) {
      if (!sendWalletAuthError(res, error) && !sendMerchantRegistryError(res, error)) {
        next(error);
      }
    }
  });

  router.use(jsonErrorHandler);

  return router;
}

export function createReceiptIngestionRouter(
  options: ControlPlaneAppOptions
): Router {
  const router = express.Router();
  router.use(express.json({ limit: options.jsonLimit ?? "128kb" }));

  router.post("/v1/receipts", async (req, res, next) => {
    try {
      const requestBody = readJsonObject(req.body);
      if (requestBody === undefined || requestBody.receipt === undefined) {
        res.status(400).json({
          status: "rejected",
          errors: ["request body must include receipt"]
        });
        return;
      }

      const source = readReceiptSource(requestBody.source);
      if (source === undefined && requestBody.source !== undefined) {
        res.status(400).json({
          status: "rejected",
          errors: [
            "source must be one of buyer, merchant, relay, or unknown"
          ]
        });
        return;
      }

      const result = await options.ingestor.ingest({
        receipt: requestBody.receipt,
        ...(source === undefined ? {} : { source })
      });
      res.status(result.statusCode).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.use(jsonErrorHandler);

  return router;
}

export function createPayoutRouter(
  payoutAccrualStore: PayoutAccrualStore,
  options: Pick<
    ControlPlaneAppOptions,
    "auth" | "jsonLimit" | "merchantRegistry" | "payoutBatchStore"
  > = {}
): Router {
  const router = express.Router();
  router.use(express.json({ limit: options.jsonLimit ?? "128kb" }));

  router.post("/v1/merchants/:merchantId/payouts/preview", async (req, res, next) => {
    try {
      const merchantId = readRouteParam(req.params.merchantId, "merchantId");
      const session = await requireMerchantOwnerForMerchantId(
        req,
        res,
        options,
        merchantId
      );
      if (session === undefined && isMerchantAuthRequired(options)) {
        return;
      }

      const body = readJsonObject(req.body) ?? {};
      const asset = readOptionalString(body.asset, "asset");
      const campaignId = readOptionalString(body.campaignId, "campaignId");
      const routeId = readOptionalString(body.routeId, "routeId");
      const now = readOptionalString(body.now, "now") ?? new Date().toISOString();
      const maxAccruals = readOptionalPositiveInteger(
        body.maxAccruals,
        "maxAccruals"
      );
      const maxRecipients = readOptionalPositiveInteger(
        body.maxRecipients,
        "maxRecipients"
      );
      const minimumPayoutAmountAtomic = readOptionalString(
        body.minimumPayoutAmountAtomic,
        "minimumPayoutAmountAtomic"
      );
      const fundingBalances = readPayoutFundingBalances(body.fundingBalances);
      const accruals = await payoutAccrualStore.listPayoutEligibleAccruals({
        merchantId,
        now,
        ...(asset === undefined ? {} : { asset }),
        ...(campaignId === undefined ? {} : { campaignId }),
        ...(routeId === undefined ? {} : { routeId }),
        ...(maxAccruals === undefined ? {} : { limit: maxAccruals })
      });
      const preview = createPayoutPreview({
        merchantId,
        accruals,
        now,
        ...(minimumPayoutAmountAtomic === undefined
          ? {}
          : { minimumPayoutAmountAtomic }),
        ...(maxRecipients === undefined ? {} : { maxRecipients }),
        ...(fundingBalances === undefined ? {} : { fundingBalances })
      });
      res.json({ preview });
    } catch (error) {
      if (
        !sendPayoutPreviewError(res, error) &&
        !sendMerchantRegistryError(res, error)
      ) {
        next(error);
      }
    }
  });

  router.post("/v1/merchants/:merchantId/payout-batches", async (req, res, next) => {
    try {
      const merchantId = readRouteParam(req.params.merchantId, "merchantId");
      const session = await requireMerchantOwnerForMerchantId(
        req,
        res,
        options,
        merchantId
      );
      if (session === undefined && isMerchantAuthRequired(options)) {
        return;
      }
      if (options.merchantRegistry === undefined) {
        res.status(500).json({
          error: "internal_server_error",
          message: "merchant registry is required for payout batch creation"
        });
        return;
      }
      if (options.payoutBatchStore === undefined) {
        res.status(500).json({
          error: "internal_server_error",
          message: "payout batch store is required for payout batch creation"
        });
        return;
      }

      const body = readJsonObject(req.body) ?? {};
      const payoutWalletId = readRequiredString(
        body.payoutWalletId,
        "payoutWalletId"
      );
      const profile = await options.merchantRegistry.getMerchantProfile(merchantId);
      if (profile === undefined) {
        res.status(404).json({ error: "merchant_not_found" });
        return;
      }
      const payoutWallet = profile.payoutWallets.find(
        (wallet) => wallet.id === payoutWalletId
      );
      if (payoutWallet === undefined) {
        res.status(404).json({ error: "merchant_payout_wallet_not_found" });
        return;
      }
      if (payoutWallet.status !== "active") {
        res.status(409).json({
          error: "payout_wallet_not_active",
          message: `merchant payout wallet is ${payoutWallet.status}`
        });
        return;
      }

      const campaignId = readOptionalString(body.campaignId, "campaignId");
      const routeId = readOptionalString(body.routeId, "routeId");
      const now = readOptionalString(body.now, "now") ?? new Date().toISOString();
      const maxAccruals = readOptionalPositiveInteger(
        body.maxAccruals,
        "maxAccruals"
      );
      const maxRecipients = readOptionalPositiveInteger(
        body.maxRecipients,
        "maxRecipients"
      );
      const minimumPayoutAmountAtomic = readOptionalString(
        body.minimumPayoutAmountAtomic,
        "minimumPayoutAmountAtomic"
      );
      const batch =
        await options.payoutBatchStore.createPayoutBatchFromAvailableAccruals({
          merchantId,
          payoutWalletId,
          network: payoutWallet.network,
          asset: payoutWallet.asset,
          now,
          ...(campaignId === undefined ? {} : { campaignId }),
          ...(routeId === undefined ? {} : { routeId }),
          ...(maxAccruals === undefined ? {} : { limit: maxAccruals }),
          ...(minimumPayoutAmountAtomic === undefined
            ? {}
            : { minimumPayoutAmountAtomic }),
          ...(maxRecipients === undefined ? {} : { maxRecipients })
        });
      res.status(201).json({ batch });
    } catch (error) {
      if (
        !sendPayoutBatchError(res, error) &&
        !sendPayoutPreviewError(res, error) &&
        !sendMerchantRegistryError(res, error)
      ) {
        next(error);
      }
    }
  });

  router.use(jsonErrorHandler);

  return router;
}

export function createMerchantRegistryRouter(
  merchantRegistry: MerchantRegistry,
  options: Pick<ControlPlaneAppOptions, "auth" | "jsonLimit"> = {}
): Router {
  const router = express.Router();
  router.use(express.json({ limit: options.jsonLimit ?? "128kb" }));

  router.post("/v1/merchants", async (req, res, next) => {
    try {
      const session = await readMerchantMutationSession(req, res, options);
      if (session === undefined && isMerchantAuthRequired(options)) {
        return;
      }
      const body = requireJsonObject(req.body);
      const id = readOptionalString(body.id, "id");
      const status = readOptionalMerchantStatus(body.status);
      const ownerWallet =
        readOptionalString(body.ownerWallet, "ownerWallet") ?? session?.wallet;
      if (ownerWallet === undefined) {
        throw new MerchantRegistryValidationError("ownerWallet is required");
      }
      if (session !== undefined && ownerWallet !== session.wallet) {
        res.status(403).json({
          error: "forbidden",
          message: "ownerWallet must match authenticated wallet"
        });
        return;
      }
      const merchant = await merchantRegistry.createMerchant({
        slug: readRequiredString(body.slug, "slug"),
        displayName: readRequiredString(body.displayName, "displayName"),
        ownerWallet,
        ...(id === undefined ? {} : { id }),
        ...(status === undefined ? {} : { status })
      });
      res.status(201).json({ merchant });
    } catch (error) {
      if (!sendMerchantRegistryError(res, error)) {
        next(error);
      }
    }
  });

  router.get("/v1/merchants/:merchantId", async (req, res, next) => {
    try {
      const merchant = await merchantRegistry.getMerchantProfile(
        req.params.merchantId
      );
      if (merchant === undefined) {
        res.status(404).json({ error: "merchant_not_found" });
        return;
      }
      res.json({ merchant });
    } catch (error) {
      next(error);
    }
  });

  router.post("/v1/merchants/:merchantId/origins", async (req, res, next) => {
    try {
      const session = await requireMerchantOwnerSession(
        req,
        res,
        options,
        merchantRegistry
      );
      if (session === undefined && isMerchantAuthRequired(options)) {
        return;
      }
      const body = requireJsonObject(req.body);
      const verificationMethod = readOptionalOriginVerificationMethod(
        body.verificationMethod
      );
      const status = readOptionalMerchantOriginStatus(body.status);
      const verifiedAt = readOptionalString(body.verifiedAt, "verifiedAt");
      const origin = await merchantRegistry.addOrigin({
        merchantId: req.params.merchantId,
        origin: readRequiredString(body.origin, "origin"),
        ...(verificationMethod === undefined ? {} : { verificationMethod }),
        ...(status === undefined ? {} : { status }),
        ...(verifiedAt === undefined ? {} : { verifiedAt })
      });
      res.status(201).json({ origin });
    } catch (error) {
      if (!sendMerchantRegistryError(res, error)) {
        next(error);
      }
    }
  });

  router.post("/v1/merchants/:merchantId/keys", async (req, res, next) => {
    try {
      const session = await requireMerchantOwnerSession(
        req,
        res,
        options,
        merchantRegistry
      );
      if (session === undefined && isMerchantAuthRequired(options)) {
        return;
      }
      const body = requireJsonObject(req.body);
      const algorithm = readOptionalMerchantKeyAlgorithm(body.algorithm);
      const purpose = readOptionalMerchantKeyPurpose(body.purpose);
      const validFrom = readOptionalString(body.validFrom, "validFrom");
      const validUntil = readOptionalString(body.validUntil, "validUntil");
      const key = await merchantRegistry.addKey({
        merchantId: req.params.merchantId,
        kid: readRequiredString(body.kid, "kid"),
        publicKey: readRequiredString(body.publicKey, "publicKey"),
        ...(algorithm === undefined ? {} : { algorithm }),
        ...(purpose === undefined ? {} : { purpose }),
        ...(validFrom === undefined ? {} : { validFrom }),
        ...(validUntil === undefined ? {} : { validUntil })
      });
      res.status(201).json({ key });
    } catch (error) {
      if (!sendMerchantRegistryError(res, error)) {
        next(error);
      }
    }
  });

  router.post("/v1/merchants/:merchantId/keys/:kid/revoke", async (req, res, next) => {
    try {
      const session = await requireMerchantOwnerSession(
        req,
        res,
        options,
        merchantRegistry
      );
      if (session === undefined && isMerchantAuthRequired(options)) {
        return;
      }
      const body = readJsonObject(req.body) ?? {};
      const revokedAt = readOptionalString(body.revokedAt, "revokedAt");
      const reason = readOptionalString(body.reason, "reason");
      const key = await merchantRegistry.revokeKey({
        merchantId: req.params.merchantId,
        kid: req.params.kid,
        ...(revokedAt === undefined ? {} : { revokedAt }),
        ...(reason === undefined ? {} : { reason })
      });
      if (key === undefined) {
        res.status(404).json({ error: "merchant_key_not_found" });
        return;
      }
      res.json({ key });
    } catch (error) {
      if (!sendMerchantRegistryError(res, error)) {
        next(error);
      }
    }
  });

  router.post("/v1/merchants/:merchantId/payout-wallets", async (req, res, next) => {
    try {
      const session = await requireMerchantOwnerSession(
        req,
        res,
        options,
        merchantRegistry
      );
      if (session === undefined && isMerchantAuthRequired(options)) {
        return;
      }
      const body = requireJsonObject(req.body);
      const id = readOptionalString(body.id, "id");
      const status = readOptionalMerchantPayoutWalletStatus(body.status);
      const payoutWallet = await merchantRegistry.addPayoutWallet({
        merchantId: readRouteParam(req.params.merchantId, "merchantId"),
        network: readRequiredString(body.network, "network"),
        wallet: readRequiredString(body.wallet, "wallet"),
        asset: readRequiredString(body.asset, "asset"),
        signerReference: readRequiredString(
          body.signerReference,
          "signerReference"
        ),
        ...(id === undefined ? {} : { id }),
        ...(status === undefined ? {} : { status })
      });
      res.status(201).json({ payoutWallet });
    } catch (error) {
      if (!sendMerchantRegistryError(res, error)) {
        next(error);
      }
    }
  });

  router.use(jsonErrorHandler);

  return router;
}

export function createCampaignRegistryRouter(
  campaignRegistry: CampaignRegistry,
  options: Pick<
    ControlPlaneAppOptions,
    "auth" | "jsonLimit" | "merchantRegistry"
  > = {}
): Router {
  const router = express.Router();
  router.use(express.json({ limit: options.jsonLimit ?? "128kb" }));

  router.post("/v1/campaigns", async (req, res, next) => {
    try {
      const body = requireJsonObject(req.body);
      const merchantId = readRequiredString(body.merchantId, "merchantId");
      const session = await requireMerchantOwnerForMerchantId(
        req,
        res,
        options,
        merchantId
      );
      if (session === undefined && isMerchantAuthRequired(options)) {
        return;
      }
      const id = readOptionalString(body.id, "id");
      const campaign = await campaignRegistry.createCampaign({
        ...(id === undefined ? {} : { id }),
        merchantId,
        ...readCampaignTermsInput(body)
      });
      res.status(201).json({ campaign });
    } catch (error) {
      if (!sendCampaignRegistryError(res, error) && !sendMerchantRegistryError(res, error)) {
        next(error);
      }
    }
  });

  router.get("/v1/campaigns/:campaignId", async (req, res, next) => {
    try {
      const campaignId = readRouteParam(req.params.campaignId, "campaignId");
      const campaign = await campaignRegistry.getCampaign(campaignId);
      if (campaign === undefined) {
        res.status(404).json({ error: "campaign_not_found" });
        return;
      }
      res.json({ campaign });
    } catch (error) {
      next(error);
    }
  });

  router.post("/v1/campaigns/:campaignId/activate", async (req, res, next) => {
    try {
      const campaignId = readRouteParam(req.params.campaignId, "campaignId");
      const campaign = await campaignRegistry.getCampaign(campaignId);
      if (campaign === undefined) {
        res.status(404).json({ error: "campaign_not_found" });
        return;
      }
      const session = await requireMerchantOwnerForMerchantId(
        req,
        res,
        options,
        campaign.merchantId
      );
      if (session === undefined && isMerchantAuthRequired(options)) {
        return;
      }
      if (options.merchantRegistry === undefined) {
        res.status(500).json({
          error: "internal_server_error",
          message: "merchant registry is required for campaign activation"
        });
        return;
      }

      const body = requireJsonObject(req.body);
      const versionNumber = readOptionalPositiveInteger(body.version, "version");
      const version = await campaignRegistry.getCampaignVersion(
        campaignId,
        versionNumber ?? campaign.currentVersion
      );
      if (version === undefined) {
        res.status(404).json({ error: "campaign_version_not_found" });
        return;
      }

      const merchant = await options.merchantRegistry.getMerchantProfile(
        campaign.merchantId
      );
      if (merchant === undefined) {
        res.status(404).json({ error: "merchant_not_found" });
        return;
      }
      if (merchant.status !== "active") {
        throw new CampaignRegistryValidationError("merchant must be active");
      }
      if (
        !merchant.origins.some(
          (origin) =>
            origin.origin === version.terms.resourceOrigin &&
            origin.status === "verified"
        )
      ) {
        throw new CampaignRegistryValidationError(
          "campaign resourceOrigin must match a verified merchant origin"
        );
      }

      const kid = readRequiredString(body.kid, "kid");
      const key = await options.merchantRegistry.resolveKey({
        merchantId: campaign.merchantId,
        kid,
        purpose: "offer_receipt"
      });
      if (key === undefined) {
        throw new CampaignRegistryValidationError(
          "merchant service key not found or inactive"
        );
      }
      if (key.algorithm !== "Ed25519") {
        throw new CampaignRegistryValidationError(
          "campaign activation requires an Ed25519 merchant key"
        );
      }

      const activated = await campaignRegistry.activateCampaignVersion({
        campaignId,
        ...(versionNumber === undefined ? {} : { version: versionNumber }),
        merchantKid: kid,
        merchantPublicKey: key.publicKey,
        merchantSignature: readRequiredString(body.signature, "signature")
      });
      res.json({ campaign: activated });
    } catch (error) {
      if (!sendCampaignRegistryError(res, error) && !sendMerchantRegistryError(res, error)) {
        next(error);
      }
    }
  });

  router.get(
    "/v1/campaigns/:campaignId/versions/:version",
    async (req, res, next) => {
      try {
        const campaignId = readRouteParam(req.params.campaignId, "campaignId");
        const versionNumber = readPositiveIntegerParam(
          req.params.version,
          "version"
        );
        const version = await campaignRegistry.getCampaignVersion(
          campaignId,
          versionNumber
        );
        if (version === undefined) {
          res.status(404).json({ error: "campaign_version_not_found" });
          return;
        }
        res.json({ version });
      } catch (error) {
        if (!sendCampaignRegistryError(res, error) && !sendMerchantRegistryError(res, error)) {
          next(error);
        }
      }
    }
  );

  router.post("/v1/campaigns/:campaignId/versions", async (req, res, next) => {
    try {
      const campaignId = readRouteParam(req.params.campaignId, "campaignId");
      const campaign = await campaignRegistry.getCampaign(campaignId);
      if (campaign === undefined) {
        res.status(404).json({ error: "campaign_not_found" });
        return;
      }
      const session = await requireMerchantOwnerForMerchantId(
        req,
        res,
        options,
        campaign.merchantId
      );
      if (session === undefined && isMerchantAuthRequired(options)) {
        return;
      }
      const body = requireJsonObject(req.body);
      const version = await campaignRegistry.createCampaignVersion({
        campaignId,
        ...readCampaignTermsInput(body)
      });
      res.status(201).json({ version });
    } catch (error) {
      if (!sendCampaignRegistryError(res, error) && !sendMerchantRegistryError(res, error)) {
        next(error);
      }
    }
  });

  router.use(jsonErrorHandler);

  return router;
}

export function createRouteRegistryRouter(
  routeRegistry: RouteRegistry,
  options: Pick<
    ControlPlaneAppOptions,
    "auth" | "campaignRegistry" | "jsonLimit" | "merchantRegistry"
  > = {}
): Router {
  const router = express.Router();
  router.use(express.json({ limit: options.jsonLimit ?? "128kb" }));

  router.post("/v1/routes/drafts", async (req, res, next) => {
    try {
      const campaignRegistry = requireRouteCampaignRegistry(options);
      const body = requireJsonObject(req.body);
      const campaign = await loadActiveCampaignForRoute(
        campaignRegistry,
        readRequiredString(body.campaignId, "campaignId")
      );
      const resourceOrigin =
        readOptionalString(body.resourceOrigin, "resourceOrigin") ??
        campaign.current.terms.resourceOrigin;
      const operationIds =
        readOptionalRouteOperationScope(body.operationIds) ?? ["*"];
      assertRouteScopeMatchesCampaign(campaign, resourceOrigin, operationIds);

      const id = readOptionalString(body.id, "id");
      const issuedAt = readOptionalString(body.issuedAt, "issuedAt");
      const nonce = readOptionalString(body.nonce, "nonce");
      const metadataHash = readOptionalSha256Hash(body.metadataHash, "metadataHash");
      const campaignVersionMin =
        readOptionalPositiveInteger(
          body.campaignVersionMin,
          "campaignVersionMin"
        ) ?? campaign.currentVersion;
      if (campaignVersionMin > campaign.currentVersion) {
        throw new RouteRegistryValidationError(
          "route draft requires a newer campaign version"
        );
      }
      const draft = await routeRegistry.createRouteDraft({
        ...(id === undefined ? {} : { id }),
        campaignId: campaign.id,
        campaignVersionMin,
        referrerWallet: readRequiredString(body.referrerWallet, "referrerWallet"),
        payoutWallet: readRequiredString(body.payoutWallet, "payoutWallet"),
        resourceOrigin,
        operationIds,
        ...(issuedAt === undefined ? {} : { issuedAt }),
        expiresAt: readRequiredString(body.expiresAt, "expiresAt"),
        ...(nonce === undefined ? {} : { nonce }),
        ...(metadataHash === undefined ? {} : { metadataHash })
      });
      res.status(201).json({ draft });
    } catch (error) {
      if (
        !sendRouteRegistryError(res, error) &&
        !sendCampaignRegistryError(res, error) &&
        !sendMerchantRegistryError(res, error)
      ) {
        next(error);
      }
    }
  });

  router.post("/v1/routes", async (req, res, next) => {
    try {
      const campaignRegistry = requireRouteCampaignRegistry(options);
      const body = requireJsonObject(req.body);
      const claim = readReferralClaim(body.claim);
      const campaign = await loadActiveCampaignForRoute(
        campaignRegistry,
        claim.campaignId
      );
      assertRouteScopeMatchesCampaign(
        campaign,
        claim.resourceOrigin,
        claim.operationIds
      );
      if (claim.campaignVersionMin > campaign.currentVersion) {
        throw new RouteRegistryValidationError(
          "route claim requires a newer campaign version"
        );
      }

      const route = await routeRegistry.activateRoute({ claim });
      res.status(201).json({ route });
    } catch (error) {
      if (
        !sendRouteRegistryError(res, error) &&
        !sendCampaignRegistryError(res, error) &&
        !sendMerchantRegistryError(res, error)
      ) {
        next(error);
      }
    }
  });

  router.post("/v1/routes/:routeId/suspend", async (req, res, next) => {
    try {
      const routeId = readRouteParam(req.params.routeId, "routeId");
      const route = await routeRegistry.getRoute(routeId);
      if (route === undefined) {
        res.status(404).json({ error: "route_not_found" });
        return;
      }

      if (isMerchantAuthRequired(options)) {
        const campaignRegistry = requireRouteCampaignRegistry(options);
        const campaign = await campaignRegistry.getCampaign(route.campaignId);
        if (campaign === undefined) {
          res.status(404).json({ error: "campaign_not_found" });
          return;
        }
        const session = await requireMerchantOwnerForMerchantId(
          req,
          res,
          options,
          campaign.merchantId
        );
        if (session === undefined) {
          return;
        }
      }

      const suspended = await routeRegistry.suspendRoute({ routeId });
      if (suspended === undefined) {
        res.status(404).json({ error: "route_not_found" });
        return;
      }
      res.json({ route: suspended });
    } catch (error) {
      if (
        !sendRouteRegistryError(res, error) &&
        !sendCampaignRegistryError(res, error) &&
        !sendMerchantRegistryError(res, error)
      ) {
        next(error);
      }
    }
  });

  router.post("/v1/routes/:routeId/rotate-payout", async (req, res, next) => {
    try {
      const routeId = readRouteParam(req.params.routeId, "routeId");
      const campaignRegistry = requireRouteCampaignRegistry(options);
      const body = requireJsonObject(req.body);
      const claim = readReferralClaim(body.claim);
      const campaign = await loadActiveCampaignForRoute(
        campaignRegistry,
        claim.campaignId
      );
      assertRouteScopeMatchesCampaign(
        campaign,
        claim.resourceOrigin,
        claim.operationIds
      );
      if (claim.campaignVersionMin > campaign.currentVersion) {
        throw new RouteRegistryValidationError(
          "route claim requires a newer campaign version"
        );
      }

      const route = await routeRegistry.rotateRoutePayout({ routeId, claim });
      res.status(201).json({ route });
    } catch (error) {
      if (
        !sendRouteRegistryError(res, error) &&
        !sendCampaignRegistryError(res, error) &&
        !sendMerchantRegistryError(res, error)
      ) {
        next(error);
      }
    }
  });

  router.get("/v1/routes/search", async (req, res, next) => {
    try {
      const campaignId = readOptionalRouteQueryString(
        req.query.campaignId,
        "campaignId"
      );
      const referrerWallet = readOptionalRouteQueryString(
        req.query.referrerWallet,
        "referrerWallet"
      );
      const resourceOrigin = readOptionalRouteQueryString(
        req.query.resourceOrigin,
        "resourceOrigin"
      );
      const operationId = readOptionalRouteQueryString(
        req.query.operationId,
        "operationId"
      );
      const status = readOptionalRouteStatus(req.query.status);
      const limit = readOptionalRouteSearchLimit(req.query.limit);
      const routes = await routeRegistry.searchRoutes({
        ...(campaignId === undefined ? {} : { campaignId }),
        ...(referrerWallet === undefined ? {} : { referrerWallet }),
        ...(resourceOrigin === undefined ? {} : { resourceOrigin }),
        ...(operationId === undefined ? {} : { operationId }),
        ...(status === undefined ? {} : { status }),
        ...(limit === undefined ? {} : { limit })
      });
      res.json({ routes });
    } catch (error) {
      if (
        !sendRouteRegistryError(res, error) &&
        !sendMerchantRegistryError(res, error)
      ) {
        next(error);
      }
    }
  });

  router.get("/v1/routes/:routeId/versions", async (req, res, next) => {
    try {
      const routeId = readRouteParam(req.params.routeId, "routeId");
      const versions = await routeRegistry.listRouteVersions(routeId);
      if (versions.length === 0) {
        const route = await routeRegistry.getRoute(routeId);
        if (route === undefined) {
          res.status(404).json({ error: "route_not_found" });
          return;
        }
      }
      res.json({ versions });
    } catch (error) {
      if (!sendRouteRegistryError(res, error) && !sendMerchantRegistryError(res, error)) {
        next(error);
      }
    }
  });

  router.get("/v1/routes/:routeId", async (req, res, next) => {
    try {
      const routeId = readRouteParam(req.params.routeId, "routeId");
      const route = await routeRegistry.getRoute(routeId);
      if (route === undefined) {
        res.status(404).json({ error: "route_not_found" });
        return;
      }
      res.json({ route });
    } catch (error) {
      if (!sendRouteRegistryError(res, error) && !sendMerchantRegistryError(res, error)) {
        next(error);
      }
    }
  });

  router.use(jsonErrorHandler);

  return router;
}

export function isReceiptIngestSource(value: unknown): value is ReceiptIngestSource {
  return (
    typeof value === "string" &&
    (RECEIPT_INGEST_SOURCES as readonly string[]).includes(value)
  );
}

export function assertLedgerBalances(entries: LedgerEntry[]): void {
  const totals = new Map<string, bigint>();
  for (const entry of entries) {
    totals.set(entry.asset, (totals.get(entry.asset) ?? 0n) + BigInt(entry.amountAtomic));
  }
  const unbalanced = Array.from(totals.entries()).filter(([, total]) => total !== 0n);
  if (unbalanced.length > 0) {
    throw new Error(
      `ledger transaction is not balanced: ${unbalanced
        .map(([asset, total]) => `${asset}=${total}`)
        .join(", ")}`
    );
  }
}

function conflict(
  conflictField: "receiptId" | "paymentId" | "settlementTxSignature",
  existing: ReceiptIngestionSnapshot,
  receiptHash: `sha256:${string}`
): Extract<ReceiptIngestResult, { status: "conflict" }> {
  return {
    status: "conflict",
    statusCode: 409,
    conflictField,
    existingReceiptId: existing.receipt.id,
    receiptHash
  };
}

function negateAtomic(value: string): string {
  const amount = BigInt(value);
  return amount === 0n ? "0" : `-${amount.toString()}`;
}

function readJsonObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function requireJsonObject(value: unknown): Record<string, unknown> {
  const object = readJsonObject(value);
  if (object === undefined) {
    throw new MerchantRegistryValidationError("request body must be an object");
  }
  return object;
}

function readRequiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new MerchantRegistryValidationError(`${label} must be a non-empty string`);
  }
  return value;
}

function readOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return readRequiredString(value, label);
}

function readOptionalMerchantStatus(value: unknown): MerchantStatus | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    value === "pending" ||
    value === "active" ||
    value === "suspended" ||
    value === "closed"
  ) {
    return value;
  }
  throw new MerchantRegistryValidationError("status must be a valid merchant status");
}

function readOptionalOriginVerificationMethod(
  value: unknown
): MerchantOriginVerificationMethod | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "well_known" || value === "dns") {
    return value;
  }
  throw new MerchantRegistryValidationError(
    "verificationMethod must be well_known or dns"
  );
}

function readOptionalMerchantOriginStatus(
  value: unknown
): MerchantOriginStatus | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    value === "pending" ||
    value === "verified" ||
    value === "failed" ||
    value === "revoked"
  ) {
    return value;
  }
  throw new MerchantRegistryValidationError("status must be a valid origin status");
}

function readOptionalMerchantKeyAlgorithm(
  value: unknown
): MerchantKeyAlgorithm | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "Ed25519" || value === "ES256") {
    return value;
  }
  throw new MerchantRegistryValidationError("algorithm must be Ed25519 or ES256");
}

function readOptionalMerchantKeyPurpose(
  value: unknown
): MerchantKeyPurpose | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "offer_receipt" || value === "webhook") {
    return value;
  }
  throw new MerchantRegistryValidationError(
    "purpose must be offer_receipt or webhook"
  );
}

function readOptionalMerchantPayoutWalletStatus(
  value: unknown
): MerchantPayoutWalletStatus | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "active" || value === "paused" || value === "retired") {
    return value;
  }
  throw new MerchantRegistryValidationError(
    "status must be a valid merchant payout wallet status"
  );
}

function readOptionalWalletAuthPurpose(value: unknown): WalletAuthPurpose | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "merchant-session") {
    return value;
  }
  throw new MerchantRegistryValidationError("purpose must be merchant-session");
}

function requireRouteCampaignRegistry(
  options: Pick<ControlPlaneAppOptions, "campaignRegistry">
): CampaignRegistry {
  if (options.campaignRegistry === undefined) {
    throw new RouteRegistryValidationError(
      "campaign registry is required for route registration"
    );
  }
  return options.campaignRegistry;
}

async function loadActiveCampaignForRoute(
  campaignRegistry: CampaignRegistry,
  campaignId: string
): Promise<CampaignProfile> {
  const campaign = await campaignRegistry.getCampaign(campaignId);
  if (campaign === undefined) {
    throw new RouteRegistryValidationError(`unknown campaign: ${campaignId}`);
  }
  if (campaign.status !== "active") {
    throw new RouteRegistryValidationError("campaign must be active");
  }
  return campaign;
}

function assertRouteScopeMatchesCampaign(
  campaign: CampaignProfile,
  resourceOrigin: string,
  operationIds: RouteOperationScope
): void {
  if (resourceOrigin !== campaign.current.terms.resourceOrigin) {
    throw new RouteRegistryValidationError(
      "route resourceOrigin must match the active campaign version"
    );
  }
  if (operationIds[0] === "*") {
    return;
  }

  const campaignOperationIds = new Set(
    campaign.current.terms.operations.map((operation) => operation.operationId)
  );
  const missingOperationIds = operationIds.filter(
    (operationId) => !campaignOperationIds.has(operationId)
  );
  if (missingOperationIds.length > 0) {
    throw new RouteRegistryValidationError(
      `route operationIds are not in the active campaign version: ${missingOperationIds.join(", ")}`
    );
  }
}

function readOptionalRouteOperationScope(
  value: unknown
): RouteOperationScope | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new RouteRegistryValidationError(
      "operationIds must be a non-empty array"
    );
  }
  if (value.includes("*")) {
    if (value.length !== 1 || value[0] !== "*") {
      throw new RouteRegistryValidationError(
        "operationIds wildcard must be the only scope entry"
      );
    }
    return ["*"];
  }
  const operationIds = value.map((operationId) => {
    if (typeof operationId !== "string" || operationId.trim().length === 0) {
      throw new RouteRegistryValidationError(
        "operationIds entries must be non-empty strings"
      );
    }
    return operationId;
  });
  if (new Set(operationIds).size !== operationIds.length) {
    throw new RouteRegistryValidationError("operationIds entries must be unique");
  }
  return operationIds;
}

function readOptionalRouteQueryString(
  value: unknown,
  label: string
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RouteRegistryValidationError(`${label} must be a non-empty string`);
  }
  return value;
}

function readOptionalRouteStatus(value: unknown): RouteStatus | undefined {
  const status = readOptionalRouteQueryString(value, "status");
  if (status === undefined) {
    return undefined;
  }
  if (
    status === "active" ||
    status === "suspended" ||
    status === "expired" ||
    status === "revoked"
  ) {
    return status;
  }
  throw new RouteRegistryValidationError(
    "status must be active, suspended, expired, or revoked"
  );
}

function readOptionalRouteSearchLimit(value: unknown): number | undefined {
  const limit = readOptionalRouteQueryString(value, "limit");
  if (limit === undefined) {
    return undefined;
  }
  if (!/^[1-9][0-9]*$/u.test(limit)) {
    throw new RouteRegistryValidationError("limit must be a positive integer");
  }
  return Number.parseInt(limit, 10);
}

function readOptionalSha256Hash(
  value: unknown,
  label: string
): `sha256:${string}` | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new RouteRegistryValidationError(`${label} must be a sha256 hash`);
  }
  return value as `sha256:${string}`;
}

function readReferralClaim(value: unknown): ReferralClaimV1 {
  const parsed = ReferralClaimV1Schema.safeParse(value);
  if (!parsed.success) {
    throw new RouteRegistryValidationError(
      parsed.error.issues.map((issue) => issue.message).join("; ")
    );
  }
  return parsed.data;
}

function readCampaignTermsInput(body: Record<string, unknown>): CampaignTermsInput {
  const protocolFeeBps = readOptionalNumber(body.protocolFeeBps, "protocolFeeBps");
  const commissionBase = readOptionalCampaignCommissionBase(body.commissionBase);
  const attributionRequired = readOptionalBoolean(
    body.attributionRequired,
    "attributionRequired"
  );
  const allowSelfReferral = readOptionalBoolean(
    body.allowSelfReferral,
    "allowSelfReferral"
  );
  const endsAt = readOptionalNullableString(body.endsAt, "endsAt");
  return {
    resourceOrigin: readRequiredString(body.resourceOrigin, "resourceOrigin"),
    operations: readCampaignOperations(body.operations),
    network: readRequiredString(body.network, "network"),
    asset: readRequiredString(body.asset, "asset"),
    requiredAmountAtomic: readRequiredString(
      body.requiredAmountAtomic,
      "requiredAmountAtomic"
    ),
    payToWallet: readRequiredString(body.payToWallet, "payToWallet"),
    commissionBps: readRequiredNumber(body.commissionBps, "commissionBps"),
    ...(protocolFeeBps === undefined ? {} : { protocolFeeBps }),
    ...(commissionBase === undefined ? {} : { commissionBase }),
    ...(attributionRequired === undefined ? {} : { attributionRequired }),
    ...(allowSelfReferral === undefined ? {} : { allowSelfReferral }),
    payoutThresholdAtomic: readRequiredString(
      body.payoutThresholdAtomic,
      "payoutThresholdAtomic"
    ),
    startsAt: readRequiredString(body.startsAt, "startsAt"),
    ...(endsAt === undefined ? {} : { endsAt })
  };
}

function readCampaignOperations(value: unknown): CampaignOperation[] {
  if (!Array.isArray(value)) {
    throw new MerchantRegistryValidationError("operations must be an array");
  }
  return value.map((item) => {
    const operation = requireJsonObject(item);
    const inputSchema =
      operation.inputSchema === undefined
        ? undefined
        : operation.inputSchema;
    return {
      operationId: readRequiredString(operation.operationId, "operationId"),
      method: readRequiredString(operation.method, "method"),
      pathTemplate: readRequiredString(operation.pathTemplate, "pathTemplate"),
      ...(inputSchema === undefined ? {} : { inputSchema })
    };
  });
}

function readRequiredNumber(value: unknown, label: string): number {
  if (typeof value !== "number") {
    throw new MerchantRegistryValidationError(`${label} must be a number`);
  }
  return value;
}

function readOptionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return readRequiredNumber(value, label);
}

function readOptionalPositiveInteger(
  value: unknown,
  label: string
): number | undefined {
  const number = readOptionalNumber(value, label);
  if (number === undefined) {
    return undefined;
  }
  if (!Number.isInteger(number) || number <= 0) {
    throw new MerchantRegistryValidationError(
      `${label} must be a positive integer`
    );
  }
  return number;
}

function readOptionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new MerchantRegistryValidationError(`${label} must be a boolean`);
  }
  return value;
}

function readOptionalNullableString(
  value: unknown,
  label: string
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  return readRequiredString(value, label);
}

function readOptionalCampaignCommissionBase(
  value: unknown
): CampaignCommissionBase | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "required_amount") {
    return value;
  }
  throw new MerchantRegistryValidationError(
    "commissionBase must be required_amount"
  );
}

function readRouteParam(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new MerchantRegistryValidationError(`${label} route parameter is required`);
  }
  return value;
}

function readPositiveIntegerParam(value: unknown, label: string): number {
  const raw = readRouteParam(value, label);
  if (!/^[1-9][0-9]*$/u.test(raw)) {
    throw new MerchantRegistryValidationError(`${label} must be a positive integer`);
  }
  return Number.parseInt(raw, 10);
}

function readReceiptSource(value: unknown): ReceiptIngestSource | undefined {
  if (value === undefined) {
    return undefined;
  }
  return isReceiptIngestSource(value) ? value : undefined;
}

function readPayoutFundingBalances(
  value: unknown
): PayoutFundingBalance[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new MerchantRegistryValidationError("fundingBalances must be an array");
  }
  return value.map((item) => {
    const record = requireJsonObject(item);
    const fundingWallet = readOptionalString(record.fundingWallet, "fundingWallet");
    return {
      asset: readRequiredString(record.asset, "asset"),
      amountAtomic: readRequiredString(record.amountAtomic, "amountAtomic"),
      ...(fundingWallet === undefined ? {} : { fundingWallet })
    };
  });
}

function jsonErrorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  const status = readHttpErrorStatus(error);
  if (status !== undefined) {
    res.status(status).json({
      status: "rejected",
      errors: [error instanceof Error ? error.message : "invalid request body"]
    });
    return;
  }

  next(error);
}

function readHttpErrorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && status >= 400 && status < 500
    ? status
    : undefined;
}

function comparePayoutTransactions(
  left: PayoutTransactionRecord,
  right: PayoutTransactionRecord
): number {
  return (
    left.sequence - right.sequence ||
    left.attempt - right.attempt ||
    left.createdAt.localeCompare(right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

function createRuntimePool(
  env: NodeJS.ProcessEnv,
  poolFactory: ((config: PoolConfig) => PostgresPool) | undefined
): PostgresPool {
  const connectionString = env.SPLIT402_DATABASE_URL ?? env.DATABASE_URL;
  if (connectionString === undefined || connectionString.trim().length === 0) {
    throw new Error("SPLIT402_DATABASE_URL or DATABASE_URL is required");
  }

  const poolConfig: PoolConfig = { connectionString };
  const max = readOptionalRuntimePositiveInteger(
    env.SPLIT402_DATABASE_POOL_MAX,
    "SPLIT402_DATABASE_POOL_MAX"
  );
  if (max !== undefined) {
    poolConfig.max = max;
  }

  if (readOptionalRuntimeBoolean(env.SPLIT402_DATABASE_SSL, "SPLIT402_DATABASE_SSL") === true) {
    poolConfig.ssl = {
      rejectUnauthorized:
        env.SPLIT402_DATABASE_SSL_REJECT_UNAUTHORIZED !== "false"
    };
  }

  return poolFactory?.(poolConfig) ?? new Pool(poolConfig);
}

async function closeRuntimePool(pool: PostgresPool): Promise<void> {
  const closable = pool as PostgresPool & { end?: () => Promise<void> | void };
  await closable.end?.();
}

function readRuntimeAuthPolicy(value: string): ControlPlaneRuntimeAuthPolicy {
  if (value === "disabled" || value === "optional" || value === "required") {
    return value;
  }
  throw new Error(
    "SPLIT402_CONTROL_PLANE_AUTH_POLICY must be disabled, optional, or required"
  );
}

function readWalletAuthEnvOptions(
  env: NodeJS.ProcessEnv
): WalletAuthenticatorOptions {
  const challengeTtlMs = readOptionalRuntimePositiveInteger(
    env.SPLIT402_WALLET_AUTH_CHALLENGE_TTL_MS,
    "SPLIT402_WALLET_AUTH_CHALLENGE_TTL_MS"
  );
  const sessionTtlMs = readOptionalRuntimePositiveInteger(
    env.SPLIT402_WALLET_AUTH_SESSION_TTL_MS,
    "SPLIT402_WALLET_AUTH_SESSION_TTL_MS"
  );
  const refreshTokenTtlMs = readOptionalRuntimePositiveInteger(
    env.SPLIT402_WALLET_AUTH_REFRESH_TOKEN_TTL_MS,
    "SPLIT402_WALLET_AUTH_REFRESH_TOKEN_TTL_MS"
  );
  return {
    ...(challengeTtlMs === undefined ? {} : { challengeTtlMs }),
    ...(sessionTtlMs === undefined ? {} : { sessionTtlMs }),
    ...(refreshTokenTtlMs === undefined ? {} : { refreshTokenTtlMs })
  };
}

function readOptionalRuntimePositiveInteger(
  value: string | undefined,
  label: string
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new Error(`${label} must be a positive integer`);
  }
  return Number.parseInt(value, 10);
}

function readOptionalRuntimeBoolean(
  value: string | undefined,
  label: string
): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`${label} must be true or false`);
}

export * from "./errors.js";
export * from "./auth.js";
export * from "./campaigns.js";
export * from "./merchants.js";
export * from "./migrations.js";
export * from "./payouts.js";
export * from "./postgres.js";
export * from "./routes.js";
export * from "./solana.js";
export * from "./webhooks.js";
export * from "./workers.js";

function isMerchantAuthRequired(
  options: Pick<ControlPlaneAppOptions, "auth">
): boolean {
  return options.auth?.requireMerchantAuth ?? options.auth !== undefined;
}

async function readMerchantMutationSession(
  req: Request,
  res: Response,
  options: Pick<ControlPlaneAppOptions, "auth">
): Promise<AuthenticatedWalletSession | undefined> {
  if (!isMerchantAuthRequired(options)) {
    return undefined;
  }
  const accessToken = readBearerAccessToken(req);
  if (accessToken === undefined) {
    res.status(401).json({
      error: "unauthorized",
      message: "bearer access token required"
    });
    return undefined;
  }
  const session = await options.auth?.authenticator.authenticateAccessToken(
    accessToken
  );
  if (session === undefined || session.purpose !== "merchant-session") {
    res.status(401).json({
      error: "unauthorized",
      message: "invalid or expired access token"
    });
    return undefined;
  }
  return session;
}

async function requireMerchantOwnerSession(
  req: Request,
  res: Response,
  options: Pick<ControlPlaneAppOptions, "auth">,
  merchantRegistry: MerchantRegistry
): Promise<AuthenticatedWalletSession | undefined> {
  const session = await readMerchantMutationSession(req, res, options);
  if (session === undefined) {
    return undefined;
  }

  const merchantId = req.params.merchantId;
  if (typeof merchantId !== "string") {
    res.status(404).json({ error: "merchant_not_found" });
    return undefined;
  }

  const merchant = await merchantRegistry.getMerchantProfile(merchantId);
  if (merchant === undefined) {
    res.status(404).json({ error: "merchant_not_found" });
    return undefined;
  }
  if (merchant.ownerWallet !== session.wallet) {
    res.status(403).json({
      error: "forbidden",
      message: "authenticated wallet does not own merchant"
    });
    return undefined;
  }
  return session;
}

async function requireMerchantOwnerForMerchantId(
  req: Request,
  res: Response,
  options: Pick<ControlPlaneAppOptions, "auth" | "merchantRegistry">,
  merchantId: string
): Promise<AuthenticatedWalletSession | undefined> {
  const session = await readMerchantMutationSession(req, res, options);
  if (session === undefined) {
    return undefined;
  }
  if (options.merchantRegistry === undefined) {
    res.status(500).json({
      error: "internal_server_error",
      message: "merchant registry is required for owner authorization"
    });
    return undefined;
  }

  const merchant = await options.merchantRegistry.getMerchantProfile(merchantId);
  if (merchant === undefined) {
    res.status(404).json({ error: "merchant_not_found" });
    return undefined;
  }
  if (merchant.ownerWallet !== session.wallet) {
    res.status(403).json({
      error: "forbidden",
      message: "authenticated wallet does not own merchant"
    });
    return undefined;
  }
  return session;
}

function readBearerAccessToken(req: Request): string | undefined {
  const authorization = req.header("authorization");
  if (authorization === undefined) {
    return undefined;
  }
  const parts = authorization.trim().split(/\s+/u);
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== "bearer") {
    return undefined;
  }
  const token = parts[1];
  return token === undefined || token.trim().length === 0 ? undefined : token;
}

function sendMerchantRegistryError(res: Response, error: unknown): boolean {
  if (isMerchantRegistryValidationError(error)) {
    res.status(400).json({ error: "invalid_request", message: error.message });
    return true;
  }
  if (isMerchantRegistryConflict(error)) {
    res.status(409).json({ error: "conflict", message: error.message });
    return true;
  }
  return false;
}

function sendWalletAuthError(res: Response, error: unknown): boolean {
  if (isWalletAuthValidationError(error)) {
    res.status(400).json({ error: "invalid_request", message: error.message });
    return true;
  }
  if (isWalletAuthRejectedError(error)) {
    res.status(401).json({ error: "unauthorized", message: error.message });
    return true;
  }
  return false;
}

function sendCampaignRegistryError(res: Response, error: unknown): boolean {
  if (isCampaignRegistryValidationError(error)) {
    res.status(400).json({ error: "invalid_request", message: error.message });
    return true;
  }
  if (isCampaignRegistryConflictError(error)) {
    res.status(409).json({ error: "conflict", message: error.message });
    return true;
  }
  return false;
}

function sendRouteRegistryError(res: Response, error: unknown): boolean {
  if (isRouteRegistryValidationError(error)) {
    res.status(400).json({ error: "invalid_request", message: error.message });
    return true;
  }
  if (isRouteRegistryConflictError(error)) {
    res.status(409).json({ error: "conflict", message: error.message });
    return true;
  }
  return false;
}

function sendPayoutPreviewError(res: Response, error: unknown): boolean {
  if (isPayoutPreviewValidationError(error)) {
    res.status(400).json({ error: "invalid_request", message: error.message });
    return true;
  }
  return false;
}

function sendPayoutBatchError(res: Response, error: unknown): boolean {
  if (isPayoutBatchValidationError(error)) {
    res.status(400).json({ error: "invalid_request", message: error.message });
    return true;
  }
  if (isPayoutBatchConflictError(error)) {
    res.status(409).json({ error: "conflict", message: error.message });
    return true;
  }
  return false;
}
