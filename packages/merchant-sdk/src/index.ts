import {
  Sha256HashSchema,
  Split402IdSchema,
  Split402ReceiptV1Schema,
  calculateOperationDigest,
  createPrefixedId,
  deriveEd25519PublicKey,
  hashProtocolObject,
  type CalculateOperationDigestInput,
  type Split402ReceiptV1
} from "@split402/protocol";
import type { PaymentPayload } from "@x402/core/types";
import {
  PAYMENT_IDENTIFIER,
  appendPaymentIdentifierToExtensions,
  declarePaymentIdentifierExtension,
  extractPaymentIdentifier,
  isValidPaymentId,
  validatePaymentIdentifierRequirement,
  type PaymentIdentifierExtension,
  type PaymentIdentifierValidationResult
} from "@x402/extensions/payment-identifier";
import { randomBytes } from "node:crypto";

export interface MerchantRouteDeclaration {
  campaignId: string;
  operationId: string;
}

export interface MerchantCampaignConfig {
  campaignId: string;
  campaignVersion: number;
  campaignTermsHash: `sha256:${string}`;
  commissionBps: number;
  attributionRequired: boolean;
  allowSelfReferral: boolean;
}

export interface MerchantServiceSigningKey {
  kid: string;
  privateSeed: Uint8Array;
}

export interface MerchantServicePublicKey {
  kid: string;
  publicKey: string;
  current: boolean;
}

export interface MerchantCampaignOperation {
  operationId: string;
  method: string;
  pathTemplate: string;
  inputSchema?: unknown;
}

export interface MerchantCachedCampaign {
  campaignId: string;
  status: "active";
  config: MerchantCampaignConfig;
  operations: MerchantCampaignOperation[];
  fetchedAt: string;
  staleAt: string;
}

export interface CachedControlPlaneCampaignResolverOptions {
  controlPlaneUrl: string;
  fetch?: MerchantControlPlaneFetch;
  headers?: Record<string, string>;
  staleAfterMs?: number;
  now?: () => Date;
}

export type MerchantControlPlaneFetch = (
  input: string,
  init: {
    method: "GET";
    headers: Record<string, string>;
  }
) => Promise<MerchantControlPlaneFetchResponse>;

export interface MerchantControlPlaneFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export class MerchantCampaignResolverError extends Error {
  readonly code = "merchant_campaign_resolver_error";

  constructor(message: string) {
    super(message);
    this.name = "MerchantCampaignResolverError";
  }
}

export class MerchantOperationDigestError extends Error {
  readonly code = "merchant_operation_digest_error";

  constructor(message: string) {
    super(message);
    this.name = "MerchantOperationDigestError";
  }
}

export class MerchantPaymentIdentifierError extends Error {
  readonly code = "merchant_payment_identifier_error";

  constructor(message: string) {
    super(message);
    this.name = "MerchantPaymentIdentifierError";
  }
}

export class MerchantServiceKeyRingError extends Error {
  readonly code = "merchant_service_key_ring_error";

  constructor(message: string) {
    super(message);
    this.name = "MerchantServiceKeyRingError";
  }
}

export class InMemoryMerchantServiceKeyRing {
  private readonly keysByKid = new Map<
    string,
    MerchantServiceSigningKey & { publicKey: string }
  >();
  private currentKid = "";

  constructor(input: {
    current: MerchantServiceSigningKey;
    additional?: MerchantServiceSigningKey[];
  }) {
    this.addKey(input.current, { makeCurrent: true });
    for (const key of input.additional ?? []) {
      this.addKey(key);
    }
    this.currentKid = input.current.kid;
  }

  addKey(
    key: MerchantServiceSigningKey,
    options: { makeCurrent?: boolean } = {}
  ): MerchantServicePublicKey {
    const stored = storeServiceSigningKey(key);
    this.keysByKid.set(stored.kid, stored);
    if (options.makeCurrent === true) {
      this.currentKid = stored.kid;
    }
    return {
      kid: stored.kid,
      publicKey: stored.publicKey,
      current: this.currentKid === stored.kid
    };
  }

  rotateTo(kid: string): MerchantServicePublicKey {
    const key = this.keysByKid.get(assertServiceKid(kid));
    if (key === undefined) {
      throw new MerchantServiceKeyRingError(`unknown service key kid: ${kid}`);
    }
    this.currentKid = key.kid;
    return {
      kid: key.kid,
      publicKey: key.publicKey,
      current: true
    };
  }

  current(): MerchantServiceSigningKey {
    const key = this.keysByKid.get(this.currentKid);
    if (key === undefined) {
      throw new MerchantServiceKeyRingError("current service key is missing");
    }
    return cloneServiceSigningKey(key);
  }

