import {
  AtomicAmountStringSchema,
  Base58PublicKeySchema,
  Rfc3339UtcSchema,
  Split402IdSchema,
  buildDomainSeparatedSigningBytes,
  bytesToHex,
  createPrefixedId,
  hashProtocolObject,
  verifyEd25519Signature
} from "@split402/protocol";

export type CampaignStatus = "draft" | "active" | "paused" | "closed";
export type CampaignCommissionBase = "required_amount";
export type CampaignSettlementMode = "accrual";

export interface CampaignOperation {
  operationId: string;
  method: string;
  pathTemplate: string;
  inputSchema?: unknown;
}

export interface CampaignTerms {
  protocolVersion: "0.1";
  campaignId: string;
  campaignVersion: number;
  merchantId: string;
  resourceOrigin: string;
  operations: CampaignOperation[];
  network: string;
  asset: string;
  requiredAmountAtomic: string;
  payToWallet: string;
  commissionBps: number;
  protocolFeeBpsOfCommission: number;
  commissionBase: CampaignCommissionBase;
  settlementMode: CampaignSettlementMode;
  attributionRequired: boolean;
  allowSelfReferral: boolean;
  payoutThresholdAtomic: string;
  startsAt: string;
  endsAt: string | null;
}

export interface CampaignVersionRecord {
  campaignId: string;
  version: number;
  terms: CampaignTerms;
  termsHash: `sha256:${string}`;
  signingBytesHex: string;
  merchantKid?: string;
  merchantSignature?: string;
  activatedAt?: string;
  createdAt: string;
}

export interface CampaignRecord {
  id: string;
  merchantId: string;
  resourceOrigin: string;
  status: CampaignStatus;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignProfile extends CampaignRecord {
  current: CampaignVersionRecord;
}

export interface CampaignTermsInput {
  resourceOrigin: string;
  operations: CampaignOperation[];
  network: string;
  asset: string;
  requiredAmountAtomic: string;
  payToWallet: string;
  commissionBps: number;
  protocolFeeBpsOfCommission?: number;
  /** @deprecated Use protocolFeeBpsOfCommission. */
  protocolFeeBps?: number;
  commissionBase?: CampaignCommissionBase;
  attributionRequired?: boolean;
  allowSelfReferral?: boolean;
  payoutThresholdAtomic: string;
  startsAt: string;
  endsAt?: string | null;
}

export interface CreateCampaignInput extends CampaignTermsInput {
  id?: string;
  merchantId: string;
}

export interface CreateCampaignVersionInput extends CampaignTermsInput {
  campaignId: string;
}

export interface ActivateCampaignVersionInput {
  campaignId: string;
  version?: number;
  merchantKid: string;
  merchantPublicKey: string;
  merchantSignature: string;
}

export interface ListMerchantCampaignsInput {
  merchantId: string;
  status?: CampaignStatus;
  limit?: number;
}

export interface CampaignRegistry {
  createCampaign(input: CreateCampaignInput): Promise<CampaignProfile> | CampaignProfile;
  getCampaign(campaignId: string): Promise<CampaignProfile | undefined> | CampaignProfile | undefined;
  listMerchantCampaigns(
    input: ListMerchantCampaignsInput
  ): Promise<CampaignProfile[]> | CampaignProfile[];
  getCampaignVersion(
    campaignId: string,
    version: number
  ): Promise<CampaignVersionRecord | undefined> | CampaignVersionRecord | undefined;
  createCampaignVersion(
    input: CreateCampaignVersionInput
  ): Promise<CampaignVersionRecord> | CampaignVersionRecord;
  activateCampaignVersion(
    input: ActivateCampaignVersionInput
  ): Promise<CampaignProfile> | CampaignProfile;
}

export interface InMemoryCampaignRegistryOptions {
  now?: () => Date;
  campaignIdFactory?: () => string;
}

export class CampaignRegistryValidationError extends Error {
  readonly code = "campaign_registry_validation_error";

  constructor(message: string) {
    super(message);
    this.name = "CampaignRegistryValidationError";
  }
}

export class CampaignRegistryConflictError extends Error {
  readonly code = "campaign_registry_conflict";

  constructor(message: string) {
    super(message);
    this.name = "CampaignRegistryConflictError";
  }
}

export class InMemoryCampaignRegistry implements CampaignRegistry {
  private readonly campaigns = new Map<string, CampaignRecord>();
  private readonly versionsByCampaignId = new Map<
    string,
    Map<number, CampaignVersionRecord>
  >();

