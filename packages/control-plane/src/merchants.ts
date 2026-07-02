import {
  Base58PublicKeySchema,
  Split402IdSchema,
  createPrefixedId,
  type Split402ReceiptV1
} from "@split402/protocol";
import { randomBytes } from "node:crypto";

import type { ReceiptIngestorOptions } from "./index.js";

export type MerchantStatus = "pending" | "active" | "suspended" | "closed";
export type MerchantOriginVerificationMethod = "well_known" | "dns";
export type MerchantOriginStatus = "pending" | "verified" | "failed" | "revoked";
export type MerchantKeyAlgorithm = "Ed25519" | "ES256";
export type MerchantKeyPurpose = "offer_receipt" | "webhook";
export type MerchantPayoutWalletStatus = "active" | "paused" | "retired";

export interface MerchantRecord {
  id: string;
  slug: string;
  displayName: string;
  ownerWallet: string;
  status: MerchantStatus;
  createdAt: string;
  updatedAt: string;
}

export interface MerchantOriginRecord {
  merchantId: string;
  origin: string;
  verificationMethod: MerchantOriginVerificationMethod;
  status: MerchantOriginStatus;
  verifiedAt?: string;
  createdAt: string;
}

export interface MerchantKeyRecord {
  merchantId: string;
  kid: string;
  algorithm: MerchantKeyAlgorithm;
  publicKey: string;
  purpose: MerchantKeyPurpose;
  validFrom: string;
  validUntil?: string;
  revokedAt?: string;
  revocationReason?: string;
  createdAt: string;
}

export interface MerchantPayoutWalletRecord {
  id: string;
  merchantId: string;
  network: string;
  wallet: string;
  asset: string;
  signerReference: string;
  status: MerchantPayoutWalletStatus;
  createdAt: string;
}

export interface MerchantProfile extends MerchantRecord {
  origins: MerchantOriginRecord[];
  keys: MerchantKeyRecord[];
  payoutWallets: MerchantPayoutWalletRecord[];
}

export interface CreateMerchantInput {
  id?: string;
  slug: string;
  displayName: string;
  ownerWallet: string;
  status?: MerchantStatus;
}

export interface AddMerchantOriginInput {
  merchantId: string;
  origin: string;
  verificationMethod?: MerchantOriginVerificationMethod;
  status?: MerchantOriginStatus;
  verifiedAt?: string;
}

export interface AddMerchantKeyInput {
  merchantId: string;
  kid: string;
  publicKey: string;
  algorithm?: MerchantKeyAlgorithm;
  purpose?: MerchantKeyPurpose;
  validFrom?: string;
  validUntil?: string;
}

export interface AddMerchantPayoutWalletInput {
  id?: string;
  merchantId: string;
  network: string;
  wallet: string;
  asset: string;
  signerReference: string;
  status?: MerchantPayoutWalletStatus;
}

export interface RevokeMerchantKeyInput {
  merchantId: string;
  kid: string;
  revokedAt?: string;
  reason?: string;
}

export type MerchantStatusTransition = Exclude<MerchantStatus, "pending">;
export type MerchantOriginStatusTransition = Exclude<
  MerchantOriginStatus,
  "pending"
>;

export interface UpdateMerchantStatusInput {
  merchantId: string;
  status: MerchantStatusTransition;
}

export interface UpdateMerchantOriginStatusInput {
  merchantId: string;
  origin: string;
  status: MerchantOriginStatusTransition;
  verifiedAt?: string;
}

export interface UpdateMerchantPayoutWalletStatusInput {
  merchantId: string;
  payoutWalletId: string;
  status: MerchantPayoutWalletStatus;
}

export interface ResolveMerchantKeyInput {
  merchantId: string;
  kid: string;
  purpose?: MerchantKeyPurpose;
  at?: string;
}