  resolvePublicKey(kid: string): string | undefined {
    return this.keysByKid.get(assertServiceKid(kid))?.publicKey;
  }

  listPublicKeys(): MerchantServicePublicKey[] {
    return Array.from(this.keysByKid.values())
      .map((key) => ({
        kid: key.kid,
        publicKey: key.publicKey,
        current: key.kid === this.currentKid
      }))
      .sort((left, right) => left.kid.localeCompare(right.kid));
  }
}

export const SPLIT402_PAYMENT_IDENTIFIER_EXTENSION_KEY = PAYMENT_IDENTIFIER;

export type MerchantPaymentIdentifierExtension = PaymentIdentifierExtension;
export type MerchantPaymentIdentifierValidationResult =
  PaymentIdentifierValidationResult;

export function declareRequiredPaymentIdentifierExtension(): Record<
  typeof SPLIT402_PAYMENT_IDENTIFIER_EXTENSION_KEY,
  PaymentIdentifierExtension
> {
  return {
    [SPLIT402_PAYMENT_IDENTIFIER_EXTENSION_KEY]:
      declarePaymentIdentifierExtension(true)
  };
}

export function createSplit402PaymentIdentifier(): string {
  const paymentId = createPrefixedId("pay");
  if (!isValidPaymentId(paymentId)) {
    throw new MerchantPaymentIdentifierError(
      "generated payment identifier is not valid for x402"
    );
  }
  return paymentId;
}

export function appendSplit402PaymentIdentifier(
  extensions: Record<string, unknown>,
  paymentId = createSplit402PaymentIdentifier()
): Record<string, unknown> {
  assertSplit402PaymentIdentifier(paymentId);
  return appendPaymentIdentifierToExtensions({ ...extensions }, paymentId);
}

export function extractSplit402PaymentIdentifier(
  paymentPayload: PaymentPayload
): string | undefined {
  return extractPaymentIdentifier(paymentPayload) ?? undefined;
}

export function validateRequiredSplit402PaymentIdentifier(
  paymentPayload: PaymentPayload
): PaymentIdentifierValidationResult {
  return validatePaymentIdentifierRequirement(paymentPayload, true);
}

export function assertRequiredSplit402PaymentIdentifier(
  paymentPayload: PaymentPayload
): string {
  const validation = validateRequiredSplit402PaymentIdentifier(paymentPayload);
  if (!validation.valid) {
    throw new MerchantPaymentIdentifierError(
      validation.errors?.join("; ") ?? "payment identifier is required"
    );
  }
  const paymentId = extractSplit402PaymentIdentifier(paymentPayload);
  if (paymentId === undefined) {
    throw new MerchantPaymentIdentifierError("payment identifier is required");
  }
  return assertSplit402PaymentIdentifier(paymentId);
}

export class CachedControlPlaneCampaignResolver {
  private readonly campaignsById = new Map<string, MerchantCachedCampaign>();
  private readonly staleAfterMs: number;
  private readonly now: () => Date;

  constructor(private readonly options: CachedControlPlaneCampaignResolverOptions) {
    this.staleAfterMs = options.staleAfterMs ?? 300_000;
    if (!Number.isInteger(this.staleAfterMs) || this.staleAfterMs < 0) {
      throw new Error("staleAfterMs must be a non-negative integer");
    }
    this.now = options.now ?? (() => new Date());
  }

  readonly resolveCampaign = (
    declaration: MerchantRouteDeclaration
  ): MerchantCampaignConfig => {
    const campaignId = assertSplit402IdValue(
      declaration.campaignId,
      "campaignId"
    );
    const operationId = assertNonEmptyString(
      declaration.operationId,
      "operationId"
    );
    const cached = this.campaignsById.get(campaignId);
    if (cached === undefined) {
      throw new MerchantCampaignResolverError(
        `campaign is not cached: ${campaignId}`
      );
    }
    if (!cached.operations.some((operation) => operation.operationId === operationId)) {
      throw new MerchantCampaignResolverError(
        `campaign ${campaignId} does not cover operation: ${operationId}`
      );
    }
    return cloneCampaignConfig(cached.config);
  };

