import {
  Split402ReceiptV1Schema,
  hashProtocolObject,
  verifySplit402ReceiptObject,
  type Split402ReceiptV1
} from "@split402/protocol";
import express from "express";
import type { NextFunction, Request, Response, Router } from "express";

import { isReceiptIngestionPersistenceConflict } from "./errors.js";

export type ReceiptIngestSource = "buyer" | "merchant" | "relay" | "unknown";
export type ReceiptVerificationState =
  | "signature_verified"
  | "pending_chain_verification";
export type AccrualStatus = "pending_chain_verification" | "available" | "held";
export type LedgerAccountType =
  | "merchant_commission_liability"
  | "referrer_payable"
  | "protocol_fee_payable";

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

export class InMemoryReceiptIngestionStore implements ReceiptIngestionStore {
  private readonly receiptsById = new Map<string, ReceiptIngestionSnapshot>();
  private readonly receiptIdByHash = new Map<`sha256:${string}`, string>();
  private readonly receiptIdByPaymentId = new Map<string, string>();
  private readonly receiptIdBySettlementTx = new Map<string, string>();

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

export interface ReceiptIngestionRouterOptions {
  ingestor: ReceiptIngestor;
  jsonLimit?: string;
}

export function createControlPlaneApp(
  options: ReceiptIngestionRouterOptions
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

  app.use(createReceiptIngestionRouter(options));

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

export function createReceiptIngestionRouter(
  options: ReceiptIngestionRouterOptions
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

function readReceiptSource(value: unknown): ReceiptIngestSource | undefined {
  if (value === undefined) {
    return undefined;
  }
  return isReceiptIngestSource(value) ? value : undefined;
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

export * from "./errors.js";
export * from "./postgres.js";