  constructor(private readonly options: InMemoryCampaignRegistryOptions = {}) {}

  createCampaign(input: CreateCampaignInput): CampaignProfile {
    const now = this.now();
    const campaignId = assertSplit402Id(
      input.id ?? this.options.campaignIdFactory?.() ?? createPrefixedId("cmp"),
      "campaign id"
    );
    if (this.campaigns.has(campaignId)) {
      throw new CampaignRegistryConflictError(`campaign already exists: ${campaignId}`);
    }

    const campaign: CampaignRecord = {
      id: campaignId,
      merchantId: assertSplit402Id(input.merchantId, "merchant id"),
      resourceOrigin: assertUrlOrigin(input.resourceOrigin),
      status: "draft",
      currentVersion: 1,
      createdAt: now,
      updatedAt: now
    };
    const version = createCampaignVersionRecord(campaign, 1, input, now);

    this.campaigns.set(campaign.id, campaign);
    this.versionsByCampaignId.set(campaign.id, new Map([[1, version]]));

    return { ...cloneCampaign(campaign), current: cloneCampaignVersion(version) };
  }

  getCampaign(campaignId: string): CampaignProfile | undefined {
    const campaign = this.campaigns.get(campaignId);
    if (campaign === undefined) {
      return undefined;
    }
    const current = this.versionsByCampaignId
      .get(campaign.id)
      ?.get(campaign.currentVersion);
    if (current === undefined) {
      throw new Error(`missing current campaign version: ${campaign.id}`);
    }
    return {
      ...cloneCampaign(campaign),
      current: cloneCampaignVersion(current)
    };
  }

  listMerchantCampaigns(input: ListMerchantCampaignsInput): CampaignProfile[] {
    const merchantId = assertSplit402Id(input.merchantId, "merchant id");
    const status =
      input.status === undefined ? undefined : assertCampaignStatus(input.status);
    const limit = assertListLimit(input.limit ?? 100);
    return Array.from(this.campaigns.values())
      .filter((campaign) => campaign.merchantId === merchantId)
      .filter((campaign) => status === undefined || campaign.status === status)
      .sort(compareCampaignsNewestFirst)
      .slice(0, limit)
      .map((campaign) => {
        const current = this.versionsByCampaignId
          .get(campaign.id)
          ?.get(campaign.currentVersion);
        if (current === undefined) {
          throw new Error(`missing current campaign version: ${campaign.id}`);
        }
        return {
          ...cloneCampaign(campaign),
          current: cloneCampaignVersion(current)
        };
      });
  }

  getCampaignVersion(
    campaignId: string,
    version: number
  ): CampaignVersionRecord | undefined {
    assertPositiveVersion(version);
    const campaignVersion = this.versionsByCampaignId.get(campaignId)?.get(version);
    return campaignVersion === undefined
      ? undefined
      : cloneCampaignVersion(campaignVersion);
  }

  createCampaignVersion(input: CreateCampaignVersionInput): CampaignVersionRecord {
    const campaign = this.campaigns.get(input.campaignId);
    if (campaign === undefined) {
      throw new CampaignRegistryValidationError(`unknown campaign: ${input.campaignId}`);
    }
    if (campaign.status === "closed") {
      throw new CampaignRegistryValidationError("closed campaigns cannot be versioned");
    }

    const now = this.now();
    const nextVersion = campaign.currentVersion + 1;
    const version = createCampaignVersionRecord(campaign, nextVersion, input, now);
    const versions =
      this.versionsByCampaignId.get(campaign.id) ??
      new Map<number, CampaignVersionRecord>();
    if (Array.from(versions.values()).some((item) => item.termsHash === version.termsHash)) {
      throw new CampaignRegistryConflictError("campaign terms already exist");
    }

    versions.set(nextVersion, version);
    this.versionsByCampaignId.set(campaign.id, versions);
    this.campaigns.set(campaign.id, {
      ...campaign,
      resourceOrigin: version.terms.resourceOrigin,
      status: "draft",
      currentVersion: nextVersion,
      updatedAt: now
    });

    return cloneCampaignVersion(version);
  }