  async refreshCampaign(campaignId: string): Promise<MerchantCachedCampaign> {
    const id = assertSplit402IdValue(campaignId, "campaignId");
    let response: MerchantControlPlaneFetchResponse;
    try {
      response = await this.fetch()(this.campaignUrl(id), {
        method: "GET",
        headers: this.headers()
      });
    } catch (error) {
      throw new MerchantCampaignResolverError(
        `campaign fetch failed: ${readErrorMessage(error)}`
      );
    }

    if (!response.ok) {
      throw new MerchantCampaignResolverError(
        `campaign fetch failed with HTTP ${response.status}`
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new MerchantCampaignResolverError(
        `campaign response was invalid JSON: ${readErrorMessage(error)}`
      );
    }

    const fetchedAt = this.now().toISOString();
    const staleAt = new Date(Date.parse(fetchedAt) + this.staleAfterMs).toISOString();
    const cached = parseCampaignResponse(body, {
      expectedCampaignId: id,
      fetchedAt,
      staleAt
    });
    this.campaignsById.set(cached.campaignId, cached);
    return cloneCachedCampaign(cached);
  }

  async refreshCampaigns(campaignIds: string[]): Promise<MerchantCachedCampaign[]> {
    const uniqueIds = Array.from(new Set(campaignIds));
    const campaigns: MerchantCachedCampaign[] = [];
    for (const campaignId of uniqueIds) {
      campaigns.push(await this.refreshCampaign(campaignId));
    }
    return campaigns;
  }

  getCachedCampaign(campaignId: string): MerchantCachedCampaign | undefined {
    const cached = this.campaignsById.get(
      assertSplit402IdValue(campaignId, "campaignId")
    );
    return cached === undefined ? undefined : cloneCachedCampaign(cached);
  }

  listCachedCampaigns(): MerchantCachedCampaign[] {
    return Array.from(this.campaignsById.values())
      .map(cloneCachedCampaign)
      .sort((left, right) => left.campaignId.localeCompare(right.campaignId));
  }

  isCampaignStale(campaignId: string): boolean {
    const cached = this.campaignsById.get(
      assertSplit402IdValue(campaignId, "campaignId")
    );
    if (cached === undefined) {
      return true;
    }
    return Date.parse(cached.staleAt) <= this.now().getTime();
  }

  private campaignUrl(campaignId: string): string {
    return new URL(
      `/v1/campaigns/${encodeURIComponent(campaignId)}`,
      this.options.controlPlaneUrl
    ).toString();
  }

  private headers(): Record<string, string> {
    return {
      accept: "application/json",
      ...(this.options.headers ?? {})
    };
  }

  private fetch(): MerchantControlPlaneFetch {
    return this.options.fetch ?? fetch;
  }
}

export interface MerchantOperationDigestBaseInput {
  merchantId: string;
  operationId: string;
  pathTemplate: string;
  paymentId: string;
  offerNonce: string;
  pathParams?: Record<string, unknown>;
  query?: Record<string, unknown>;
}

export type MerchantGetOperationDigestInput = MerchantOperationDigestBaseInput;

export interface MerchantJsonPostOperationDigestInput
  extends MerchantOperationDigestBaseInput {
  body: unknown;
}

export function buildGetOperationDigestInput(
  input: MerchantGetOperationDigestInput
): CalculateOperationDigestInput {
  return {
    ...buildOperationDigestBase(input),
    method: "GET"
  };
}

export function calculateGetOperationDigest(
  input: MerchantGetOperationDigestInput
): `sha256:${string}` {
  return calculateOperationDigest(buildGetOperationDigestInput(input));
}

export function buildJsonPostOperationDigestInput(
  input: MerchantJsonPostOperationDigestInput
): CalculateOperationDigestInput {
  assertJsonCompatible(input.body, "body");
  return {
    ...buildOperationDigestBase(input),
    method: "POST",
    body: input.body
  };
}

export function calculateJsonPostOperationDigest(
  input: MerchantJsonPostOperationDigestInput
): `sha256:${string}` {
  return calculateOperationDigest(buildJsonPostOperationDigestInput(input));
}

export type MerchantReceiptOutboxStatus =
  | "pending"
  | "accepted"
  | "dead_letter";

export interface MerchantReceiptOutboxRecord {
  id: string;
  receiptId: string;
  receiptHash: `sha256:${string}`;
  receiptJson: Split402ReceiptV1;
  attempts: number;
  nextAttemptAt: string;
  status: MerchantReceiptOutboxStatus;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
}

export interface EnqueueMerchantReceiptInput {
  id?: string;
  receipt: Split402ReceiptV1;
  now?: string;
  nextAttemptAt?: string;
}

export interface MerchantReceiptOutboxStore {
  enqueueReceipt(
    input: EnqueueMerchantReceiptInput
  ): Promise<MerchantReceiptOutboxRecord> | MerchantReceiptOutboxRecord;
  claimNextPending(
    input: ClaimNextMerchantReceiptInput
  ): Promise<MerchantReceiptOutboxRecord | undefined> | MerchantReceiptOutboxRecord | undefined;
  markAccepted(
    input: MarkMerchantReceiptAcceptedInput
  ): Promise<MerchantReceiptOutboxRecord | undefined> | MerchantReceiptOutboxRecord | undefined;
  markRetry(
    input: MarkMerchantReceiptRetryInput
  ): Promise<MerchantReceiptOutboxRecord | undefined> | MerchantReceiptOutboxRecord | undefined;
  markDeadLetter(
    input: MarkMerchantReceiptDeadLetterInput
  ): Promise<MerchantReceiptOutboxRecord | undefined> | MerchantReceiptOutboxRecord | undefined;
  getByReceiptId(
    receiptId: string
  ): Promise<MerchantReceiptOutboxRecord | undefined> | MerchantReceiptOutboxRecord | undefined;
}

export interface ClaimNextMerchantReceiptInput {
  now: string;
}

export interface MarkMerchantReceiptAcceptedInput {
  id: string;
  attempts: number;
  now: string;
}

export interface MarkMerchantReceiptRetryInput {
  id: string;
  attempts: number;
  lastError: string;
  nextAttemptAt: string;
  now: string;
}

export interface MarkMerchantReceiptDeadLetterInput {
  id: string;
  attempts: number;
  lastError: string;
  now: string;
}

export interface MerchantReceiptSubmitter {
  submitReceipt(
    receipt: Split402ReceiptV1
  ): Promise<MerchantReceiptSubmissionResult> | MerchantReceiptSubmissionResult;
}

export type MerchantReceiptSubmissionResult =
  | {
      status: "accepted";
      statusCode?: number;
      responseStatus?: string;
    }
  | {
      status: "retry";
      error: string;
      statusCode?: number;
    }
  | {
      status: "rejected";
      error: string;
      statusCode?: number;
      responseStatus?: string;
    };

export interface MerchantReceiptOutboxDispatcherOptions {
  maxAttempts?: number;
  now?: () => Date;
  retryDelayMs?: number;
}

export type MerchantReceiptOutboxDispatchResult =
  | { status: "idle" }
  | {
      status: "accepted";
      record: MerchantReceiptOutboxRecord;
      submission: Extract<MerchantReceiptSubmissionResult, { status: "accepted" }>;
    }
  | {
      status: "retry_scheduled";
      record: MerchantReceiptOutboxRecord;
      lastError: string;
      nextAttemptAt: string;
    }
  | {
      status: "dead_letter";
      record: MerchantReceiptOutboxRecord;
      lastError: string;
    };

export class MerchantReceiptOutboxConflictError extends Error {
  readonly code = "merchant_receipt_outbox_conflict";