export interface MerchantRegistry {
  createMerchant(input: CreateMerchantInput): Promise<MerchantRecord> | MerchantRecord;
  getMerchantProfile(
    merchantId: string
  ): Promise<MerchantProfile | undefined> | MerchantProfile | undefined;
  addOrigin(
    input: AddMerchantOriginInput
  ): Promise<MerchantOriginRecord> | MerchantOriginRecord;
  addKey(input: AddMerchantKeyInput): Promise<MerchantKeyRecord> | MerchantKeyRecord;
  addPayoutWallet(
    input: AddMerchantPayoutWalletInput
  ): Promise<MerchantPayoutWalletRecord> | MerchantPayoutWalletRecord;
  revokeKey(
    input: RevokeMerchantKeyInput
  ): Promise<MerchantKeyRecord | undefined> | MerchantKeyRecord | undefined;
  resolveKey(
    input: ResolveMerchantKeyInput
  ): Promise<MerchantKeyRecord | undefined> | MerchantKeyRecord | undefined;
  updateMerchantStatus(
    input: UpdateMerchantStatusInput
  ): Promise<MerchantRecord | undefined> | MerchantRecord | undefined;
  updateOriginStatus(
    input: UpdateMerchantOriginStatusInput
  ): Promise<MerchantOriginRecord | undefined> | MerchantOriginRecord | undefined;
  updatePayoutWalletStatus(
    input: UpdateMerchantPayoutWalletStatusInput
  ):
    | Promise<MerchantPayoutWalletRecord | undefined>
    | MerchantPayoutWalletRecord
    | undefined;
}

export interface InMemoryMerchantRegistryOptions {
  now?: () => Date;
  merchantIdFactory?: () => string;
  merchantPayoutWalletIdFactory?: () => string;
}

export class MerchantRegistryValidationError extends Error {
  readonly code = "merchant_registry_validation_error";

  constructor(message: string) {
    super(message);
    this.name = "MerchantRegistryValidationError";
  }
}

export class MerchantRegistryConflictError extends Error {
  readonly code = "merchant_registry_conflict";

  constructor(message: string) {
    super(message);
    this.name = "MerchantRegistryConflictError";
  }
}

export class InMemoryMerchantRegistry implements MerchantRegistry {
  private readonly merchants = new Map<string, MerchantRecord>();
  private readonly merchantIdBySlug = new Map<string, string>();
  private readonly originsByMerchantId = new Map<string, Map<string, MerchantOriginRecord>>();
  private readonly keysByKid = new Map<string, MerchantKeyRecord>();
  private readonly payoutWalletsById = new Map<string, MerchantPayoutWalletRecord>();

  constructor(private readonly options: InMemoryMerchantRegistryOptions = {}) {}

  createMerchant(input: CreateMerchantInput): MerchantRecord {
    const now = this.now();
    const merchant: MerchantRecord = {
      id: input.id ?? this.options.merchantIdFactory?.() ?? createPrefixedId("mrc"),
      slug: assertMerchantSlug(input.slug),
      displayName: assertNonEmptyString(input.displayName, "displayName"),
      ownerWallet: assertBase58PublicKey(input.ownerWallet, "ownerWallet"),
      status: input.status ?? "pending",
      createdAt: now,
      updatedAt: now
    };
    assertSplit402Id(merchant.id, "merchant id");
    assertMerchantStatus(merchant.status);

    if (this.merchants.has(merchant.id)) {
      throw new MerchantRegistryConflictError(`merchant already exists: ${merchant.id}`);
    }
    if (this.merchantIdBySlug.has(merchant.slug)) {
      throw new MerchantRegistryConflictError(`merchant slug already exists: ${merchant.slug}`);
    }

    this.merchants.set(merchant.id, merchant);
    this.merchantIdBySlug.set(merchant.slug, merchant.id);
    return cloneMerchant(merchant);
  }

