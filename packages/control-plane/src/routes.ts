import {
  Base58PublicKeySchema,
  ReferralClaimV1Schema,
  Rfc3339UtcSchema,
  Sha256HashSchema,
  Split402IdSchema,
  buildReferralClaimSigningBytes,
  bytesToHex,
  createPrefixedId,
  hashProtocolObject,
  verifyReferralClaimObject,
  type ReferralClaimV1
} from "@split402/protocol";

export type RouteStatus = "active" | "suspended" | "expired" | "revoked";
export type RouteOperationScope = ["*"] | string[];
export type UnsignedReferralClaim = Omit<ReferralClaimV1, "signature">;

export interface CreateRouteDraftInput {
  id?: string;
  campaignId: string;
  campaignVersionMin: number;
  referrerWallet: string;
  payoutWallet: string;
  resourceOrigin: string;
  operationIds: RouteOperationScope;
  issuedAt?: string;
  expiresAt: string;
  nonce?: string;
  metadataHash?: `sha256:${string}`;
}

export interface RouteDraft {
  routeId: string;
  claim: UnsignedReferralClaim;
  signingBytesHex: string;
  unsignedClaimHash: `sha256:${string}`;
}

export interface ActivateRouteInput {
  claim: ReferralClaimV1;
}

export interface SuspendRouteInput {
  routeId: string;
}

export interface RouteRecord {
  id: string;
  campaignId: string;
  campaignVersionMin: number;
  referrerWallet: string;
  payoutWallet: string;
  resourceOrigin: string;
  operationIds: RouteOperationScope;
  claimHash: `sha256:${string}`;
  claim: ReferralClaimV1;
  signingBytesHex: string;
  status: RouteStatus;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
  metadataHash?: `sha256:${string}`;
  createdAt: string;
  activatedAt: string;
}

export interface RouteRegistry {
  createRouteDraft(input: CreateRouteDraftInput): Promise<RouteDraft> | RouteDraft;
  activateRoute(input: ActivateRouteInput): Promise<RouteRecord> | RouteRecord;
  getRoute(routeId: string): Promise<RouteRecord | undefined> | RouteRecord | undefined;
  suspendRoute(input: SuspendRouteInput): Promise<RouteRecord | undefined> | RouteRecord | undefined;
}

export interface InMemoryRouteRegistryOptions {
  now?: () => Date;
  routeIdFactory?: () => string;
  nonceFactory?: () => string;
}

export class RouteRegistryValidationError extends Error {
  readonly code = "route_registry_validation_error";

  constructor(message: string) {
    super(message);
    this.name = "RouteRegistryValidationError";
  }
}

export class RouteRegistryConflictError extends Error {
  readonly code = "route_registry_conflict";

  constructor(message: string) {
    super(message);
    this.name = "RouteRegistryConflictError";
  }
}

export class InMemoryRouteRegistry implements RouteRegistry {
  private readonly routesById = new Map<string, RouteRecord>();
  private readonly routeIdByClaimHash = new Map<`sha256:${string}`, string>();

  constructor(private readonly options: InMemoryRouteRegistryOptions = {}) {}

  createRouteDraft(input: CreateRouteDraftInput): RouteDraft {
    const issuedAt = assertUtcTimestamp(input.issuedAt ?? this.now(), "issuedAt");
    const expiresAt = assertUtcTimestamp(input.expiresAt, "expiresAt");
    assertChronologicalRange(issuedAt, expiresAt);
    const claim: UnsignedReferralClaim = {
      version: "1",
      routeId: assertSplit402Id(
        input.id ?? this.options.routeIdFactory?.() ?? createPrefixedId("rte"),
        "route id"
      ),
      campaignId: assertSplit402Id(input.campaignId, "campaign id"),
      campaignVersionMin: assertPositiveInteger(
        input.campaignVersionMin,
        "campaignVersionMin"
      ),
      referrerWallet: assertBase58PublicKey(
        input.referrerWallet,
        "referrerWallet"
      ),
      payoutWallet: assertBase58PublicKey(input.payoutWallet, "payoutWallet"),
      resourceOrigin: assertUrlOrigin(input.resourceOrigin),
      operationIds: assertOperationScope(input.operationIds),
      issuedAt,
      expiresAt,
      nonce: assertNonce(
        input.nonce ?? this.options.nonceFactory?.() ?? createRouteNonce()
      ),
      ...(input.metadataHash === undefined
        ? {}
        : { metadataHash: assertSha256Hash(input.metadataHash, "metadataHash") })
    };

    return {
      routeId: claim.routeId,
      claim,
      signingBytesHex: bytesToHex(buildReferralClaimSigningBytes(claim)),
      unsignedClaimHash: hashProtocolObject(claim)
    };
  }