  constructor(message: string) {
    super(message);
    this.name = "MerchantReceiptOutboxConflictError";
  }
}

export class InMemoryMerchantReceiptOutboxStore
  implements MerchantReceiptOutboxStore
{
  private readonly recordsById = new Map<string, MerchantReceiptOutboxRecord>();
  private readonly recordIdByReceiptId = new Map<string, string>();

  enqueueReceipt(input: EnqueueMerchantReceiptInput): MerchantReceiptOutboxRecord {
    const receipt = parseReceipt(input.receipt);
    const receiptHash = hashProtocolObject(receipt);
    const existingId = this.recordIdByReceiptId.get(receipt.receiptId);
    if (existingId !== undefined) {
      const existing = this.recordsById.get(existingId);
      if (existing !== undefined && existing.receiptHash === receiptHash) {
        return cloneRecord(existing);
      }
      throw new MerchantReceiptOutboxConflictError(
        `receipt already enqueued with different hash: ${receipt.receiptId}`
      );
    }

    const now = assertUtc(input.now ?? new Date().toISOString(), "now");
    const record: MerchantReceiptOutboxRecord = {
      id: input.id ?? createMerchantReceiptOutboxId(),
      receiptId: receipt.receiptId,
      receiptHash,
      receiptJson: receipt,
      attempts: 0,
      nextAttemptAt: assertUtc(input.nextAttemptAt ?? now, "nextAttemptAt"),
      status: "pending",
      createdAt: now,
      updatedAt: now
    };
    this.recordsById.set(record.id, record);
    this.recordIdByReceiptId.set(record.receiptId, record.id);
    return cloneRecord(record);
  }

  claimNextPending(
    input: ClaimNextMerchantReceiptInput
  ): MerchantReceiptOutboxRecord | undefined {
    const now = Date.parse(assertUtc(input.now, "now"));
    const record = Array.from(this.recordsById.values())
      .filter(
        (candidate) =>
          candidate.status === "pending" &&
          Date.parse(candidate.nextAttemptAt) <= now
      )
      .sort(comparePendingRecords)[0];
    return record === undefined ? undefined : cloneRecord(record);
  }

  markAccepted(
    input: MarkMerchantReceiptAcceptedInput
  ): MerchantReceiptOutboxRecord | undefined {
    const record = this.recordsById.get(input.id);
    if (record === undefined) {
      return undefined;
    }
    const updated = {
      ...record,
      attempts: input.attempts,
      status: "accepted" as const,
      updatedAt: assertUtc(input.now, "now")
    };
    delete updated.lastError;
    this.recordsById.set(updated.id, updated);
    return cloneRecord(updated);
  }

  markRetry(
    input: MarkMerchantReceiptRetryInput
  ): MerchantReceiptOutboxRecord | undefined {
    const record = this.recordsById.get(input.id);
    if (record === undefined) {
      return undefined;
    }
    const updated: MerchantReceiptOutboxRecord = {
      ...record,
      attempts: input.attempts,
      nextAttemptAt: assertUtc(input.nextAttemptAt, "nextAttemptAt"),
      status: "pending",
      updatedAt: assertUtc(input.now, "now"),
      lastError: input.lastError
    };
    this.recordsById.set(updated.id, updated);
    return cloneRecord(updated);
  }

  markDeadLetter(
    input: MarkMerchantReceiptDeadLetterInput
  ): MerchantReceiptOutboxRecord | undefined {
    const record = this.recordsById.get(input.id);
    if (record === undefined) {
      return undefined;
    }
    const updated: MerchantReceiptOutboxRecord = {
      ...record,
      attempts: input.attempts,
      status: "dead_letter",
      updatedAt: assertUtc(input.now, "now"),
      lastError: input.lastError
    };
    this.recordsById.set(updated.id, updated);
    return cloneRecord(updated);
  }

  getByReceiptId(receiptId: string): MerchantReceiptOutboxRecord | undefined {
    const id = this.recordIdByReceiptId.get(receiptId);
    if (id === undefined) {
      return undefined;
    }
    const record = this.recordsById.get(id);
    return record === undefined ? undefined : cloneRecord(record);
  }
}

export class MerchantReceiptOutboxDispatcher {
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;