  getMerchantProfile(merchantId: string): MerchantProfile | undefined {
    const merchant = this.merchants.get(merchantId);
    if (merchant === undefined) {
      return undefined;
    }

    return {
      ...cloneMerchant(merchant),
      origins: Array.from(this.originsByMerchantId.get(merchantId)?.values() ?? []).map(
        cloneOrigin
      ),
      keys: Array.from(this.keysByKid.values())
        .filter((key) => key.merchantId === merchantId)
        .map(cloneKey),
      payoutWallets: Array.from(this.payoutWalletsById.values())
        .filter((wallet) => wallet.merchantId === merchantId)
        .sort(comparePayoutWallets)
        .map(clonePayoutWallet)
    };
  }

  addOrigin(input: AddMerchantOriginInput): MerchantOriginRecord {
    this.assertMerchantExists(input.merchantId);
    const origin = assertUrlOrigin(input.origin);
    const originRecord: MerchantOriginRecord = {
      merchantId: input.merchantId,
      origin,
      verificationMethod: input.verificationMethod ?? "well_known",
      status: input.status ?? "pending",
      ...(input.verifiedAt === undefined ? {} : { verifiedAt: assertUtcTimestamp(input.verifiedAt) }),
      createdAt: this.now()
    };
    assertOriginVerificationMethod(originRecord.verificationMethod);
    assertMerchantOriginStatus(originRecord.status);

    const origins =
      this.originsByMerchantId.get(input.merchantId) ??
      new Map<string, MerchantOriginRecord>();
    if (origins.has(origin)) {
      throw new MerchantRegistryConflictError(`merchant origin already exists: ${origin}`);
    }

    origins.set(origin, originRecord);
    this.originsByMerchantId.set(input.merchantId, origins);
    return cloneOrigin(originRecord);
  }

  addKey(input: AddMerchantKeyInput): MerchantKeyRecord {
    this.assertMerchantExists(input.merchantId);
    const now = this.now();
    const key: MerchantKeyRecord = {
      merchantId: input.merchantId,
      kid: assertNonEmptyString(input.kid, "kid"),
      publicKey: assertBase58PublicKey(input.publicKey, "publicKey"),
      algorithm: input.algorithm ?? "Ed25519",
      purpose: input.purpose ?? "offer_receipt",
      validFrom: input.validFrom ?? now,
      ...(input.validUntil === undefined ? {} : { validUntil: assertUtcTimestamp(input.validUntil) }),
      createdAt: now
    };
    assertMerchantKeyAlgorithm(key.algorithm);
    assertMerchantKeyPurpose(key.purpose);
    assertUtcTimestamp(key.validFrom);
    assertChronologicalRange(key.validFrom, key.validUntil);

    if (this.keysByKid.has(key.kid)) {
      throw new MerchantRegistryConflictError(`merchant key already exists: ${key.kid}`);
    }

    this.keysByKid.set(key.kid, key);
    return cloneKey(key);
  }

  addPayoutWallet(
    input: AddMerchantPayoutWalletInput
  ): MerchantPayoutWalletRecord {
    this.assertMerchantExists(input.merchantId);
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

    if (this.payoutWalletsById.has(wallet.id)) {
      throw new MerchantRegistryConflictError(
        `merchant payout wallet already exists: ${wallet.id}`
      );
    }
    if (
      Array.from(this.payoutWalletsById.values()).some(
        (existing) =>
          existing.merchantId === wallet.merchantId &&
          existing.network === wallet.network &&
          existing.wallet === wallet.wallet &&
          existing.asset === wallet.asset
      )
    ) {
      throw new MerchantRegistryConflictError(
        "merchant payout wallet already exists for network, wallet, and asset"
      );
    }

    this.payoutWalletsById.set(wallet.id, wallet);
    return clonePayoutWallet(wallet);
  }

