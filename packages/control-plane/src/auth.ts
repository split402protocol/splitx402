import { Buffer } from "node:buffer";
import { createHash, randomBytes } from "node:crypto";

import {
  Base58PublicKeySchema,
  buildDomainSeparatedSigningBytes,
  verifyEd25519Signature
} from "@split402/protocol";

export type WalletAuthPurpose = "merchant-session";

export interface WalletAuthChallengePayload {
  challengeId: string;
  wallet: string;
  network: string;
  purpose: WalletAuthPurpose;
  nonce: string;
  expiresAt: string;
}

export interface WalletAuthChallengeRecord extends WalletAuthChallengePayload {
  message: string;
  createdAt: string;
  consumedAt?: string;
}

export interface AuthenticatedWalletSession {
  sessionId: string;
  wallet: string;
  network: string;
  purpose: WalletAuthPurpose;
  challengeId: string;
  issuedAt: string;
  expiresAt: string;
}

export interface WalletAuthRefreshTokenRecord {
  refreshTokenId: string;
  sessionId: string;
  wallet: string;
  network: string;
  purpose: WalletAuthPurpose;
  challengeId: string;
  issuedAt: string;
  expiresAt: string;
  revokedAt?: string;
  replacedBySessionId?: string;
}

export interface WalletAuthSessionResult extends AuthenticatedWalletSession {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  tokenType: "Bearer";
}

export interface CreateWalletAuthChallengeInput {
  wallet: string;
  network: string;
  purpose?: WalletAuthPurpose;
}

export interface CreateWalletAuthSessionInput {
  challengeId: string;
  signature: string;
  publicKey?: string;
}

export interface RevokeWalletAuthSessionInput {
  refreshToken: string;
}

export interface WalletAuthRevocationResult {
  revoked: true;
  alreadyRevoked: boolean;
  wallet: string;
}

export interface RefreshWalletAuthSessionInput {
  refreshToken: string;
}

export interface WalletAuthStore {
  saveChallenge(challenge: WalletAuthChallengeRecord): Promise<void> | void;
  getChallenge(
    challengeId: string
  ): Promise<WalletAuthChallengeRecord | undefined> | WalletAuthChallengeRecord | undefined;
  consumeChallenge(
    challengeId: string,
    consumedAt: string
  ): Promise<boolean> | boolean;
  saveSession(
    tokenHash: string,
    session: AuthenticatedWalletSession
  ): Promise<void> | void;
  getSession(
    tokenHash: string
  ): Promise<AuthenticatedWalletSession | undefined> | AuthenticatedWalletSession | undefined;
  saveRefreshToken(
    tokenHash: string,
    refreshToken: WalletAuthRefreshTokenRecord
  ): Promise<void> | void;
  getRefreshToken(
    tokenHash: string
  ): Promise<WalletAuthRefreshTokenRecord | undefined> | WalletAuthRefreshTokenRecord | undefined;
  revokeRefreshToken(
    tokenHash: string,
    revokedAt: string,
    replacedBySessionId?: string
  ): Promise<boolean> | boolean;
}

export interface WalletAuthenticatorOptions {
  now?: () => Date;
  challengeTtlMs?: number;
  sessionTtlMs?: number;
  refreshTokenTtlMs?: number;
  challengeIdFactory?: () => string;
  sessionIdFactory?: () => string;
  refreshTokenIdFactory?: () => string;
  nonceFactory?: () => string;
  accessTokenFactory?: () => string;
  refreshTokenFactory?: () => string;
}

export class WalletAuthValidationError extends Error {
  readonly code = "wallet_auth_validation_error";

  constructor(message: string) {
    super(message);
    this.name = "WalletAuthValidationError";
  }
}

export class WalletAuthRejectedError extends Error {
  readonly code = "wallet_auth_rejected";

  constructor(message: string) {
    super(message);
    this.name = "WalletAuthRejectedError";
  }
}

export class InMemoryWalletAuthStore implements WalletAuthStore {
  private readonly challengesById = new Map<string, WalletAuthChallengeRecord>();
  private readonly sessionsByTokenHash = new Map<string, AuthenticatedWalletSession>();
  private readonly refreshTokensByHash = new Map<string, WalletAuthRefreshTokenRecord>();