  constructor(
    private readonly store: MerchantReceiptOutboxStore,
    private readonly submitter: MerchantReceiptSubmitter,
    options: MerchantReceiptOutboxDispatcherOptions = {}
  ) {
    this.maxAttempts = options.maxAttempts ?? 10;
    this.retryDelayMs = options.retryDelayMs ?? 60_000;
    if (!Number.isInteger(this.maxAttempts) || this.maxAttempts <= 0) {
      throw new Error("maxAttempts must be a positive integer");
    }
    if (!Number.isInteger(this.retryDelayMs) || this.retryDelayMs <= 0) {
      throw new Error("retryDelayMs must be a positive integer");
    }
    this.now = options.now ?? (() => new Date());
  }

  private readonly now: () => Date;

  async dispatchNext(): Promise<MerchantReceiptOutboxDispatchResult> {
    const now = this.now().toISOString();
    const record = await this.store.claimNextPending({ now });
    if (record === undefined) {
      return { status: "idle" };
    }

    const attempts = record.attempts + 1;
    const submission = await this.submitter.submitReceipt(record.receiptJson);
    if (submission.status === "accepted") {
      const accepted = await this.store.markAccepted({
        id: record.id,
        attempts,
        now
      });
      return {
        status: "accepted",
        record: accepted ?? record,
        submission
      };
    }

    const lastError = submission.error;
    if (submission.status === "rejected" || attempts >= this.maxAttempts) {
      const deadLetter = await this.store.markDeadLetter({
        id: record.id,
        attempts,
        lastError,
        now
      });
      return {
        status: "dead_letter",
        record: deadLetter ?? record,
        lastError
      };
    }

    const nextAttemptAt = new Date(
      Date.parse(now) + this.retryDelayMs
    ).toISOString();
    const retry = await this.store.markRetry({
      id: record.id,
      attempts,
      lastError,
      nextAttemptAt,
      now
    });
    return {
      status: "retry_scheduled",
      record: retry ?? record,
      lastError,
      nextAttemptAt
    };
  }
}

export interface ControlPlaneReceiptSubmitterOptions {
  controlPlaneUrl: string;
  fetch?: MerchantReceiptFetch;
}

export type MerchantReceiptFetch = (
  input: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
  }
) => Promise<MerchantReceiptFetchResponse>;