  revokeKey(input: RevokeMerchantKeyInput): MerchantKeyRecord | undefined {
    const existing = this.keysByKid.get(input.kid);
    if (existing === undefined || existing.merchantId !== input.merchantId) {
      return undefined;
    }

    const revokedAt = input.revokedAt ?? this.now();
    const revoked: MerchantKeyRecord = {
      ...existing,
      revokedAt,
      ...(input.reason === undefined
        ? {}
        : { revocationReason: assertNonEmptyString(input.reason, "reason") })
    };
    assertUtcTimestamp(revokedAt);
    this.keysByKid.set(input.kid, revoked);
    return cloneKey(revoked);
  }

  resolveKey(input: ResolveMerchantKeyInput): MerchantKeyRecord | undefined {
    const key = this.keysByKid.get(input.kid);
    if (key === undefined || key.merchantId !== input.merchantId) {
      return undefined;
    }
    if (key.purpose !== (input.purpose ?? "offer_receipt")) {
      return undefined;
    }
    if (!isKeyValidAt(key, input.at ?? this.now())) {
      return undefined;
    }

    return cloneKey(key);
  }

  updateMerchantStatus(
    input: UpdateMerchantStatusInput
  ): MerchantRecord | undefined {
    assertMerchantStatusTransition(input.status);
    const existing = this.merchants.get(input.merchantId);
    if (existing === undefined) {
      return undefined;
    }

    const updated: MerchantRecord = {
      ...existing,
      status: input.status,
      updatedAt: this.now()
    };
    this.merchants.set(updated.id, updated);
    return cloneMerchant(updated);
  }

  updateOriginStatus(
    input: UpdateMerchantOriginStatusInput
  ): MerchantOriginRecord | undefined {
    assertMerchantOriginStatusTransition(input.status);
    const origins = this.originsByMerchantId.get(input.merchantId);
    const existing = origins?.get(input.origin);
    if (origins === undefined || existing === undefined) {
      return undefined;
    }

    const verifiedAt = readOriginVerifiedAt(input, () => this.now());
    const updated: MerchantOriginRecord = {
      ...existing,
      status: input.status,
      ...(verifiedAt === undefined ? {} : { verifiedAt })
    };
    if (verifiedAt === undefined) {
      delete updated.verifiedAt;
    }
    origins.set(input.origin, updated);
    return cloneOrigin(updated);
  }

  updatePayoutWalletStatus(
    input: UpdateMerchantPayoutWalletStatusInput
  ): MerchantPayoutWalletRecord | undefined {
    assertMerchantPayoutWalletStatus(input.status);
    const existing = this.payoutWalletsById.get(input.payoutWalletId);
    if (existing === undefined || existing.merchantId !== input.merchantId) {
      return undefined;
    }
    assertPayoutWalletStatusTransition(existing.status, input.status);

    const updated: MerchantPayoutWalletRecord = {
      ...existing,
      status: input.status
    };
    this.payoutWalletsById.set(updated.id, updated);
    return clonePayoutWallet(updated);
  }

  private assertMerchantExists(merchantId: string): void {
    if (!this.merchants.has(merchantId)) {
      throw new MerchantRegistryValidationError(`unknown merchant: ${merchantId}`);
    }
  }

  private now(): string {
    return (this.options.now?.() ?? new Date()).toISOString();
  }
}

export function createMerchantReceiptKeyResolver(
  registry: MerchantRegistry
): ReceiptIngestorOptions["resolveMerchantPublicKey"] {
  return async (receipt: Split402ReceiptV1) => {
    const key = await registry.resolveKey({
      merchantId: receipt.merchantId,
      kid: receipt.kid,
      purpose: "offer_receipt",
      at: receipt.issuedAt
    });
    return key?.publicKey;
  };
}

export function isMerchantRegistryConflict(
  error: unknown
): error is MerchantRegistryConflictError {
  return error instanceof MerchantRegistryConflictError;
}

export function isMerchantRegistryValidationError(
  error: unknown
): error is MerchantRegistryValidationError {
  return error instanceof MerchantRegistryValidationError;
}