  saveChallenge(challenge: WalletAuthChallengeRecord): void {
    this.challengesById.set(challenge.challengeId, cloneChallenge(challenge));
  }

  getChallenge(challengeId: string): WalletAuthChallengeRecord | undefined {
    const challenge = this.challengesById.get(challengeId);
    return challenge === undefined ? undefined : cloneChallenge(challenge);
  }

  consumeChallenge(challengeId: string, consumedAt: string): boolean {
    const challenge = this.challengesById.get(challengeId);
    if (challenge === undefined || challenge.consumedAt !== undefined) {
      return false;
    }
    this.challengesById.set(challengeId, { ...challenge, consumedAt });
    return true;
  }

  saveSession(tokenHash: string, session: AuthenticatedWalletSession): void {
    this.sessionsByTokenHash.set(tokenHash, cloneSession(session));
  }

  getSession(tokenHash: string): AuthenticatedWalletSession | undefined {
    const session = this.sessionsByTokenHash.get(tokenHash);
    return session === undefined ? undefined : cloneSession(session);
  }

  saveRefreshToken(
    tokenHash: string,
    refreshToken: WalletAuthRefreshTokenRecord
  ): void {
    this.refreshTokensByHash.set(tokenHash, cloneRefreshToken(refreshToken));
  }

  getRefreshToken(
    tokenHash: string
  ): WalletAuthRefreshTokenRecord | undefined {
    const refreshToken = this.refreshTokensByHash.get(tokenHash);
    return refreshToken === undefined ? undefined : cloneRefreshToken(refreshToken);
  }

  revokeRefreshToken(
    tokenHash: string,
    revokedAt: string,
    replacedBySessionId?: string
  ): boolean {
    const refreshToken = this.refreshTokensByHash.get(tokenHash);
    if (refreshToken === undefined || refreshToken.revokedAt !== undefined) {
      return false;
    }
    this.refreshTokensByHash.set(tokenHash, {
      ...refreshToken,
      revokedAt,
      ...(replacedBySessionId === undefined ? {} : { replacedBySessionId })
    });
    return true;
  }
}

export class WalletAuthenticator {
  constructor(
    private readonly store: WalletAuthStore = new InMemoryWalletAuthStore(),
    private readonly options: WalletAuthenticatorOptions = {}
  ) {}

  async createChallenge(
    input: CreateWalletAuthChallengeInput
  ): Promise<WalletAuthChallengeRecord> {
    const createdAt = this.now();
    const challenge: WalletAuthChallengePayload = {
      challengeId: assertAuthId(
        inputChallengeId(this.options.challengeIdFactory),
        "challengeId"
      ),
      wallet: assertWallet(input.wallet, "wallet"),
      network: assertNetwork(input.network),
      purpose: input.purpose ?? "merchant-session",
      nonce: assertNonEmptyString(
        this.options.nonceFactory?.() ?? randomBytes(16).toString("hex"),
        "nonce"
      ),
      expiresAt: new Date(
        Date.parse(createdAt) + (this.options.challengeTtlMs ?? 5 * 60 * 1000)
      ).toISOString()
    };
    assertWalletAuthPurpose(challenge.purpose);

    const record: WalletAuthChallengeRecord = {
      ...challenge,
      message: Buffer.from(buildWalletAuthSigningBytes(challenge)).toString("utf8"),
      createdAt
    };
    await this.store.saveChallenge(record);
    return cloneChallenge(record);
  }