  activateCampaignVersion(input: ActivateCampaignVersionInput): CampaignProfile {
    const campaign = this.campaigns.get(input.campaignId);
    if (campaign === undefined) {
      throw new CampaignRegistryValidationError(`unknown campaign: ${input.campaignId}`);
    }
    if (campaign.status === "closed") {
      throw new CampaignRegistryValidationError("closed campaigns cannot be activated");
    }

    const versionNumber = assertPositiveVersion(input.version ?? campaign.currentVersion);
    if (versionNumber !== campaign.currentVersion) {
      throw new CampaignRegistryValidationError(
        "only the current campaign version can be activated"
      );
    }

    const versions = this.versionsByCampaignId.get(campaign.id);
    const version = versions?.get(versionNumber);
    if (version === undefined || versions === undefined) {
      throw new CampaignRegistryValidationError(
        `unknown campaign version: ${input.campaignId}:${versionNumber}`
      );
    }

    const merchantKid = assertNonEmptyString(input.merchantKid, "merchantKid");
    const merchantPublicKey = assertBase58PublicKey(
      input.merchantPublicKey,
      "merchantPublicKey"
    );
    const merchantSignature = assertNonEmptyString(
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
        return {
          ...cloneCampaign(campaign),
          current: cloneCampaignVersion(version)
        };
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
    versions.set(versionNumber, activatedVersion);
    this.campaigns.set(campaign.id, activatedCampaign);

    return {
      ...cloneCampaign(activatedCampaign),
      current: cloneCampaignVersion(activatedVersion)
    };
  }

  private now(): string {
    return (this.options.now?.() ?? new Date()).toISOString();
  }
}

export function isCampaignRegistryValidationError(
  error: unknown
): error is CampaignRegistryValidationError {
  return error instanceof CampaignRegistryValidationError;
}

export function isCampaignRegistryConflictError(
  error: unknown
): error is CampaignRegistryConflictError {
  return error instanceof CampaignRegistryConflictError;
}

export function buildCampaignTermsSigningBytes(terms: CampaignTerms): Uint8Array {
  return buildDomainSeparatedSigningBytes("split402:campaign-terms:v1", terms);
}

export function verifyCampaignTermsSignature(
  terms: CampaignTerms,
  merchantPublicKey: string,
  merchantSignature: string
): boolean {
  try {
    return verifyEd25519Signature(
      buildCampaignTermsSigningBytes(terms),
      merchantPublicKey,
      merchantSignature
    );
  } catch {
    return false;
  }
}

export function createCampaignVersionRecord(
  campaign: Pick<CampaignRecord, "id" | "merchantId">,
  version: number,
  input: CampaignTermsInput,
  createdAt: string
): CampaignVersionRecord {
  assertPositiveVersion(version);
  const terms: CampaignTerms = {
    protocolVersion: "0.1",
    campaignId: campaign.id,
    campaignVersion: version,
    merchantId: campaign.merchantId,
    resourceOrigin: assertUrlOrigin(input.resourceOrigin),
    operations: assertCampaignOperations(input.operations),
    network: assertNonEmptyString(input.network, "network"),
    asset: assertBase58PublicKey(input.asset, "asset"),
    requiredAmountAtomic: assertAtomicAmount(
      input.requiredAmountAtomic,
      "requiredAmountAtomic"
    ),
    payToWallet: assertBase58PublicKey(input.payToWallet, "payToWallet"),
    commissionBps: assertBasisPoints(input.commissionBps, "commissionBps"),
    protocolFeeBpsOfCommission: readProtocolFeeBpsOfCommission(input),
    commissionBase: input.commissionBase ?? "required_amount",
    settlementMode: "accrual",
    attributionRequired: input.attributionRequired ?? false,
    allowSelfReferral: input.allowSelfReferral ?? false,
    payoutThresholdAtomic: assertAtomicAmount(
      input.payoutThresholdAtomic,
      "payoutThresholdAtomic"
    ),
    startsAt: assertUtcTimestamp(input.startsAt, "startsAt"),
    endsAt: input.endsAt === undefined ? null : assertNullableUtcTimestamp(input.endsAt)
  };
  assertCommissionBase(terms.commissionBase);
  assertChronologicalRange(terms.startsAt, terms.endsAt);

  return {
    campaignId: campaign.id,
    version,
    terms,
    termsHash: hashProtocolObject(terms),
    signingBytesHex: bytesToHex(buildCampaignTermsSigningBytes(terms)),
    createdAt
  };
}

function assertCampaignOperations(
  operations: readonly CampaignOperation[]
): CampaignOperation[] {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new CampaignRegistryValidationError("operations must be a non-empty array");
  }
  const seenOperationIds = new Set<string>();
  return operations.map((operation) => {
    const operationId = assertNonEmptyString(operation.operationId, "operationId");
    if (seenOperationIds.has(operationId)) {
      throw new CampaignRegistryValidationError("operationId values must be unique");
    }
    seenOperationIds.add(operationId);
    return {
      operationId,
      method: assertHttpMethod(operation.method),
      pathTemplate: assertPathTemplate(operation.pathTemplate),
      ...(operation.inputSchema === undefined ? {} : { inputSchema: operation.inputSchema })
    };
  });
}

function readProtocolFeeBpsOfCommission(input: CampaignTermsInput): number {
  const canonical =
    input.protocolFeeBpsOfCommission === undefined
      ? undefined
      : assertBasisPoints(
          input.protocolFeeBpsOfCommission,
          "protocolFeeBpsOfCommission"
        );
  const deprecated =
    input.protocolFeeBps === undefined
      ? undefined
      : assertBasisPoints(input.protocolFeeBps, "protocolFeeBps");
  if (
    canonical !== undefined &&
    deprecated !== undefined &&
    canonical !== deprecated
  ) {
    throw new CampaignRegistryValidationError(
      "protocolFeeBps and protocolFeeBpsOfCommission must match when both are provided"
    );
  }
  return canonical ?? deprecated ?? 0;
}

function assertSplit402Id(value: string, label: string): string {
  if (!Split402IdSchema.safeParse(value).success) {
    throw new CampaignRegistryValidationError(`${label} must be a Split402 id`);
  }
  return value;
}

function assertBase58PublicKey(value: string, label: string): string {
  if (!Base58PublicKeySchema.safeParse(value).success) {
    throw new CampaignRegistryValidationError(`${label} must be a base58 public key`);
  }
  return value;
}

function assertAtomicAmount(value: string, label: string): string {
  if (!AtomicAmountStringSchema.safeParse(value).success) {
    throw new CampaignRegistryValidationError(`${label} must be an atomic amount`);
  }
  return value;
}

function assertUtcTimestamp(value: string, label: string): string {
  if (!Rfc3339UtcSchema.safeParse(value).success) {
    throw new CampaignRegistryValidationError(`${label} must be UTC RFC3339`);
  }
  return value;
}

function assertNullableUtcTimestamp(value: string | null): string | null {
  return value === null ? null : assertUtcTimestamp(value, "endsAt");
}

function assertChronologicalRange(startsAt: string, endsAt: string | null): void {
  if (endsAt !== null && Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new CampaignRegistryValidationError("endsAt must be after startsAt");
  }
}

function assertBasisPoints(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new CampaignRegistryValidationError(`${label} must be 0-10000`);
  }
  return value;
}