export interface MerchantReceiptFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export class ControlPlaneReceiptSubmitter implements MerchantReceiptSubmitter {
  constructor(private readonly options: ControlPlaneReceiptSubmitterOptions) {}

  async submitReceipt(
    receipt: Split402ReceiptV1
  ): Promise<MerchantReceiptSubmissionResult> {
    let response: MerchantReceiptFetchResponse;
    try {
      response = await this.fetch()(this.receiptsUrl(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ receipt, source: "merchant" })
      });
    } catch (error) {
      return {
        status: "retry",
        error: `receipt submission failed: ${readErrorMessage(error)}`
      };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      return {
        status: response.ok ? "retry" : classifyHttpFailure(response.status),
        statusCode: response.status,
        error: `receipt submission response was invalid JSON: ${readErrorMessage(error)}`
      };
    }

    if (response.ok) {
      const responseStatus = readOptionalStatus(body);
      if (
        responseStatus === undefined ||
        responseStatus === "created" ||
        responseStatus === "duplicate" ||
        responseStatus === "accepted"
      ) {
        return {
          status: "accepted",
          statusCode: response.status,
          ...(responseStatus === undefined ? {} : { responseStatus })
        };
      }
      return {
        status: "rejected",
        statusCode: response.status,
        responseStatus,
        error: `control plane returned unexpected receipt status: ${responseStatus}`
      };
    }

    const error = readSubmissionError(body) ?? `HTTP ${response.status}`;
    const failureStatus = classifyHttpFailure(response.status);
    if (failureStatus === "retry") {
      return {
        status: "retry",
        statusCode: response.status,
        error
      };
    }
    const responseStatus = readOptionalStatus(body);
    return {
      status: "rejected",
      statusCode: response.status,
      ...(responseStatus === undefined ? {} : { responseStatus }),
      error
    };
  }

  private receiptsUrl(): string {
    return new URL("/v1/receipts", this.options.controlPlaneUrl).toString();
  }

  private fetch(): MerchantReceiptFetch {
    return this.options.fetch ?? fetch;
  }
}

function buildOperationDigestBase(
  input: MerchantOperationDigestBaseInput
): Omit<CalculateOperationDigestInput, "method" | "body"> {
  return {
    merchantId: assertOperationSplit402IdValue(input.merchantId, "merchantId"),
    operationId: assertOperationNonEmptyString(input.operationId, "operationId"),
    pathTemplate: assertOperationNonEmptyString(
      input.pathTemplate,
      "pathTemplate"
    ),
    paymentId: assertOperationSplit402IdValue(input.paymentId, "paymentId"),
    offerNonce: assertOperationSplit402IdValue(input.offerNonce, "offerNonce"),
    pathParams: normalizeOperationRecord(input.pathParams, "pathParams"),
    query: normalizeOperationRecord(input.query, "query")
  };
}

function parseCampaignResponse(
  body: unknown,
  context: {
    expectedCampaignId: string;
    fetchedAt: string;
    staleAt: string;
  }
): MerchantCachedCampaign {
  const campaign = requireRecord(
    requireRecord(body, "response").campaign,
    "campaign"
  );
  const campaignId = assertSplit402IdValue(
    readRequiredString(campaign.id, "campaign.id"),
    "campaign.id"
  );
  if (campaignId !== context.expectedCampaignId) {
    throw new MerchantCampaignResolverError(
      `campaign response id mismatch: expected ${context.expectedCampaignId}, got ${campaignId}`
    );
  }

  const status = readRequiredString(campaign.status, "campaign.status");
  if (status !== "active") {
    throw new MerchantCampaignResolverError(
      `campaign ${campaignId} is not active: ${status}`
    );
  }

  const current = requireRecord(campaign.current, "campaign.current");
  const currentCampaignId = assertSplit402IdValue(
    readRequiredString(current.campaignId, "campaign.current.campaignId"),
    "campaign.current.campaignId"
  );
  if (currentCampaignId !== campaignId) {
    throw new MerchantCampaignResolverError(
      `campaign.current.campaignId does not match campaign.id: ${currentCampaignId}`
    );
  }

  const terms = requireRecord(current.terms, "campaign.current.terms");
  const termsCampaignId = assertSplit402IdValue(
    readRequiredString(terms.campaignId, "campaign.current.terms.campaignId"),
    "campaign.current.terms.campaignId"
  );
  if (termsCampaignId !== campaignId) {
    throw new MerchantCampaignResolverError(
      `campaign terms campaignId does not match campaign.id: ${termsCampaignId}`
    );
  }

  const version = readPositiveInteger(current.version, "campaign.current.version");
  const termsVersion = readPositiveInteger(
    terms.campaignVersion,
    "campaign.current.terms.campaignVersion"
  );
  if (termsVersion !== version) {
    throw new MerchantCampaignResolverError(
      `campaign terms version does not match current version: ${termsVersion}`
    );
  }

  const operations = readCampaignOperations(
    terms.operations,
    "campaign.current.terms.operations"
  );
  const config: MerchantCampaignConfig = {
    campaignId,
    campaignVersion: version,
    campaignTermsHash: assertSha256HashValue(
      readRequiredString(current.termsHash, "campaign.current.termsHash"),
      "campaign.current.termsHash"
    ),
    commissionBps: readBasisPoints(
      terms.commissionBps,
      "campaign.current.terms.commissionBps"
    ),
    attributionRequired: readRequiredBoolean(
      terms.attributionRequired,
      "campaign.current.terms.attributionRequired"
    ),
    allowSelfReferral: readRequiredBoolean(
      terms.allowSelfReferral,
      "campaign.current.terms.allowSelfReferral"
    )
  };

  return {
    campaignId,
    status: "active",
    config,
    operations,
    fetchedAt: assertUtc(context.fetchedAt, "fetchedAt"),
    staleAt: assertUtc(context.staleAt, "staleAt")
  };
}