  async createSession(
    input: CreateWalletAuthSessionInput
  ): Promise<WalletAuthSessionResult> {
    const now = this.now();
    const challenge = await this.store.getChallenge(
      assertNonEmptyString(input.challengeId, "challengeId")
    );
    if (challenge === undefined) {
      throw new WalletAuthRejectedError("unknown auth challenge");
    }
    if (challenge.consumedAt !== undefined) {
      throw new WalletAuthRejectedError("auth challenge already used");
    }
    if (Date.parse(challenge.expiresAt) <= Date.parse(now)) {
      throw new WalletAuthRejectedError("auth challenge expired");
    }
    if (input.publicKey !== undefined && input.publicKey !== challenge.wallet) {
      throw new WalletAuthRejectedError(
        "signature public key must match challenge wallet"
      );
    }
    if (!safeVerifyAuthSignature(challenge, input.signature)) {
      throw new WalletAuthRejectedError("invalid auth signature");
    }

    const consumed = await this.store.consumeChallenge(challenge.challengeId, now);
    if (!consumed) {
      throw new WalletAuthRejectedError("auth challenge already used");
    }

    return this.issueSession({
      wallet: challenge.wallet,
      network: challenge.network,
      purpose: challenge.purpose,
      challengeId: challenge.challengeId,
      issuedAt: now
    });
  }

  async refreshSession(
    input: RefreshWalletAuthSessionInput
  ): Promise<WalletAuthSessionResult> {
    const now = this.now();
    const refreshToken = assertNonEmptyString(
      input.refreshToken,
      "refreshToken"
    );
    const refreshTokenHash = hashToken(refreshToken);
    const record = await this.store.getRefreshToken(refreshTokenHash);
    if (record === undefined) {
      throw new WalletAuthRejectedError("unknown refresh token");
    }
    if (record.revokedAt !== undefined) {
      throw new WalletAuthRejectedError("refresh token already used");
    }
    if (Date.parse(record.expiresAt) <= Date.parse(now)) {
      throw new WalletAuthRejectedError("refresh token expired");
    }

    const nextSessionId = assertAuthId(
      inputSessionId(this.options.sessionIdFactory),
      "sessionId"
    );
    const revoked = await this.store.revokeRefreshToken(
      refreshTokenHash,
      now,
      nextSessionId
    );
    if (!revoked) {
      throw new WalletAuthRejectedError("refresh token already used");
    }

    return this.issueSession({
      sessionId: nextSessionId,
      wallet: record.wallet,
      network: record.network,
      purpose: record.purpose,
      challengeId: record.challengeId,
      issuedAt: now
    });
  }

  async revokeSession(
    input: RevokeWalletAuthSessionInput
  ): Promise<WalletAuthRevocationResult> {
    const now = this.now();
    const refreshToken = assertNonEmptyString(
      input.refreshToken,
      "refreshToken"
    );
    const refreshTokenHash = hashToken(refreshToken);
    const record = await this.store.getRefreshToken(refreshTokenHash);
    if (record === undefined) {
      throw new WalletAuthRejectedError("unknown refresh token");
    }
    if (record.revokedAt !== undefined) {
      return { revoked: true, alreadyRevoked: true, wallet: record.wallet };
    }
    const revoked = await this.store.revokeRefreshToken(refreshTokenHash, now);
    return {
      revoked: true,
      alreadyRevoked: !revoked,
      wallet: record.wallet
    };
  }

  async authenticateAccessToken(
    accessToken: string
  ): Promise<AuthenticatedWalletSession | undefined> {
    if (accessToken.trim().length === 0) {
      return undefined;
    }
    const session = await this.store.getSession(hashToken(accessToken));
    if (session === undefined) {
      return undefined;
    }
    if (Date.parse(session.expiresAt) <= Date.parse(this.now())) {
      return undefined;
    }
    return cloneSession(session);
  }

  private now(): string {
    return (this.options.now?.() ?? new Date()).toISOString();
  }