function isKeyValidAt(key: MerchantKeyRecord, at: string): boolean {
  const atTime = Date.parse(assertUtcTimestamp(at));
  if (Date.parse(key.validFrom) > atTime) {
    return false;
  }
  if (key.validUntil !== undefined && Date.parse(key.validUntil) <= atTime) {
    return false;
  }
  if (key.revokedAt !== undefined && Date.parse(key.revokedAt) <= atTime) {
    return false;
  }
  return true;
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
    throw new MerchantRegistryValidationError("slug must be 3-63 lowercase URL-safe characters");
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
  if (!["pending", "active", "suspended", "closed"].includes(value)) {
    throw new MerchantRegistryValidationError("invalid merchant status");
  }
}

function assertOriginVerificationMethod(
  value: MerchantOriginVerificationMethod
): void {
  if (!["well_known", "dns"].includes(value)) {
    throw new MerchantRegistryValidationError("invalid origin verification method");
  }
}

function assertMerchantOriginStatus(value: MerchantOriginStatus): void {
  if (!["pending", "verified", "failed", "revoked"].includes(value)) {
    throw new MerchantRegistryValidationError("invalid merchant origin status");
  }
}

export function assertMerchantStatusTransition(
  value: MerchantStatusTransition
): MerchantStatusTransition {
  if (!["active", "suspended", "closed"].includes(value)) {
    throw new MerchantRegistryValidationError(
      "merchant status transition must be active, suspended, or closed"
    );
  }
  return value;
}

export function assertMerchantOriginStatusTransition(
  value: MerchantOriginStatusTransition
): MerchantOriginStatusTransition {
  if (!["verified", "failed", "revoked"].includes(value)) {
    throw new MerchantRegistryValidationError(
      "origin status transition must be verified, failed, or revoked"
    );
  }
  return value;
}

export function assertPayoutWalletStatusTransition(
  current: MerchantPayoutWalletStatus,
  next: MerchantPayoutWalletStatus
): void {
  if (current === "retired" && next !== "retired") {
    throw new MerchantRegistryConflictError(
      "retired merchant payout wallets cannot be reactivated"
    );
  }
}

export function readOriginVerifiedAt(
  input: Pick<UpdateMerchantOriginStatusInput, "status" | "verifiedAt">,
  now: () => string
): string | undefined {
  if (input.status !== "verified") {
    return undefined;
  }
  return assertUtcTimestamp(input.verifiedAt ?? now());
}

function assertMerchantKeyAlgorithm(value: MerchantKeyAlgorithm): void {
  if (!["Ed25519", "ES256"].includes(value)) {
    throw new MerchantRegistryValidationError("invalid merchant key algorithm");
  }
}

function assertMerchantKeyPurpose(value: MerchantKeyPurpose): void {
  if (!["offer_receipt", "webhook"].includes(value)) {
    throw new MerchantRegistryValidationError("invalid merchant key purpose");
  }
}

function assertMerchantPayoutWalletStatus(value: MerchantPayoutWalletStatus): void {
  if (!["active", "paused", "retired"].includes(value)) {
    throw new MerchantRegistryValidationError("invalid merchant payout wallet status");
  }
}

function createMerchantPayoutWalletId(): string {
  return `mpw_${randomBytes(16).toString("hex")}`;
}

function comparePayoutWallets(
  left: MerchantPayoutWalletRecord,
  right: MerchantPayoutWalletRecord
): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function cloneMerchant(merchant: MerchantRecord): MerchantRecord {
  return { ...merchant };
}

function cloneOrigin(origin: MerchantOriginRecord): MerchantOriginRecord {
  return { ...origin };
}

function cloneKey(key: MerchantKeyRecord): MerchantKeyRecord {
  return { ...key };
}

function clonePayoutWallet(
  wallet: MerchantPayoutWalletRecord
): MerchantPayoutWalletRecord {
  return { ...wallet };
}