  activateRoute(input: ActivateRouteInput): RouteRecord {
    const parsed = ReferralClaimV1Schema.safeParse(input.claim);
    if (!parsed.success) {
      throw new RouteRegistryValidationError(
        parsed.error.issues.map((issue) => issue.message).join("; ")
      );
    }
    const claim = parsed.data;
    const signatureVerification = verifyReferralClaimObject(claim);
    if (!signatureVerification.ok) {
      throw new RouteRegistryValidationError(
        signatureVerification.errors.join("; ")
      );
    }
    assertChronologicalRange(claim.issuedAt, claim.expiresAt);
    if (Date.parse(claim.expiresAt) <= Date.parse(this.now())) {
      throw new RouteRegistryValidationError("route claim is expired");
    }

    const claimHash = hashProtocolObject(claim);
    const duplicateRouteId = this.routeIdByClaimHash.get(claimHash);
    if (duplicateRouteId !== undefined) {
      const existing = this.routesById.get(duplicateRouteId);
      if (existing !== undefined) {
        return cloneRoute(existing);
      }
    }

    const existingById = this.routesById.get(claim.routeId);
    if (existingById !== undefined) {
      throw new RouteRegistryConflictError(
        `route already exists: ${claim.routeId}`
      );
    }

    const now = this.now();
    const route: RouteRecord = {
      id: claim.routeId,
      campaignId: claim.campaignId,
      campaignVersionMin: claim.campaignVersionMin,
      referrerWallet: claim.referrerWallet,
      payoutWallet: claim.payoutWallet,
      resourceOrigin: claim.resourceOrigin,
      operationIds: cloneOperationScope(claim.operationIds),
      claimHash,
      claim: cloneClaim(claim),
      signingBytesHex: bytesToHex(buildReferralClaimSigningBytes(claim)),
      status: "active",
      issuedAt: claim.issuedAt,
      expiresAt: claim.expiresAt,
      nonce: claim.nonce,
      ...(claim.metadataHash === undefined
        ? {}
        : { metadataHash: claim.metadataHash }),
      createdAt: now,
      activatedAt: now
    };
    this.routesById.set(route.id, route);
    this.routeIdByClaimHash.set(route.claimHash, route.id);
    return cloneRoute(route);
  }

  getRoute(routeId: string): RouteRecord | undefined {
    const route = this.routesById.get(routeId);
    return route === undefined ? undefined : cloneRoute(route);
  }

  suspendRoute(input: SuspendRouteInput): RouteRecord | undefined {
    const route = this.routesById.get(assertSplit402Id(input.routeId, "route id"));
    if (route === undefined) {
      return undefined;
    }
    if (route.status === "suspended") {
      return cloneRoute(route);
    }
    if (route.status !== "active") {
      throw new RouteRegistryValidationError(
        `route must be active to suspend; current status is ${route.status}`
      );
    }
    const suspended: RouteRecord = {
      ...route,
      status: "suspended"
    };
    this.routesById.set(suspended.id, suspended);
    return cloneRoute(suspended);
  }

  private now(): string {
    return (this.options.now?.() ?? new Date()).toISOString();
  }
}

export function isRouteRegistryValidationError(
  error: unknown
): error is RouteRegistryValidationError {
  return error instanceof RouteRegistryValidationError;
}

export function isRouteRegistryConflictError(
  error: unknown
): error is RouteRegistryConflictError {
  return error instanceof RouteRegistryConflictError;
}

function createRouteNonce(): string {
  return `route-${createPrefixedId("rte").slice(4)}`;
}

function assertSplit402Id(value: string, label: string): string {
  if (!Split402IdSchema.safeParse(value).success) {
    throw new RouteRegistryValidationError(`${label} must be a Split402 id`);
  }
  return value;
}

function assertBase58PublicKey(value: string, label: string): string {
  if (!Base58PublicKeySchema.safeParse(value).success) {
    throw new RouteRegistryValidationError(`${label} must be a base58 public key`);
  }
  return value;
}

function assertSha256Hash(value: string, label: string): `sha256:${string}` {
  const parsed = Sha256HashSchema.safeParse(value);
  if (!parsed.success) {
    throw new RouteRegistryValidationError(`${label} must be a sha256 hash`);
  }
  return parsed.data;
}

function assertUtcTimestamp(value: string, label: string): string {
  if (!Rfc3339UtcSchema.safeParse(value).success) {
    throw new RouteRegistryValidationError(`${label} must be UTC RFC3339`);
  }
  return value;
}

function assertPositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RouteRegistryValidationError(`${label} must be a positive integer`);
  }
  return value;
}

function assertNonce(value: string): string {
  if (typeof value !== "string" || value.length < 16 || value.length > 128) {
    throw new RouteRegistryValidationError("nonce must be 16-128 characters");
  }
  return value;
}

function assertOperationScope(value: RouteOperationScope): RouteOperationScope {
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

  const seen = new Set<string>();
  const operationIds = value.map((operationId) => {
    if (typeof operationId !== "string" || operationId.trim().length === 0) {
      throw new RouteRegistryValidationError(
        "operationIds entries must be non-empty strings"
      );
    }
    if (seen.has(operationId)) {
      throw new RouteRegistryValidationError("operationIds entries must be unique");
    }
    seen.add(operationId);
    return operationId;
  });
  return operationIds;
}

function assertUrlOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (url.origin !== value || !["http:", "https:"].includes(url.protocol)) {
      throw new Error("invalid origin");
    }
    return value;
  } catch {
    throw new RouteRegistryValidationError(
      "resourceOrigin must be an http(s) URL origin"
    );
  }
}

function assertChronologicalRange(issuedAt: string, expiresAt: string): void {
  if (Date.parse(expiresAt) <= Date.parse(issuedAt)) {
    throw new RouteRegistryValidationError("expiresAt must be after issuedAt");
  }
}

function cloneRoute(route: RouteRecord): RouteRecord {
  return {
    ...route,
    operationIds: cloneOperationScope(route.operationIds),
    claim: cloneClaim(route.claim)
  };
}

function cloneClaim(claim: ReferralClaimV1): ReferralClaimV1 {
  return {
    ...claim,
    operationIds: cloneOperationScope(claim.operationIds),
    signature: { ...claim.signature }
  };
}

function cloneOperationScope(scope: RouteOperationScope): RouteOperationScope {
  return scope[0] === "*" ? ["*"] : [...scope];
}