function assertCommissionBase(value: CampaignCommissionBase): void {
  if (value !== "required_amount") {
    throw new CampaignRegistryValidationError(
      "commissionBase must be required_amount"
    );
  }
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

function assertListLimit(value: number): number {
  if (!Number.isInteger(value) || value <= 0 || value > 100) {
    throw new CampaignRegistryValidationError("limit must be an integer from 1 to 100");
  }
  return value;
}

function assertPositiveVersion(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new CampaignRegistryValidationError("version must be a positive integer");
  }
  return value;
}

function assertNonEmptyString(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CampaignRegistryValidationError(`${label} must be a non-empty string`);
  }
  return value;
}

function assertHttpMethod(value: string): string {
  const method = assertNonEmptyString(value, "method").toUpperCase();
  if (!/^[A-Z]+$/u.test(method)) {
    throw new CampaignRegistryValidationError("method must be an HTTP method");
  }
  return method;
}

function assertPathTemplate(value: string): string {
  if (!value.startsWith("/")) {
    throw new CampaignRegistryValidationError("pathTemplate must start with /");
  }
  return assertNonEmptyString(value, "pathTemplate");
}

function assertUrlOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (url.origin !== value || !["http:", "https:"].includes(url.protocol)) {
      throw new Error("invalid origin");
    }
    return value;
  } catch {
    throw new CampaignRegistryValidationError("resourceOrigin must be an http(s) URL origin");
  }
}

function compareCampaignsNewestFirst(
  left: CampaignRecord,
  right: CampaignRecord
): number {
  return (
    right.createdAt.localeCompare(left.createdAt) ||
    right.id.localeCompare(left.id)
  );
}

function cloneCampaign(campaign: CampaignRecord): CampaignRecord {
  return { ...campaign };
}

function cloneCampaignVersion(version: CampaignVersionRecord): CampaignVersionRecord {
  return {
    ...version,
    terms: {
      ...version.terms,
      operations: version.terms.operations.map((operation) => ({ ...operation }))
    }
  };
}
