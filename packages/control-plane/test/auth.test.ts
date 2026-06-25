import {
  deriveEd25519PublicKey,
  hexToBytes,
  signEd25519Message
} from "@split402/protocol";
import { describe, expect, it } from "vitest";

import {
  InMemoryWalletAuthStore,
  WalletAuthRejectedError,
  WalletAuthenticator
} from "../src/index.js";

const OWNER_SEED = hexToBytes(
  "a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf"
);
const OWNER_WALLET = deriveEd25519PublicKey(OWNER_SEED);
const NETWORK = "solana:devnet";

describe("wallet authentication", () => {
  it("creates a single-use challenge and bearer session", async () => {
    const authenticator = createAuthenticator();
    const challenge = await authenticator.createChallenge({
      wallet: OWNER_WALLET,
      network: NETWORK
    });
    const signature = signChallenge(challenge.message);

    const session = await authenticator.createSession({
      challengeId: challenge.challengeId,
      signature,
      publicKey: OWNER_WALLET
    });
    const authenticated = await authenticator.authenticateAccessToken(
      session.accessToken
    );

    expect(challenge.message.startsWith("split402:auth:v1\n")).toBe(true);
    expect(session.tokenType).toBe("Bearer");
    expect(session.refreshToken).toMatch(/^test-refresh-token-/u);
    expect(session.refreshTokenExpiresAt).toBe("2026-06-24T00:20:00.000Z");
    expect(authenticated?.wallet).toBe(OWNER_WALLET);
  });

  it("rotates refresh tokens into new bearer sessions", async () => {
    const authenticator = createAuthenticator();
    const challenge = await authenticator.createChallenge({
      wallet: OWNER_WALLET,
      network: NETWORK
    });
    const session = await authenticator.createSession({
      challengeId: challenge.challengeId,
      signature: signChallenge(challenge.message)
    });

    const refreshed = await authenticator.refreshSession({
      refreshToken: session.refreshToken
    });

    expect(refreshed.sessionId).not.toBe(session.sessionId);
    expect(refreshed.accessToken).toMatch(/^test-token-/u);
    expect(refreshed.refreshToken).toMatch(/^test-refresh-token-/u);
    expect(refreshed.refreshToken).not.toBe(session.refreshToken);
    await expect(
      authenticator.refreshSession({ refreshToken: session.refreshToken })
    ).rejects.toBeInstanceOf(WalletAuthRejectedError);
    await expect(
      authenticator.authenticateAccessToken(refreshed.accessToken)
    ).resolves.toEqual(expect.objectContaining({ wallet: OWNER_WALLET }));
  });

  it("rejects replayed challenges", async () => {
    const authenticator = createAuthenticator();
    const challenge = await authenticator.createChallenge({
      wallet: OWNER_WALLET,
      network: NETWORK
    });
    const signature = signChallenge(challenge.message);

    await authenticator.createSession({ challengeId: challenge.challengeId, signature });

    await expect(
      authenticator.createSession({ challengeId: challenge.challengeId, signature })
    ).rejects.toBeInstanceOf(WalletAuthRejectedError);
  });

  it("rejects expired challenges and sessions", async () => {
    let now = new Date("2026-06-24T00:00:00Z");
    const authenticator = createAuthenticator(() => now);
    const challenge = await authenticator.createChallenge({
      wallet: OWNER_WALLET,
      network: NETWORK
    });

    now = new Date("2026-06-24T00:01:01Z");
    await expect(
      authenticator.createSession({
        challengeId: challenge.challengeId,
        signature: signChallenge(challenge.message)
      })
    ).rejects.toBeInstanceOf(WalletAuthRejectedError);

    now = new Date("2026-06-24T00:00:00Z");
    const freshChallenge = await authenticator.createChallenge({
      wallet: OWNER_WALLET,
      network: NETWORK
    });
    const session = await authenticator.createSession({
      challengeId: freshChallenge.challengeId,
      signature: signChallenge(freshChallenge.message)
    });

    now = new Date("2026-06-24T00:11:00Z");
    await expect(
      authenticator.authenticateAccessToken(session.accessToken)
    ).resolves.toBeUndefined();

    now = new Date("2026-06-24T00:21:00Z");
    await expect(
      authenticator.refreshSession({ refreshToken: session.refreshToken })
    ).rejects.toBeInstanceOf(WalletAuthRejectedError);
  });
});

function createAuthenticator(
  now: () => Date = () => new Date("2026-06-24T00:00:00Z")
): WalletAuthenticator {
  let idSequence = 0;
  return new WalletAuthenticator(new InMemoryWalletAuthStore(), {
    now,
    challengeTtlMs: 60_000,
    sessionTtlMs: 10 * 60_000,
    refreshTokenTtlMs: 20 * 60_000,
    challengeIdFactory: () => nextAuthId("chl", ++idSequence),
    sessionIdFactory: () => nextAuthId("ses", ++idSequence),
    refreshTokenIdFactory: () => nextAuthId("rft", ++idSequence),
    nonceFactory: () => `nonce-${idSequence}`,
    accessTokenFactory: () => `test-token-${idSequence}`,
    refreshTokenFactory: () => `test-refresh-token-${idSequence}`
  });
}

function nextAuthId(prefix: "chl" | "ses" | "rft", sequence: number): string {
  return `${prefix}_${sequence.toString(16).padStart(32, "0")}`;
}

function signChallenge(message: string): string {
  return signEd25519Message(new TextEncoder().encode(message), OWNER_SEED).signature;
}