function parseReceipt(receipt: Split402ReceiptV1): Split402ReceiptV1 {
  return Split402ReceiptV1Schema.parse(receipt);
}

function createMerchantReceiptOutboxId(): string {
  return `mro_${randomBytes(16).toString("hex")}`;
}

function cloneRecord(
  record: MerchantReceiptOutboxRecord
): MerchantReceiptOutboxRecord {
  return {
    ...record,
    receiptJson: {
      ...record.receiptJson,
      ...(record.receiptJson.routeId === undefined
        ? {}
        : { routeId: record.receiptJson.routeId })
    }
  };
}

function cloneCachedCampaign(
  campaign: MerchantCachedCampaign
): MerchantCachedCampaign {
  return {
    ...campaign,
    config: cloneCampaignConfig(campaign.config),
    operations: campaign.operations.map(cloneCampaignOperation)
  };
}

function cloneCampaignConfig(
  config: MerchantCampaignConfig
): MerchantCampaignConfig {
  return { ...config };
}

function cloneCampaignOperation(
  operation: MerchantCampaignOperation
): MerchantCampaignOperation {
  return {
    operationId: operation.operationId,
    method: operation.method,
    pathTemplate: operation.pathTemplate,
    ...(operation.inputSchema === undefined
      ? {}
      : { inputSchema: operation.inputSchema })
  };
}

function storeServiceSigningKey(
  key: MerchantServiceSigningKey
): MerchantServiceSigningKey & { publicKey: string } {
  const kid = assertServiceKid(key.kid);
  const privateSeed = clonePrivateSeed(key.privateSeed);
  return {
    kid,
    privateSeed,
    publicKey: deriveEd25519PublicKey(privateSeed)
  };
}

function cloneServiceSigningKey(
  key: MerchantServiceSigningKey
): MerchantServiceSigningKey {
  return {
    kid: key.kid,
    privateSeed: clonePrivateSeed(key.privateSeed)
  };
}

function clonePrivateSeed(privateSeed: Uint8Array): Uint8Array {
  if (privateSeed.byteLength !== 32) {
    throw new MerchantServiceKeyRingError(
      "service private seed must be 32 bytes"
    );
  }
  return new Uint8Array(privateSeed);
}

function comparePendingRecords(
  left: MerchantReceiptOutboxRecord,
  right: MerchantReceiptOutboxRecord
): number {
  const nextAttemptComparison =
    Date.parse(left.nextAttemptAt) - Date.parse(right.nextAttemptAt);
  if (nextAttemptComparison !== 0) {
    return nextAttemptComparison;
  }
  const createdAtComparison =
    Date.parse(left.createdAt) - Date.parse(right.createdAt);
  if (createdAtComparison !== 0) {
    return createdAtComparison;
  }
  return left.id.localeCompare(right.id);
}