  private async issueSession(input: {
    sessionId?: string;
    wallet: string;
    network: string;
    purpose: WalletAuthPurpose;
    challengeId: string;
    issuedAt: string;
  }): Promise<WalletAuthSessionResult> {
    const accessToken = assertNonEmptyString(
      this.options.accessTokenFactory?.() ?? randomBytes(32).toString("base64url"),
      "accessToken"
    );
    const refreshToken = assertNonEmptyString(
      this.options.refreshTokenFactory?.() ?? randomBytes(32).toString("base64url"),
      "refreshToken"
    );
    const session: AuthenticatedWalletSession = {
      sessionId:
        input.sessionId ??
        assertAuthId(inputSessionId(this.options.sessionIdFactory), "sessionId"),
      wallet: input.wallet,
      network: input.network,
      purpose: input.purpose,
      challengeId: input.challengeId,
      issuedAt: input.issuedAt,
      expiresAt: new Date(
        Date.parse(input.issuedAt) + (this.options.sessionTtlMs ?? 15 * 60 * 1000)
      ).toISOString()
    };
    const refreshTokenRecord: WalletAuthRefreshTokenRecord = {
      refreshTokenId: assertAuthId(
        inputRefreshTokenId(this.options.refreshTokenIdFactory),
        "refreshTokenId"
      ),
      sessionId: session.sessionId,
      wallet: session.wallet,
      network: session.network,
      purpose: session.purpose,
      challengeId: session.challengeId,
      issuedAt: input.issuedAt,
      expiresAt: new Date(
        Date.parse(input.issuedAt) +
          (this.options.refreshTokenTtlMs ?? 30 * 24 * 60 * 60 * 1000)
      ).toISOString()
    };
    await this.store.saveSession(hashToken(accessToken), session);
    await this.store.saveRefreshToken(
      hashToken(refreshToken),
      refreshTokenRecord
    );

    return {
      ...cloneSession(session),
      accessToken,
      refreshToken,
      refreshTokenExpiresAt: refreshTokenRecord.expiresAt,
      tokenType: "Bearer"
    };
  }
}

export function buildWalletAuthSigningBytes(
  challenge: WalletAuthChallengePayload
): Uint8Array {
  return buildDomainSeparatedSigningBytes("split402:auth:v1", {
    challengeId: challenge.challengeId,
    wallet: challenge.wallet,
    network: challenge.network,
    purpose: challenge.purpose,
    nonce: challenge.nonce,
    expiresAt: challenge.expiresAt
  });
}

export function isWalletAuthValidationError(
  error: unknown
): error is WalletAuthValidationError {
  return error instanceof WalletAuthValidationError;
}

export function isWalletAuthRejectedError(
  error: unknown
): error is WalletAuthRejectedError {
  return error instanceof WalletAuthRejectedError;
}

function safeVerifyAuthSignature(
  challenge: WalletAuthChallengePayload,
  signature: string
): boolean {
  try {
    return verifyEd25519Signature(
      buildWalletAuthSigningBytes(challenge),
      challenge.wallet,
      signature
    );
  } catch {
    return false;
  }
}

function inputChallengeId(factory: (() => string) | undefined): string {
  return factory?.() ?? createAuthId("chl");
}

function inputSessionId(factory: (() => string) | undefined): string {
  return factory?.() ?? createAuthId("ses");
}

function inputRefreshTokenId(factory: (() => string) | undefined): string {
  return factory?.() ?? createAuthId("rft");
}

function createAuthId(prefix: "chl" | "ses" | "rft"): string {
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}

function assertAuthId(value: string, label: string): string {
  if (!/^[a-z]{3}_[0-9a-f]{32,}$/u.test(value)) {
    throw new WalletAuthValidationError(`${label} must be a Split402 auth id`);
  }
  return value;
}

function assertWallet(value: string, label: string): string {
  if (!Base58PublicKeySchema.safeParse(value).success) {
    throw new WalletAuthValidationError(`${label} must be a base58 public key`);
  }
  return value;
}

function assertNetwork(value: string): string {
  if (typeof value !== "string" || !value.startsWith("solana:")) {
    throw new WalletAuthValidationError("network must be a solana network id");
  }
  return value;
}

function assertWalletAuthPurpose(value: WalletAuthPurpose): void {
  if (value !== "merchant-session") {
    throw new WalletAuthValidationError("purpose must be merchant-session");
  }
}

function assertNonEmptyString(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new WalletAuthValidationError(`${label} must be a non-empty string`);
  }
  return value;
}

function hashToken(token: string): string {
  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}

function cloneChallenge(
  challenge: WalletAuthChallengeRecord
): WalletAuthChallengeRecord {
  return { ...challenge };
}

function cloneSession(session: AuthenticatedWalletSession): AuthenticatedWalletSession {
  return { ...session };
}

function cloneRefreshToken(
  refreshToken: WalletAuthRefreshTokenRecord
): WalletAuthRefreshTokenRecord {
  return { ...refreshToken };
}