function assertUtc(value: string, label: string): string {
  if (!value.endsWith("Z") || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be a UTC timestamp`);
  }
  return value;
}

function assertSplit402IdValue(value: string, label: string): string {
  const parsed = Split402IdSchema.safeParse(value);
  if (!parsed.success) {
    throw new MerchantCampaignResolverError(`${label} must be a Split402 id`);
  }
  return parsed.data;
}

function assertSha256HashValue(
  value: string,
  label: string
): `sha256:${string}` {
  const parsed = Sha256HashSchema.safeParse(value);
  if (!parsed.success) {
    throw new MerchantCampaignResolverError(`${label} must be a sha256 hash`);
  }
  return parsed.data;
}

function assertNonEmptyString(value: string, label: string): string {
  if (value.length === 0) {
    throw new MerchantCampaignResolverError(`${label} must be non-empty`);
  }
  return value;
}

function assertOperationSplit402IdValue(value: string, label: string): string {
  const parsed = Split402IdSchema.safeParse(value);
  if (!parsed.success) {
    throw new MerchantOperationDigestError(`${label} must be a Split402 id`);
  }
  return parsed.data;
}

function assertOperationNonEmptyString(value: string, label: string): string {
  if (value.length === 0) {
    throw new MerchantOperationDigestError(`${label} must be non-empty`);
  }
  return value;
}

function assertSplit402PaymentIdentifier(value: string): string {
  if (!isValidPaymentId(value)) {
    throw new MerchantPaymentIdentifierError(
      "payment identifier is not valid for x402"
    );
  }
  const parsed = Split402IdSchema.safeParse(value);
  if (!parsed.success || !parsed.data.startsWith("pay_")) {
    throw new MerchantPaymentIdentifierError(
      "payment identifier must be a Split402 pay_ id"
    );
  }
  return parsed.data;
}

function assertServiceKid(value: string): string {
  if (value.length === 0) {
    throw new MerchantServiceKeyRingError("service key kid must be non-empty");
  }
  return value;
}

function classifyHttpFailure(status: number): "retry" | "rejected" {
  return status === 408 ||
    status === 425 ||
    status === 429 ||
    status >= 500
    ? "retry"
    : "rejected";
}

function readOptionalStatus(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }
  const status = (body as Record<string, unknown>).status;
  return typeof status === "string" ? status : undefined;
}

function readSubmissionError(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }
  const record = body as Record<string, unknown>;
  if (typeof record.error === "string") {
    return record.error;
  }
  if (
    Array.isArray(record.errors) &&
    record.errors.every((item) => typeof item === "string")
  ) {
    return record.errors.join("; ");
  }
  return undefined;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new MerchantCampaignResolverError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function readRequiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new MerchantCampaignResolverError(`${label} must be a non-empty string`);
  }
  return value;
}

function readRequiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new MerchantCampaignResolverError(`${label} must be a boolean`);
  }
  return value;
}

function readPositiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || typeof value !== "number" || value <= 0) {
    throw new MerchantCampaignResolverError(`${label} must be a positive integer`);
  }
  return value;
}

function readBasisPoints(value: unknown, label: string): number {
  if (
    !Number.isInteger(value) ||
    typeof value !== "number" ||
    value < 0 ||
    value > 10_000
  ) {
    throw new MerchantCampaignResolverError(
      `${label} must be an integer from 0 to 10000`
    );
  }
  return value;
}

function readCampaignOperations(
  value: unknown,
  label: string
): MerchantCampaignOperation[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new MerchantCampaignResolverError(`${label} must be a non-empty array`);
  }
  return value.map((item, index) => {
    const operation = requireRecord(item, `${label}[${index}]`);
    return {
      operationId: readRequiredString(
        operation.operationId,
        `${label}[${index}].operationId`
      ),
      method: readRequiredString(operation.method, `${label}[${index}].method`),
      pathTemplate: readRequiredString(
        operation.pathTemplate,
        `${label}[${index}].pathTemplate`
      ),
      ...(operation.inputSchema === undefined
        ? {}
        : { inputSchema: operation.inputSchema })
    };
  });
}

function normalizeOperationRecord(
  value: Record<string, unknown> | undefined,
  label: string
): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }
  if (Array.isArray(value)) {
    throw new MerchantOperationDigestError(`${label} must be an object`);
  }
  for (const [key, item] of Object.entries(value)) {
    assertJsonCompatible(item, `${label}.${key}`);
  }
  return { ...value };
}

function assertJsonCompatible(value: unknown, label: string): void {
  assertJsonCompatibleInner(value, label, new Set<object>());
}

function assertJsonCompatibleInner(
  value: unknown,
  label: string,
  seen: Set<object>
): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new MerchantOperationDigestError(
        `${label} must be a finite JSON number`
      );
    }
    return;
  }
  if (typeof value !== "object") {
    throw new MerchantOperationDigestError(`${label} must be JSON-compatible`);
  }
  if (seen.has(value)) {
    throw new MerchantOperationDigestError(`${label} must not be circular`);
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertJsonCompatibleInner(item, `${label}[${index}]`, seen)
    );
    seen.delete(value);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    assertJsonCompatibleInner(item, `${label}.${key}`, seen);
  }
  seen.delete(value);
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
