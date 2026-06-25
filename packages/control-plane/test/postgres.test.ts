import {
  buildReferralClaimSigningBytes,
  createSampleProtocolArtifacts,
  deriveEd25519PublicKey,
  hexToBytes,
  signEd25519Message,
  type ReferralClaimV1,
  type Split402ReceiptV1
} from "@split402/protocol";
import type { QueryResult, QueryResultRow } from "pg";
import { describe, expect, it } from "vitest";

import {
  buildCampaignTermsSigningBytes,
  CampaignRegistryConflictError,
  InMemoryReceiptIngestionStore,
  MerchantRegistryConflictError,
  PostgresCampaignRegistry,
  PostgresMerchantRegistry,
  PostgresOutboxEventStore,
  PostgresReceiptIngestionStore,
  PostgresRouteRegistry,
  PostgresWalletAuthStore,
  ReceiptIngestionPersistenceConflictError,
  ReceiptIngestor,
  RouteRegistryConflictError,
  RouteRegistryValidationError,
  WalletAuthRejectedError,
  WalletAuthenticator,
  type CampaignTermsInput,
  type CampaignVersionRecord,
  type PostgresPool,
  type PostgresTransactionClient,
  type ReceiptIngestionSnapshot,
  type RouteDraft,
  type UnsignedReferralClaim
} from "../src/index.js";

const OWNER_SEED = hexToBytes(
  "a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf"
);
const MERCHANT_SEED = hexToBytes(
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
);
const REFERRER_SEED = hexToBytes(
  "202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f"
);
const PAYOUT_SEED = hexToBytes(
  "404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f"
);
const ROTATED_PAYOUT_SEED = hexToBytes(
  "606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f"
);
const OWNER_WALLET = deriveEd25519PublicKey(OWNER_SEED);
const REFERRER_WALLET = deriveEd25519PublicKey(REFERRER_SEED);
const PAYOUT_WALLET = deriveEd25519PublicKey(PAYOUT_SEED);
const ROTATED_PAYOUT_WALLET = deriveEd25519PublicKey(ROTATED_PAYOUT_SEED);
const NETWORK = "solana:devnet";

describe("PostgresReceiptIngestionStore", () => {
  it("persists and loads a credited receipt snapshot", async () => {
    const bundle = createSampleProtocolArtifacts();
    const fakePool = new FakePostgresPool();
    const store = new PostgresReceiptIngestionStore(fakePool);
    const ingestor = new ReceiptIngestor(store, {
      resolveMerchantPublicKey: () => bundle.keys.merchantPublicKey,
      now: () => new Date("2026-06-24T00:02:00Z")
    });

    const result = await ingestor.ingest({
      receipt: bundle.artifacts.receipt,
      source: "buyer"
    });
    const loaded = await store.getByReceiptId(bundle.artifacts.receipt.receiptId);

    expect(result.status).toBe("created");
    expect(fakePool.client.commands).toEqual(
      expect.arrayContaining(["begin", "commit"])
    );
    expect(fakePool.client.rollbackCount).toBe(0);
    expect(fakePool.client.releaseCount).toBe(1);
    expect(loaded?.receipt.id).toBe(bundle.artifacts.receipt.receiptId);
    expect(loaded?.receipt.source).toBe("buyer");
    expect(loaded?.accrual).toEqual(
      expect.objectContaining({
        receiptId: bundle.artifacts.receipt.receiptId,
        amountAtomic: "2000"
      })
    );
    expect(loaded?.ledgerTransaction?.entries).toHaveLength(3);
    expect(fakePool.database.outboxEvents).toHaveLength(2);
    const receiptAcceptedEvent = findOutboxEvent(
      fakePool.database.outboxEvents,
      "receipt.accepted.v1"
    );
    const webhookEvent = findOutboxEvent(
      fakePool.database.outboxEvents,
      "webhook.receipt.accepted.v1"
    );
    expect(receiptAcceptedEvent).toEqual(
      expect.objectContaining({
        event_type: "receipt.accepted.v1",
        aggregate_type: "receipt",
        aggregate_id: bundle.artifacts.receipt.receiptId,
        status: "pending",
        attempts: 0,
        available_at: "2026-06-24T00:02:00.000Z",
        created_at: "2026-06-24T00:02:00.000Z"
      })
    );
    expect(readJsonPayload(receiptAcceptedEvent?.payload)).toEqual(
      expect.objectContaining({
        receiptId: bundle.artifacts.receipt.receiptId,
        receiptHash: loaded?.receipt.receiptHash,
        merchantId: bundle.artifacts.receipt.merchantId,
        accrualId: loaded?.accrual?.id,
        ledgerTransactionId: loaded?.ledgerTransaction?.id
      })
    );
    expect(webhookEvent).toEqual(
      expect.objectContaining({
        event_type: "webhook.receipt.accepted.v1",
        aggregate_type: "receipt",
        aggregate_id: bundle.artifacts.receipt.receiptId,
        status: "pending"
      })
    );
  });

  it("persists receipt snapshots without accrual or ledger rows", async () => {
    const bundle = createSampleProtocolArtifacts();
    const fakePool = new FakePostgresPool();
    const store = new PostgresReceiptIngestionStore(fakePool);
    const snapshot = await createSnapshot(bundle.artifacts.receipt);
    const zeroSnapshot: ReceiptIngestionSnapshot = {
      receipt: snapshot.receipt
    };

    await store.save(zeroSnapshot);
    const loaded = await store.getByReceiptHash(snapshot.receipt.receiptHash);

    expect(loaded?.receipt.id).toBe(snapshot.receipt.id);
    expect(loaded?.accrual).toBeUndefined();
    expect(loaded?.ledgerTransaction).toBeUndefined();
    expect(fakePool.database.accruals).toHaveLength(0);
    expect(fakePool.database.ledgerTransactions).toHaveLength(0);
    expect(fakePool.database.ledgerEntries).toHaveLength(0);
    expect(fakePool.database.outboxEvents).toHaveLength(2);
    expect(
      readJsonPayload(
        findOutboxEvent(fakePool.database.outboxEvents, "receipt.accepted.v1")
          ?.payload
      )
    ).toEqual(
      expect.objectContaining({
        receiptId: snapshot.receipt.id,
        accrualId: null,
        ledgerTransactionId: null
      })
    );
  });

  it("rolls back and maps unique violations to persistence conflicts", async () => {
    const bundle = createSampleProtocolArtifacts();
    const fakePool = new FakePostgresPool();
    fakePool.database.failNextInsertWithUniqueViolation = true;
    const store = new PostgresReceiptIngestionStore(fakePool);
    const snapshot = await createSnapshot(bundle.artifacts.receipt);

    await expect(store.save(snapshot)).rejects.toBeInstanceOf(
      ReceiptIngestionPersistenceConflictError
    );
    expect(fakePool.client.rollbackCount).toBe(1);
    expect(fakePool.client.releaseCount).toBe(1);
    expect(fakePool.database.receipts).toHaveLength(0);
    expect(fakePool.database.outboxEvents).toHaveLength(0);
  });

  it("claims, retries, and delivers ready outbox events", async () => {
    const bundle = createSampleProtocolArtifacts();
    const fakePool = new FakePostgresPool();
    const receiptStore = new PostgresReceiptIngestionStore(fakePool);
    const outboxStore = new PostgresOutboxEventStore(fakePool);
    const ingestor = new ReceiptIngestor(receiptStore, {
      resolveMerchantPublicKey: () => bundle.keys.merchantPublicKey,
      now: () => new Date("2026-06-24T00:02:00Z")
    });
    await ingestor.ingest({ receipt: bundle.artifacts.receipt, source: "merchant" });

    const claimed = await outboxStore.claimNext({
      now: "2026-06-24T00:03:00Z",
      eventTypes: ["receipt.accepted.v1"]
    });

    expect(claimed).toEqual(
      expect.objectContaining({
        eventType: "receipt.accepted.v1",
        aggregateId: bundle.artifacts.receipt.receiptId,
        status: "processing",
        attempts: 1,
        lockedAt: "2026-06-24T00:03:00Z"
      })
    );
    if (claimed === undefined) {
      throw new Error("expected claimed outbox event");
    }
    expect(
      await outboxStore.claimNext({
        now: "2026-06-24T00:03:01Z",
        eventTypes: ["receipt.accepted.v1"]
      })
    ).toBeUndefined();

    const failed = await outboxStore.markFailed({
      eventId: claimed.id,
      lastError: "rpc timeout",
      availableAt: "2026-06-24T00:05:00Z"
    });

    expect(failed).toEqual(
      expect.objectContaining({
        status: "pending",
        attempts: 1,
        availableAt: "2026-06-24T00:05:00Z",
        lastError: "rpc timeout"
      })
    );
    expect(failed?.lockedAt).toBeUndefined();
    expect(
      await outboxStore.claimNext({
        now: "2026-06-24T00:04:59Z",
        eventTypes: ["receipt.accepted.v1"]
      })
    ).toBeUndefined();

    const retry = await outboxStore.claimNext({
      now: "2026-06-24T00:05:00Z",
      eventTypes: ["receipt.accepted.v1"]
    });
    expect(retry?.status).toBe("processing");
    expect(retry?.attempts).toBe(2);
    expect(retry?.lastError).toBeUndefined();

    if (retry === undefined) {
      throw new Error("expected retried outbox event");
    }
    const delivered = await outboxStore.markDelivered({ eventId: retry.id });
    const loaded = await outboxStore.getEvent(retry.id);

    expect(delivered?.status).toBe("delivered");
    expect(delivered?.lockedAt).toBeUndefined();
    expect(delivered?.lastError).toBeUndefined();
    expect(loaded?.status).toBe("delivered");
    expect(
      await outboxStore.claimNext({
        now: "2026-06-24T00:06:00Z",
        eventTypes: ["receipt.accepted.v1"]
      })
    ).toBeUndefined();

    const webhookEvent = await outboxStore.claimNext({
      now: "2026-06-24T00:06:00Z",
      eventTypes: ["webhook.receipt.accepted.v1"]
    });
    expect(webhookEvent?.eventType).toBe("webhook.receipt.accepted.v1");
  });

  it("dead-letters failed processing outbox events", async () => {
    const bundle = createSampleProtocolArtifacts();
    const fakePool = new FakePostgresPool();
    const receiptStore = new PostgresReceiptIngestionStore(fakePool);
    const outboxStore = new PostgresOutboxEventStore(fakePool);
    const ingestor = new ReceiptIngestor(receiptStore, {
      resolveMerchantPublicKey: () => bundle.keys.merchantPublicKey,
      now: () => new Date("2026-06-24T00:02:00Z")
    });
    await ingestor.ingest({ receipt: bundle.artifacts.receipt, source: "relay" });
    const claimed = await outboxStore.claimNext({
      now: "2026-06-24T00:03:00Z",
      eventTypes: ["receipt.accepted.v1"]
    });
    if (claimed === undefined) {
      throw new Error("expected claimed outbox event");
    }

    const deadLetter = await outboxStore.markFailed({
      eventId: claimed.id,
      lastError: "invalid chain response",
      availableAt: "2026-06-24T00:03:00Z",
      deadLetter: true
    });

    expect(deadLetter).toEqual(
      expect.objectContaining({
        status: "dead_letter",
        attempts: 1,
        lastError: "invalid chain response"
      })
    );
    expect(
      await outboxStore.claimNext({
        now: "2026-06-24T00:10:00Z",
        eventTypes: ["receipt.accepted.v1"]
      })
    ).toBeUndefined();
  });

  it("marks chain-verified receipts and accruals available", async () => {
    const bundle = createSampleProtocolArtifacts();
    const fakePool = new FakePostgresPool();
    const store = new PostgresReceiptIngestionStore(fakePool);
    const ingestor = new ReceiptIngestor(store, {
      resolveMerchantPublicKey: () => bundle.keys.merchantPublicKey,
      now: () => new Date("2026-06-24T00:02:00Z")
    });
    await ingestor.ingest({ receipt: bundle.artifacts.receipt, source: "merchant" });

    const verified = await store.markReceiptChainVerified({
      receiptId: bundle.artifacts.receipt.receiptId,
      verifiedAt: "2026-06-24T00:04:00Z"
    });
    const replayed = await store.markReceiptChainVerified({
      receiptId: bundle.artifacts.receipt.receiptId,
      verifiedAt: "2026-06-24T00:05:00Z"
    });

    expect(verified?.receipt.verificationState).toBe("signature_verified");
    expect(verified?.accrual).toEqual(
      expect.objectContaining({
        status: "available",
        availableAt: "2026-06-24T00:04:00Z"
      })
    );
    expect(replayed?.accrual?.availableAt).toBe("2026-06-24T00:04:00Z");
  });
});

describe("PostgresMerchantRegistry", () => {
  it("persists merchants, origins, keys, and profiles", async () => {
    const bundle = createSampleProtocolArtifacts();
    const fakePool = new FakePostgresPool();
    const registry = createPostgresRegistry(fakePool);

    const merchant = await registry.createMerchant({
      id: bundle.artifacts.receipt.merchantId,
      slug: "demo-merchant",
      displayName: "Demo Merchant",
      ownerWallet: bundle.keys.payerWallet,
      status: "active"
    });
    const origin = await registry.addOrigin({
      merchantId: merchant.id,
      origin: bundle.artifacts.receipt.merchantOrigin,
      status: "verified",
      verifiedAt: "2026-06-24T00:00:00Z"
    });
    const key = await registry.addKey({
      merchantId: merchant.id,
      kid: bundle.artifacts.receipt.kid,
      publicKey: bundle.keys.merchantPublicKey,
      validFrom: "2026-06-24T00:00:00Z"
    });
    const profile = await registry.getMerchantProfile(merchant.id);

    expect(origin.status).toBe("verified");
    expect(key.purpose).toBe("offer_receipt");
    expect(profile?.id).toBe(merchant.id);
    expect(profile?.origins).toHaveLength(1);
    expect(profile?.keys).toHaveLength(1);
  });

  it("resolves active service keys and respects revocation windows", async () => {
    const bundle = createSampleProtocolArtifacts();
    const fakePool = new FakePostgresPool();
    const registry = createPostgresRegistry(fakePool);
    await registry.createMerchant({
      id: bundle.artifacts.receipt.merchantId,
      slug: "demo-merchant",
      displayName: "Demo Merchant",
      ownerWallet: bundle.keys.payerWallet
    });
    await registry.addKey({
      merchantId: bundle.artifacts.receipt.merchantId,
      kid: bundle.artifacts.receipt.kid,
      publicKey: bundle.keys.merchantPublicKey,
      validFrom: "2026-06-24T00:00:00Z"
    });

    const beforeRevocation = await registry.resolveKey({
      merchantId: bundle.artifacts.receipt.merchantId,
      kid: bundle.artifacts.receipt.kid,
      at: "2026-06-24T00:01:00Z"
    });
    await registry.revokeKey({
      merchantId: bundle.artifacts.receipt.merchantId,
      kid: bundle.artifacts.receipt.kid,
      revokedAt: "2026-06-24T00:02:00Z",
      reason: "rotation complete"
    });
    const historical = await registry.resolveKey({
      merchantId: bundle.artifacts.receipt.merchantId,
      kid: bundle.artifacts.receipt.kid,
      at: "2026-06-24T00:01:30Z"
    });
    const afterRevocation = await registry.resolveKey({
      merchantId: bundle.artifacts.receipt.merchantId,
      kid: bundle.artifacts.receipt.kid,
      at: "2026-06-24T00:02:01Z"
    });

    expect(beforeRevocation?.publicKey).toBe(bundle.keys.merchantPublicKey);
    expect(historical?.publicKey).toBe(bundle.keys.merchantPublicKey);
    expect(afterRevocation).toBeUndefined();
  });

  it("maps unique violations to merchant registry conflicts", async () => {
    const bundle = createSampleProtocolArtifacts();
    const fakePool = new FakePostgresPool();
    const registry = createPostgresRegistry(fakePool);
    await registry.createMerchant({
      id: bundle.artifacts.receipt.merchantId,
      slug: "demo-merchant",
      displayName: "Demo Merchant",
      ownerWallet: bundle.keys.payerWallet
    });

    await expect(
      registry.createMerchant({
        id: "mrc_ffffffffffffffffffffffffffffffff",
        slug: "demo-merchant",
        displayName: "Second Merchant",
        ownerWallet: bundle.keys.payerWallet
      })
    ).rejects.toBeInstanceOf(MerchantRegistryConflictError);
  });
});

describe("PostgresCampaignRegistry", () => {
  it("persists campaign drafts, versions, and operations", async () => {
    const bundle = createSampleProtocolArtifacts();
    const fakePool = new FakePostgresPool();
    const registry = createPostgresCampaignRegistry(fakePool);

    const campaign = await registry.createCampaign({
      id: bundle.artifacts.receipt.campaignId,
      merchantId: bundle.artifacts.receipt.merchantId,
      ...createCampaignTerms()
    });
    const firstVersion = await registry.getCampaignVersion(campaign.id, 1);
    const secondVersion = await registry.createCampaignVersion({
      campaignId: campaign.id,
      ...createCampaignTerms({ commissionBps: 2500 })
    });
    const loaded = await registry.getCampaign(campaign.id);

    expect(campaign.status).toBe("draft");
    expect(firstVersion?.termsHash).toBe(campaign.current.termsHash);
    expect(secondVersion.version).toBe(2);
    expect(secondVersion.terms.commissionBps).toBe(2500);
    expect(loaded?.currentVersion).toBe(2);
    expect(loaded?.current.termsHash).toBe(secondVersion.termsHash);
    expect(fakePool.database.campaigns).toHaveLength(1);
    expect(fakePool.database.campaignVersions).toHaveLength(2);
    expect(fakePool.database.campaignOperations).toHaveLength(2);
  });

  it("activates the current version with a merchant signature", async () => {
    const bundle = createSampleProtocolArtifacts();
    const fakePool = new FakePostgresPool();
    const registry = createPostgresCampaignRegistry(fakePool);
    const campaign = await registry.createCampaign({
      id: bundle.artifacts.receipt.campaignId,
      merchantId: bundle.artifacts.receipt.merchantId,
      ...createCampaignTerms()
    });
    const signature = signCampaignTerms(campaign.current);

    const activated = await registry.activateCampaignVersion({
      campaignId: campaign.id,
      merchantKid: bundle.artifacts.receipt.kid,
      merchantPublicKey: bundle.keys.merchantPublicKey,
      merchantSignature: signature
    });
    const replayed = await registry.activateCampaignVersion({
      campaignId: campaign.id,
      merchantKid: bundle.artifacts.receipt.kid,
      merchantPublicKey: bundle.keys.merchantPublicKey,
      merchantSignature: signature
    });
    const loaded = await registry.getCampaign(campaign.id);

    expect(activated.status).toBe("active");
    expect(activated.current.merchantSignature).toBe(signature);
    expect(activated.current.activatedAt).toBe("2026-06-24T00:00:00.000Z");
    expect(replayed.current.merchantSignature).toBe(signature);
    expect(loaded?.status).toBe("active");
    expect(loaded?.current.merchantKid).toBe(bundle.artifacts.receipt.kid);
    await expect(
      registry.activateCampaignVersion({
        campaignId: campaign.id,
        merchantKid: bundle.artifacts.receipt.kid,
        merchantPublicKey: bundle.keys.merchantPublicKey,
        merchantSignature: "different-signature"
      })
    ).rejects.toBeInstanceOf(CampaignRegistryConflictError);
  });

  it("maps unique violations to campaign registry conflicts", async () => {
    const bundle = createSampleProtocolArtifacts();
    const fakePool = new FakePostgresPool();
    const registry = createPostgresCampaignRegistry(fakePool);
    await registry.createCampaign({
      id: bundle.artifacts.receipt.campaignId,
      merchantId: bundle.artifacts.receipt.merchantId,
      ...createCampaignTerms()
    });

    await expect(
      registry.createCampaign({
        id: bundle.artifacts.receipt.campaignId,
        merchantId: bundle.artifacts.receipt.merchantId,
        ...createCampaignTerms({ commissionBps: 2500 })
      })
    ).rejects.toBeInstanceOf(CampaignRegistryConflictError);
  });
});

describe("PostgresRouteRegistry", () => {
  it("persists activated route claims and returns exact duplicates idempotently", async () => {
    const fakePool = new FakePostgresPool();
    const registry = createPostgresRouteRegistry(fakePool);
    const draft = registry.createRouteDraft(createRouteDraftInput());
    const claim = signRouteDraft(draft);

    const route = await registry.activateRoute({ claim });
    const duplicate = await registry.activateRoute({ claim });
    const loaded = await registry.getRoute(route.id);

    expect(route.status).toBe("active");
    expect(route.claimHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(duplicate.claimHash).toBe(route.claimHash);
    expect(loaded?.claim).toEqual(claim);
    expect(fakePool.database.routes).toHaveLength(1);
    expect(fakePool.database.routeVersions).toHaveLength(1);
    expect(fakePool.database.routeVersions[0]?.version).toBe(1);
  });

  it("persists payout rotations as immutable route versions", async () => {
    const fakePool = new FakePostgresPool();
    const registry = createPostgresRouteRegistry(fakePool);
    const route = await registry.activateRoute({
      claim: signRouteDraft(registry.createRouteDraft(createRouteDraftInput()))
    });
    const rotatedClaim = signRouteDraft(
      registry.createRouteDraft(
        createRouteDraftInput({
          payoutWallet: ROTATED_PAYOUT_WALLET,
          nonce: "route-nonce-postgres-0002",
          issuedAt: "2026-06-24T00:01:00Z"
        })
      )
    );

    const rotated = await registry.rotateRoutePayout({
      routeId: route.id,
      claim: rotatedClaim
    });
    const duplicate = await registry.rotateRoutePayout({
      routeId: route.id,
      claim: rotatedClaim
    });
    const loaded = await registry.getRoute(route.id);
    const versions = await registry.listRouteVersions(route.id);

    expect(rotated.currentVersion).toBe(2);
    expect(rotated.payoutWallet).toBe(ROTATED_PAYOUT_WALLET);
    expect(duplicate.currentVersion).toBe(2);
    expect(loaded?.claim).toEqual(rotatedClaim);
    expect(versions.map((version) => version.version)).toEqual([1, 2]);
    expect(versions.map((version) => version.payoutWallet)).toEqual([
      PAYOUT_WALLET,
      ROTATED_PAYOUT_WALLET
    ]);
    expect(fakePool.database.routes).toHaveLength(1);
    expect(fakePool.database.routeVersions).toHaveLength(2);
  });

  it("maps same-route different-claim writes to route conflicts", async () => {
    const fakePool = new FakePostgresPool();
    const registry = createPostgresRouteRegistry(fakePool);
    const firstClaim = signRouteDraft(
      registry.createRouteDraft(createRouteDraftInput())
    );
    const secondClaim = signRouteDraft(
      registry.createRouteDraft(
        createRouteDraftInput({ operationIds: ["operation-two"] })
      )
    );
    await registry.activateRoute({ claim: firstClaim });

    await expect(registry.activateRoute({ claim: secondClaim })).rejects.toBeInstanceOf(
      RouteRegistryConflictError
    );
  });

  it("suspends active routes idempotently", async () => {
    const fakePool = new FakePostgresPool();
    const registry = createPostgresRouteRegistry(fakePool);
    const claim = signRouteDraft(
      registry.createRouteDraft(createRouteDraftInput())
    );
    const route = await registry.activateRoute({ claim });

    const suspended = await registry.suspendRoute({ routeId: route.id });
    const duplicate = await registry.suspendRoute({ routeId: route.id });
    const loaded = await registry.getRoute(route.id);

    expect(suspended?.status).toBe("suspended");
    expect(duplicate?.status).toBe("suspended");
    expect(loaded?.status).toBe("suspended");
    expect(fakePool.database.routes[0]?.status).toBe("suspended");
    await expect(
      registry.suspendRoute({ routeId: "rte_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" })
    ).resolves.toBeUndefined();
  });

  it("searches persisted routes by filters and status", async () => {
    const bundle = createSampleProtocolArtifacts();
    const fakePool = new FakePostgresPool();
    const registry = createPostgresRouteRegistry(fakePool);
    const first = await registry.activateRoute({
      claim: signRouteDraft(registry.createRouteDraft(createRouteDraftInput()))
    });
    const second = await registry.activateRoute({
      claim: signRouteDraft(
        registry.createRouteDraft(
          createRouteDraftInput({
            id: "rte_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            operationIds: ["operation-two"],
            nonce: "route-nonce-postgres-0002"
          })
        )
      )
    });
    const wildcard = await registry.activateRoute({
      claim: signRouteDraft(
        registry.createRouteDraft(
          createRouteDraftInput({
            id: "rte_cccccccccccccccccccccccccccccccc",
            operationIds: ["*"],
            nonce: "route-nonce-postgres-0003"
          })
        )
      )
    });

    await registry.suspendRoute({ routeId: second.id });

    await expect(registry.searchRoutes()).resolves.toEqual([
      expect.objectContaining({ id: wildcard.id }),
      expect.objectContaining({ id: first.id })
    ]);
    await expect(
      registry.searchRoutes({
        campaignId: bundle.artifacts.receipt.campaignId,
        referrerWallet: REFERRER_WALLET,
        resourceOrigin: bundle.artifacts.receipt.merchantOrigin,
        operationId: bundle.artifacts.receipt.operationId,
        limit: 1
      })
    ).resolves.toEqual([expect.objectContaining({ id: wildcard.id })]);
    await expect(
      registry.searchRoutes({ operationId: "operation-two" })
    ).resolves.toEqual([expect.objectContaining({ id: wildcard.id })]);
    await expect(registry.searchRoutes({ status: "suspended" })).resolves.toEqual([
      expect.objectContaining({ id: second.id })
    ]);
    await expect(registry.searchRoutes({ limit: 101 })).rejects.toBeInstanceOf(
      RouteRegistryValidationError
    );
  });
});

describe("PostgresWalletAuthStore", () => {
  it("persists single-use challenges and hashed bearer sessions", async () => {
    const fakePool = new FakePostgresPool();
    const authenticator = createPostgresAuthenticator(fakePool);
    const challenge = await authenticator.createChallenge({
      wallet: OWNER_WALLET,
      network: NETWORK
    });
    const signature = signEd25519Message(
      new TextEncoder().encode(challenge.message),
      OWNER_SEED
    ).signature;

    const session = await authenticator.createSession({
      challengeId: challenge.challengeId,
      signature,
      publicKey: OWNER_WALLET
    });
    const authenticated = await authenticator.authenticateAccessToken(
      session.accessToken
    );

    expect(fakePool.database.walletAuthChallenges).toHaveLength(1);
    expect(fakePool.database.walletAuthChallenges[0]?.consumed_at).toBe(
      "2026-06-24T00:00:00.000Z"
    );
    expect(fakePool.database.walletAuthSessions).toHaveLength(1);
    expect(fakePool.database.walletAuthSessions[0]?.token_hash).toMatch(
      /^sha256:[0-9a-f]{64}$/u
    );
    expect(fakePool.database.walletAuthSessions[0]?.token_hash).not.toContain(
      session.accessToken
    );
    expect(fakePool.database.walletAuthRefreshTokens).toHaveLength(1);
    expect(fakePool.database.walletAuthRefreshTokens[0]?.token_hash).toMatch(
      /^sha256:[0-9a-f]{64}$/u
    );
    expect(fakePool.database.walletAuthRefreshTokens[0]?.token_hash).not.toContain(
      session.refreshToken
    );
    expect(authenticated?.wallet).toBe(OWNER_WALLET);
  });

  it("rotates persisted refresh tokens into new sessions", async () => {
    const fakePool = new FakePostgresPool();
    const authenticator = createPostgresAuthenticator(fakePool);
    const challenge = await authenticator.createChallenge({
      wallet: OWNER_WALLET,
      network: NETWORK
    });
    const signature = signEd25519Message(
      new TextEncoder().encode(challenge.message),
      OWNER_SEED
    ).signature;
    const session = await authenticator.createSession({
      challengeId: challenge.challengeId,
      signature
    });

    const refreshed = await authenticator.refreshSession({
      refreshToken: session.refreshToken
    });

    expect(refreshed.sessionId).not.toBe(session.sessionId);
    expect(fakePool.database.walletAuthSessions).toHaveLength(2);
    expect(fakePool.database.walletAuthRefreshTokens).toHaveLength(2);
    expect(fakePool.database.walletAuthRefreshTokens[0]?.revoked_at).toBe(
      "2026-06-24T00:00:00.000Z"
    );
    expect(
      fakePool.database.walletAuthRefreshTokens[0]?.replaced_by_session_id
    ).toBe(refreshed.sessionId);
    await expect(
      authenticator.refreshSession({ refreshToken: session.refreshToken })
    ).rejects.toBeInstanceOf(WalletAuthRejectedError);
  });

  it("prevents replay after a challenge is consumed in PostgreSQL", async () => {
    const fakePool = new FakePostgresPool();
    const authenticator = createPostgresAuthenticator(fakePool);
    const challenge = await authenticator.createChallenge({
      wallet: OWNER_WALLET,
      network: NETWORK
    });
    const signature = signEd25519Message(
      new TextEncoder().encode(challenge.message),
      OWNER_SEED
    ).signature;
    await authenticator.createSession({ challengeId: challenge.challengeId, signature });

    await expect(
      authenticator.createSession({ challengeId: challenge.challengeId, signature })
    ).rejects.toBeInstanceOf(WalletAuthRejectedError);
  });
});

async function createSnapshot(
  receipt: Split402ReceiptV1
): Promise<ReceiptIngestionSnapshot> {
  const bundle = createSampleProtocolArtifacts();
  const store = new InMemoryReceiptIngestionStore();
  const ingestor = new ReceiptIngestor(store, {
    resolveMerchantPublicKey: () => bundle.keys.merchantPublicKey,
    now: () => new Date("2026-06-24T00:02:00Z")
  });
  const result = await ingestor.ingest({ receipt, source: "buyer" });
  if (result.status !== "created") {
    throw new Error("expected snapshot creation");
  }
  return result;
}

function createPostgresRegistry(fakePool: FakePostgresPool): PostgresMerchantRegistry {
  return new PostgresMerchantRegistry(fakePool, {
    now: () => new Date("2026-06-24T00:00:00Z"),
    merchantIdFactory: () => "mrc_ffffffffffffffffffffffffffffffff"
  });
}

function createPostgresCampaignRegistry(
  fakePool: FakePostgresPool
): PostgresCampaignRegistry {
  return new PostgresCampaignRegistry(fakePool, {
    now: () => new Date("2026-06-24T00:00:00Z"),
    campaignIdFactory: () => "cmp_ffffffffffffffffffffffffffffffff"
  });
}

function createPostgresRouteRegistry(fakePool: FakePostgresPool): PostgresRouteRegistry {
  return new PostgresRouteRegistry(fakePool, {
    now: () => new Date("2026-06-24T00:00:00Z"),
    routeIdFactory: () => "rte_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    nonceFactory: () => "route-nonce-postgres-0001"
  });
}

function createPostgresAuthenticator(
  fakePool: FakePostgresPool
): WalletAuthenticator {
  let idSequence = 0;
  return new WalletAuthenticator(new PostgresWalletAuthStore(fakePool), {
    now: () => new Date("2026-06-24T00:00:00Z"),
    challengeIdFactory: () => nextAuthId("chl", ++idSequence),
    sessionIdFactory: () => nextAuthId("ses", ++idSequence),
    refreshTokenIdFactory: () => nextAuthId("rft", ++idSequence),
    nonceFactory: () => `nonce-${idSequence}`,
    accessTokenFactory: () => `postgres-token-${idSequence}`,
    refreshTokenFactory: () => `postgres-refresh-token-${idSequence}`
  });
}

function nextAuthId(prefix: "chl" | "ses" | "rft", sequence: number): string {
  return `${prefix}_${sequence.toString(16).padStart(32, "0")}`;
}

function createCampaignTerms(
  overrides: Partial<CampaignTermsInput> = {}
): CampaignTermsInput {
  const bundle = createSampleProtocolArtifacts();
  return {
    resourceOrigin: bundle.artifacts.receipt.merchantOrigin,
    operations: [
      {
        operationId: bundle.artifacts.receipt.operationId,
        method: "POST",
        pathTemplate: "/v1/risk"
      }
    ],
    network: bundle.artifacts.receipt.network,
    asset: bundle.artifacts.receipt.asset,
    requiredAmountAtomic: bundle.artifacts.receipt.requiredAmountAtomic,
    payToWallet: bundle.artifacts.receipt.payToWallet,
    commissionBps: bundle.artifacts.receipt.commissionBps,
    payoutThresholdAtomic: "100000",
    startsAt: "2026-06-24T00:00:00Z",
    endsAt: null,
    ...overrides
  };
}

function signCampaignTerms(version: CampaignVersionRecord): string {
  return signEd25519Message(
    buildCampaignTermsSigningBytes(version.terms),
    MERCHANT_SEED
  ).signature;
}

function createRouteDraftInput(
  overrides: Partial<Parameters<PostgresRouteRegistry["createRouteDraft"]>[0]> = {}
): Parameters<PostgresRouteRegistry["createRouteDraft"]>[0] {
  const bundle = createSampleProtocolArtifacts();
  return {
    id: "rte_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    campaignId: bundle.artifacts.receipt.campaignId,
    campaignVersionMin: 1,
    referrerWallet: REFERRER_WALLET,
    payoutWallet: PAYOUT_WALLET,
    resourceOrigin: bundle.artifacts.receipt.merchantOrigin,
    operationIds: [bundle.artifacts.receipt.operationId],
    issuedAt: "2026-06-24T00:00:00Z",
    expiresAt: "2026-06-25T00:00:00Z",
    nonce: "route-nonce-postgres-0001",
    ...overrides
  };
}

function signRouteDraft(draft: RouteDraft): ReferralClaimV1 {
  return signUnsignedClaim(draft.claim);
}

function signUnsignedClaim(claim: UnsignedReferralClaim): ReferralClaimV1 {
  const signed = signEd25519Message(
    buildReferralClaimSigningBytes(claim),
    REFERRER_SEED
  );
  return {
    ...claim,
    signature: {
      type: "solana-ed25519",
      publicKey: signed.publicKey,
      value: signed.signature
    }
  };
}

class FakePostgresPool implements PostgresPool {
  readonly database = new FakePostgresDatabase();
  readonly client = new FakePostgresClient(this.database);

  async connect(): Promise<PostgresTransactionClient> {
    return this.client;
  }

  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<QueryResult<Row>> {
    return this.client.query<Row>(text, values);
  }
}

class FakePostgresClient implements PostgresTransactionClient {
  readonly commands: string[] = [];
  releaseCount = 0;
  rollbackCount = 0;

  constructor(private readonly database: FakePostgresDatabase) {}

  release(): void {
    this.releaseCount += 1;
  }

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<QueryResult<Row>> {
    const normalized = normalizeSql(text);
    this.commands.push(normalized);

    if (normalized === "begin") {
      return result([]);
    }
    if (normalized === "commit") {
      return result([]);
    }
    if (normalized === "rollback") {
      this.rollbackCount += 1;
      return result([]);
    }

    if (normalized.startsWith("insert into payment_receipts")) {
      this.database.insertReceipt(values);
      return result([]);
    }
    if (normalized.startsWith("insert into commission_accruals")) {
      this.database.insertAccrual(values);
      return result([]);
    }
    if (normalized.startsWith("insert into ledger_transactions")) {
      this.database.insertLedgerTransaction(values);
      return result([]);
    }
    if (normalized.startsWith("insert into ledger_entries")) {
      this.database.insertLedgerEntry(values);
      return result([]);
    }
    if (normalized.startsWith("insert into outbox_events")) {
      this.database.insertOutboxEvent(values);
      return result([]);
    }
    if (normalized.startsWith("insert into merchants")) {
      return result(this.database.insertMerchant(values) as unknown as Row[]);
    }
    if (normalized.startsWith("insert into merchant_origins")) {
      return result(this.database.insertMerchantOrigin(values) as unknown as Row[]);
    }
    if (normalized.startsWith("insert into merchant_keys")) {
      return result(this.database.insertMerchantKey(values) as unknown as Row[]);
    }
    if (normalized.startsWith("insert into campaigns")) {
      this.database.insertCampaign(values);
      return result([]);
    }
    if (normalized.startsWith("insert into campaign_versions")) {
      this.database.insertCampaignVersion(values);
      return result([]);
    }
    if (normalized.startsWith("insert into campaign_operations")) {
      this.database.insertCampaignOperation(values);
      return result([]);
    }
    if (normalized.startsWith("insert into routes")) {
      this.database.insertRoute(values);
      return result([]);
    }
    if (normalized.startsWith("insert into route_versions")) {
      this.database.insertRouteVersion(values);
      return result([]);
    }
    if (normalized.startsWith("insert into wallet_auth_challenges")) {
      this.database.insertWalletAuthChallenge(values);
      return result([]);
    }
    if (normalized.startsWith("insert into wallet_auth_sessions")) {
      this.database.insertWalletAuthSession(values);
      return result([]);
    }
    if (normalized.startsWith("insert into wallet_auth_refresh_tokens")) {
      this.database.insertWalletAuthRefreshToken(values);
      return result([]);
    }
    if (normalized.startsWith("update merchant_keys")) {
      return result(this.database.revokeMerchantKey(values) as unknown as Row[]);
    }
    if (normalized.startsWith("update campaign_versions")) {
      return commandResult(this.database.activateCampaignVersion(values));
    }
    if (
      normalized.startsWith("update routes") &&
      normalized.includes("set current_version")
    ) {
      return result(
        this.database.updateRouteCurrentVersion(values) as unknown as Row[]
      );
    }
    if (normalized.startsWith("update routes")) {
      return result(this.database.suspendRoute(values) as unknown as Row[]);
    }
    if (normalized.startsWith("update campaigns")) {
      this.database.updateCampaign(normalized, values);
      return result([]);
    }
    if (normalized.startsWith("update wallet_auth_challenges")) {
      return result(
        this.database.consumeWalletAuthChallenge(values) as unknown as Row[]
      );
    }
    if (normalized.startsWith("update wallet_auth_refresh_tokens")) {
      return result(
        this.database.revokeWalletAuthRefreshToken(values) as unknown as Row[]
      );
    }
    if (normalized.startsWith("update payment_receipts")) {
      this.database.markReceiptChainVerified(values);
      return result([]);
    }
    if (normalized.startsWith("update commission_accruals")) {
      this.database.markAccrualChainVerified(values);
      return result([]);
    }
    if (
      normalized.startsWith("update outbox_events") &&
      normalized.includes("attempts = attempts + 1")
    ) {
      return result(
        this.database.claimNextOutboxEvent(values) as unknown as Row[]
      );
    }
    if (
      normalized.startsWith("update outbox_events") &&
      normalized.includes("status = 'delivered'")
    ) {
      return result(
        this.database.markOutboxEventDelivered(values) as unknown as Row[]
      );
    }
    if (
      normalized.startsWith("update outbox_events") &&
      normalized.includes("status = $4")
    ) {
      return result(
        this.database.markOutboxEventFailed(values) as unknown as Row[]
      );
    }
    if (normalized.includes("from payment_receipts")) {
      return result(this.database.selectReceipt(normalized, values) as unknown as Row[]);
    }
    if (normalized.includes("from commission_accruals")) {
      return result(this.database.selectAccrual(values[0]) as unknown as Row[]);
    }
    if (normalized.includes("from ledger_transactions")) {
      return result(
        this.database.selectLedgerTransaction(values[0]) as unknown as Row[]
      );
    }
    if (normalized.includes("from ledger_entries")) {
      return result(this.database.selectLedgerEntries(values[0]) as unknown as Row[]);
    }
    if (normalized.includes("from merchants")) {
      return result(this.database.selectMerchant(normalized, values) as unknown as Row[]);
    }
    if (normalized.includes("from merchant_origins")) {
      return result(this.database.selectMerchantOrigins(values[0]) as unknown as Row[]);
    }
    if (normalized.includes("from merchant_keys")) {
      return result(
        this.database.selectMerchantKeys(normalized, values) as unknown as Row[]
      );
    }
    if (normalized.includes("from campaigns")) {
      return result(this.database.selectCampaign(values[0]) as unknown as Row[]);
    }
    if (normalized.includes("from campaign_versions")) {
      return result(
        this.database.selectCampaignVersion(values) as unknown as Row[]
      );
    }
    if (normalized.includes("from route_versions")) {
      return result(
        this.database.selectRouteVersions(normalized, values) as unknown as Row[]
      );
    }
    if (normalized.includes("from routes")) {
      return result(this.database.selectRoutes(normalized, values) as unknown as Row[]);
    }
    if (normalized.includes("from outbox_events")) {
      return result(
        this.database.selectOutboxEvent(values[0]) as unknown as Row[]
      );
    }
    if (normalized.includes("from wallet_auth_challenges")) {
      return result(
        this.database.selectWalletAuthChallenge(values[0]) as unknown as Row[]
      );
    }
    if (normalized.includes("from wallet_auth_sessions")) {
      return result(
        this.database.selectWalletAuthSession(values[0]) as unknown as Row[]
      );
    }
    if (normalized.includes("from wallet_auth_refresh_tokens")) {
      return result(
        this.database.selectWalletAuthRefreshToken(values[0]) as unknown as Row[]
      );
    }

    throw new Error(`unsupported query: ${normalized}`);
  }
}

class FakePostgresDatabase {
  receipts: StoredReceiptRow[] = [];
  accruals: StoredAccrualRow[] = [];
  ledgerTransactions: StoredLedgerTransactionRow[] = [];
  ledgerEntries: StoredLedgerEntryRow[] = [];
  outboxEvents: StoredOutboxEventRow[] = [];
  merchants: StoredMerchantRow[] = [];
  merchantOrigins: StoredMerchantOriginRow[] = [];
  merchantKeys: StoredMerchantKeyRow[] = [];
  campaigns: StoredCampaignRow[] = [];
  campaignVersions: StoredCampaignVersionRow[] = [];
  campaignOperations: StoredCampaignOperationRow[] = [];
  routes: StoredRouteRow[] = [];
  routeVersions: StoredRouteVersionRow[] = [];
  walletAuthChallenges: StoredWalletAuthChallengeRow[] = [];
  walletAuthSessions: StoredWalletAuthSessionRow[] = [];
  walletAuthRefreshTokens: StoredWalletAuthRefreshTokenRow[] = [];
  failNextInsertWithUniqueViolation = false;

  insertReceipt(values: readonly unknown[]): void {
    if (this.failNextInsertWithUniqueViolation) {
      this.failNextInsertWithUniqueViolation = false;
      throw Object.assign(new Error("duplicate key"), { code: "23505" });
    }

    this.receipts.push({
      id: readString(values[0]),
      receipt_hash: readString(values[1]) as `sha256:${string}`,
      merchant_id: readString(values[2]),
      campaign_id: readString(values[3]),
      campaign_version: readNumber(values[4]),
      payment_id: readString(values[5]),
      settlement_tx_signature: readString(values[6]),
      network: readString(values[7]),
      asset_mint: readString(values[8]),
      payer_wallet: readString(values[9]),
      pay_to_wallet: readString(values[10]),
      receipt_json: readString(values[11]),
      source: readString(values[12]),
      verification_state: readString(values[13]),
      ingestion_state: readString(values[14]),
      created_at: readString(values[15])
    });
  }

  insertAccrual(values: readonly unknown[]): void {
    this.accruals.push({
      id: readString(values[0]),
      receipt_id: readString(values[1]),
      merchant_id: readString(values[2]),
      campaign_id: readString(values[3]),
      route_id: readString(values[4]),
      referrer_wallet: readString(values[5]),
      payout_wallet: readString(values[6]),
      asset_mint: readString(values[7]),
      amount_atomic: readString(values[8]),
      status: readString(values[9]),
      available_at: null,
      created_at: readString(values[10])
    });
  }

  insertLedgerTransaction(values: readonly unknown[]): void {
    this.ledgerTransactions.push({
      id: readString(values[0]),
      source_type: readString(values[1]),
      source_id: readString(values[2]),
      asset_mint: readString(values[3]),
      created_at: readString(values[4])
    });
  }

  insertLedgerEntry(values: readonly unknown[]): void {
    this.ledgerEntries.push({
      id: readString(values[0]),
      transaction_id: readString(values[1]),
      account_type: readString(values[2]),
      account_reference: readString(values[3]),
      asset_mint: readString(values[4]),
      amount_atomic: readString(values[5]),
      created_at: "2026-06-24T00:02:00Z"
    });
  }

  insertOutboxEvent(values: readonly unknown[]): void {
    const row: StoredOutboxEventRow = {
      id: readString(values[0]),
      event_type: readString(values[1]),
      aggregate_type: readString(values[2]),
      aggregate_id: readString(values[3]),
      payload: readString(values[4]),
      status: readString(values[5]),
      attempts: readNumber(values[6]),
      available_at: readString(values[7]),
      locked_at: readNullableString(values[8]),
      last_error: readNullableString(values[9]),
      created_at: readString(values[10])
    };
    if (
      this.outboxEvents.some(
        (event) =>
          event.id === row.id ||
          (event.event_type === row.event_type &&
            event.aggregate_type === row.aggregate_type &&
            event.aggregate_id === row.aggregate_id)
      )
    ) {
      throw Object.assign(new Error("duplicate key"), { code: "23505" });
    }
    this.outboxEvents.push(row);
  }

  claimNextOutboxEvent(values: readonly unknown[]): StoredOutboxEventRow[] {
    const now = readString(values[0]);
    const eventTypes = readNullableStringArray(values[1]);
    const readyEvent = this.outboxEvents
      .filter(
        (event) =>
          event.status === "pending" &&
          Date.parse(event.available_at) <= Date.parse(now) &&
          (eventTypes === null || eventTypes.includes(event.event_type))
      )
      .sort(compareOutboxEvents)[0];
    if (readyEvent === undefined) {
      return [];
    }
    readyEvent.status = "processing";
    readyEvent.attempts += 1;
    readyEvent.locked_at = now;
    readyEvent.last_error = null;
    return [readyEvent];
  }

  markOutboxEventDelivered(values: readonly unknown[]): StoredOutboxEventRow[] {
    const event = this.outboxEvents.find(
      (row) => row.id === readString(values[0])
    );
    if (event === undefined || event.status !== "processing") {
      return [];
    }
    event.status = "delivered";
    event.locked_at = null;
    event.last_error = null;
    return [event];
  }

  markOutboxEventFailed(values: readonly unknown[]): StoredOutboxEventRow[] {
    const event = this.outboxEvents.find(
      (row) => row.id === readString(values[0])
    );
    if (event === undefined || event.status !== "processing") {
      return [];
    }
    event.last_error = readString(values[1]);
    event.available_at = readString(values[2]);
    event.status = readString(values[3]);
    event.locked_at = null;
    return [event];
  }

  selectOutboxEvent(eventId: unknown): StoredOutboxEventRow[] {
    const event = this.outboxEvents.find((row) => row.id === readString(eventId));
    return event === undefined ? [] : [event];
  }

  selectReceipt(
    normalizedSql: string,
    values: readonly unknown[]
  ): StoredReceiptRow[] {
    const value = readString(values[0]);
    const receipt = this.receipts.find((row) => {
      if (normalizedSql.includes("where id = $1")) {
        return row.id === value;
      }
      if (normalizedSql.includes("where receipt_hash = $1")) {
        return row.receipt_hash === value;
      }
      if (normalizedSql.includes("where payment_id = $1")) {
        return row.payment_id === value;
      }
      if (normalizedSql.includes("where settlement_tx_signature = $1")) {
        return row.settlement_tx_signature === value;
      }
      return false;
    });
    return receipt === undefined ? [] : [receipt];
  }

  selectAccrual(receiptId: unknown): StoredAccrualRow[] {
    const accrual = this.accruals.find(
      (row) => row.receipt_id === readString(receiptId)
    );
    return accrual === undefined ? [] : [accrual];
  }

  markReceiptChainVerified(values: readonly unknown[]): void {
    const receipt = this.receipts.find((row) => row.id === readString(values[0]));
    if (
      receipt !== undefined &&
      receipt.verification_state === "pending_chain_verification"
    ) {
      receipt.verification_state = "signature_verified";
    }
  }

  markAccrualChainVerified(values: readonly unknown[]): void {
    const accrual = this.accruals.find(
      (row) => row.receipt_id === readString(values[0])
    );
    if (
      accrual !== undefined &&
      accrual.status === "pending_chain_verification"
    ) {
      accrual.status = "available";
      accrual.available_at = readString(values[1]);
    }
  }

  selectLedgerTransaction(accrualId: unknown): StoredLedgerTransactionRow[] {
    const transaction = this.ledgerTransactions.find(
      (row) =>
        row.source_type === "commission_accrual" &&
        row.source_id === readString(accrualId)
    );
    return transaction === undefined ? [] : [transaction];
  }

  selectLedgerEntries(transactionId: unknown): StoredLedgerEntryRow[] {
    return this.ledgerEntries.filter(
      (row) => row.transaction_id === readString(transactionId)
    );
  }

  insertMerchant(values: readonly unknown[]): StoredMerchantRow[] {
    const row: StoredMerchantRow = {
      id: readString(values[0]),
      slug: readString(values[1]),
      display_name: readString(values[2]),
      owner_wallet: readString(values[3]),
      status: readString(values[4]),
      created_at: readString(values[5]),
      updated_at: readString(values[6])
    };
    if (
      this.merchants.some(
        (merchant) => merchant.id === row.id || merchant.slug === row.slug
      )
    ) {
      throw Object.assign(new Error("duplicate key"), { code: "23505" });
    }
    this.merchants.push(row);
    return [row];
  }

  insertMerchantOrigin(values: readonly unknown[]): StoredMerchantOriginRow[] {
    const row: StoredMerchantOriginRow = {
      merchant_id: readString(values[0]),
      origin: readString(values[1]),
      verification_method: readString(values[2]),
      status: readString(values[3]),
      verified_at: readNullableString(values[4]),
      created_at: readString(values[5])
    };
    if (
      this.merchantOrigins.some(
        (origin) =>
          origin.merchant_id === row.merchant_id && origin.origin === row.origin
      )
    ) {
      throw Object.assign(new Error("duplicate key"), { code: "23505" });
    }
    this.merchantOrigins.push(row);
    return [row];
  }

  insertMerchantKey(values: readonly unknown[]): StoredMerchantKeyRow[] {
    const row: StoredMerchantKeyRow = {
      merchant_id: readString(values[0]),
      kid: readString(values[1]),
      algorithm: readString(values[2]),
      public_key: readString(values[3]),
      purpose: readString(values[4]),
      valid_from: readString(values[5]),
      valid_until: readNullableString(values[6]),
      revoked_at: null,
      revocation_reason: null,
      created_at: readString(values[7])
    };
    if (this.merchantKeys.some((key) => key.kid === row.kid)) {
      throw Object.assign(new Error("duplicate key"), { code: "23505" });
    }
    this.merchantKeys.push(row);
    return [row];
  }

  revokeMerchantKey(values: readonly unknown[]): StoredMerchantKeyRow[] {
    const merchantId = readString(values[0]);
    const kid = readString(values[1]);
    const revokedAt = readString(values[2]);
    const reason = readNullableString(values[3]);
    const key = this.merchantKeys.find(
      (row) => row.merchant_id === merchantId && row.kid === kid
    );
    if (key === undefined) {
      return [];
    }
    key.revoked_at = revokedAt;
    key.revocation_reason = reason;
    return [key];
  }

  selectMerchant(
    normalizedSql: string,
    values: readonly unknown[]
  ): QueryResultRow[] {
    const merchantId = readString(values[0]);
    const merchant = this.merchants.find((row) => row.id === merchantId);
    if (merchant === undefined) {
      return [];
    }
    return normalizedSql.startsWith("select id from merchants")
      ? [{ id: merchant.id }]
      : [merchant];
  }

  selectMerchantOrigins(merchantId: unknown): StoredMerchantOriginRow[] {
    return this.merchantOrigins.filter(
      (row) => row.merchant_id === readString(merchantId)
    );
  }

  selectMerchantKeys(
    normalizedSql: string,
    values: readonly unknown[]
  ): StoredMerchantKeyRow[] {
    const merchantId = readString(values[0]);
    if (normalizedSql.includes("where merchant_id = $1 and kid = $2")) {
      const kid = readString(values[1]);
      const purpose = readString(values[2]);
      const at = Date.parse(readString(values[3]));
      return this.merchantKeys.filter((row) => {
        const validFrom = Date.parse(row.valid_from);
        const validUntil =
          row.valid_until === null ? undefined : Date.parse(row.valid_until);
        const revokedAt =
          row.revoked_at === null ? undefined : Date.parse(row.revoked_at);
        return (
          row.merchant_id === merchantId &&
          row.kid === kid &&
          row.purpose === purpose &&
          validFrom <= at &&
          (validUntil === undefined || validUntil > at) &&
          (revokedAt === undefined || revokedAt > at)
        );
      });
    }

    return this.merchantKeys.filter((row) => row.merchant_id === merchantId);
  }

  insertCampaign(values: readonly unknown[]): void {
    const row: StoredCampaignRow = {
      id: readString(values[0]),
      merchant_id: readString(values[1]),
      resource_origin: readString(values[2]),
      status: readString(values[3]),
      current_version: readNumber(values[4]),
      created_at: readString(values[5]),
      updated_at: readString(values[6])
    };
    if (this.campaigns.some((campaign) => campaign.id === row.id)) {
      throw Object.assign(new Error("duplicate key"), { code: "23505" });
    }
    this.campaigns.push(row);
  }

  insertCampaignVersion(values: readonly unknown[]): void {
    const row: StoredCampaignVersionRow = {
      campaign_id: readString(values[0]),
      version: readNumber(values[1]),
      terms_hash: readString(values[2]) as `sha256:${string}`,
      terms_json: readString(values[3]),
      signing_bytes_hex: readString(values[4]),
      network: readString(values[5]),
      asset_mint: readString(values[6]),
      commission_bps: readNumber(values[7]),
      protocol_fee_bps: readNumber(values[8]),
      payout_threshold_atomic: readString(values[9]),
      starts_at: readString(values[10]),
      ends_at: readNullableString(values[11]),
      merchant_kid: readNullableString(values[12]),
      merchant_signature: readNullableString(values[13]),
      activated_at: readNullableString(values[14]),
      created_at: readString(values[15])
    };
    if (
      this.campaignVersions.some(
        (version) =>
          version.campaign_id === row.campaign_id &&
          (version.version === row.version ||
            version.terms_hash === row.terms_hash)
      )
    ) {
      throw Object.assign(new Error("duplicate key"), { code: "23505" });
    }
    this.campaignVersions.push(row);
  }

  insertCampaignOperation(values: readonly unknown[]): void {
    const row: StoredCampaignOperationRow = {
      campaign_id: readString(values[0]),
      campaign_version: readNumber(values[1]),
      operation_id: readString(values[2]),
      method: readString(values[3]),
      path_template: readString(values[4]),
      input_schema: readNullableString(values[5])
    };
    if (
      this.campaignOperations.some(
        (operation) =>
          operation.campaign_id === row.campaign_id &&
          operation.campaign_version === row.campaign_version &&
          operation.operation_id === row.operation_id
      )
    ) {
      throw Object.assign(new Error("duplicate key"), { code: "23505" });
    }
    this.campaignOperations.push(row);
  }

  updateCampaign(normalizedSql: string, values: readonly unknown[]): void {
    const campaign = this.campaigns.find((row) => row.id === readString(values[0]));
    if (campaign === undefined) {
      return;
    }
    if (normalizedSql.includes("resource_origin = $2")) {
      campaign.resource_origin = readString(values[1]);
      campaign.status = "draft";
      campaign.current_version = readNumber(values[2]);
      campaign.updated_at = readString(values[3]);
      return;
    }
    campaign.status = "active";
    campaign.updated_at = readString(values[1]);
  }

  activateCampaignVersion(values: readonly unknown[]): number {
    const campaignId = readString(values[0]);
    const versionNumber = readNumber(values[1]);
    const version = this.campaignVersions.find(
      (row) => row.campaign_id === campaignId && row.version === versionNumber
    );
    if (version === undefined) {
      return 0;
    }
    if (
      version.merchant_kid !== null ||
      version.merchant_signature !== null ||
      version.activated_at !== null
    ) {
      return 0;
    }
    version.merchant_kid = readString(values[2]);
    version.merchant_signature = readString(values[3]);
    version.activated_at = readString(values[4]);
    return 1;
  }

  insertRoute(values: readonly unknown[]): void {
    const row: StoredRouteRow = {
      id: readString(values[0]),
      current_version: readNumber(values[1]),
      campaign_id: readString(values[2]),
      campaign_version_min: readNumber(values[3]),
      referrer_wallet: readString(values[4]),
      payout_wallet: readString(values[5]),
      resource_origin: readString(values[6]),
      operation_ids: readString(values[7]),
      claim_hash: readString(values[8]) as `sha256:${string}`,
      claim_json: readString(values[9]),
      signing_bytes_hex: readString(values[10]),
      status: readString(values[11]),
      issued_at: readString(values[12]),
      expires_at: readString(values[13]),
      nonce: readString(values[14]),
      metadata_hash: readNullableString(values[15]) as `sha256:${string}` | null,
      created_at: readString(values[16]),
      activated_at: readString(values[17])
    };
    if (
      this.routes.some(
        (route) => route.id === row.id || route.claim_hash === row.claim_hash
      )
    ) {
      throw Object.assign(new Error("duplicate key"), { code: "23505" });
    }
    this.routes.push(row);
  }

  insertRouteVersion(values: readonly unknown[]): void {
    const row: StoredRouteVersionRow = {
      route_id: readString(values[0]),
      version: readNumber(values[1]),
      campaign_version_min: readNumber(values[2]),
      payout_wallet: readString(values[3]),
      claim_hash: readString(values[4]) as `sha256:${string}`,
      claim_json: readString(values[5]),
      signing_bytes_hex: readString(values[6]),
      issued_at: readString(values[7]),
      expires_at: readString(values[8]),
      nonce: readString(values[9]),
      metadata_hash: readNullableString(values[10]) as `sha256:${string}` | null,
      created_at: readString(values[11])
    };
    if (
      this.routeVersions.some(
        (version) =>
          (version.route_id === row.route_id && version.version === row.version) ||
          version.claim_hash === row.claim_hash
      )
    ) {
      throw Object.assign(new Error("duplicate key"), { code: "23505" });
    }
    this.routeVersions.push(row);
  }

  selectCampaign(campaignId: unknown): StoredCampaignRow[] {
    const campaign = this.campaigns.find(
      (row) => row.id === readString(campaignId)
    );
    return campaign === undefined ? [] : [campaign];
  }

  selectCampaignVersion(values: readonly unknown[]): StoredCampaignVersionRow[] {
    const campaignId = readString(values[0]);
    const versionNumber = readNumber(values[1]);
    const version = this.campaignVersions.find(
      (row) => row.campaign_id === campaignId && row.version === versionNumber
    );
    return version === undefined ? [] : [version];
  }

  selectRoutes(
    normalizedSql: string,
    values: readonly unknown[]
  ): StoredRouteRow[] {
    const value = readString(values[0]);
    if (
      normalizedSql.includes("where id = $1") ||
      normalizedSql.includes("where claim_hash = $1")
    ) {
      const route = this.routes.find((row) => {
        if (normalizedSql.includes("where id = $1")) {
          return row.id === value;
        }
        if (normalizedSql.includes("where claim_hash = $1")) {
          return row.claim_hash === value;
        }
        return false;
      });
      return route === undefined ? [] : [route];
    }

    let valueIndex = 0;
    const status = readString(values[valueIndex++]);
    let routes = this.routes.filter((row) => row.status === status);
    if (normalizedSql.includes("expires_at >")) {
      const now = readString(values[valueIndex++]);
      routes = routes.filter((row) => Date.parse(row.expires_at) > Date.parse(now));
    }
    if (normalizedSql.includes("campaign_id =")) {
      const campaignId = readString(values[valueIndex++]);
      routes = routes.filter((row) => row.campaign_id === campaignId);
    }
    if (normalizedSql.includes("referrer_wallet =")) {
      const referrerWallet = readString(values[valueIndex++]);
      routes = routes.filter((row) => row.referrer_wallet === referrerWallet);
    }
    if (normalizedSql.includes("resource_origin =")) {
      const resourceOrigin = readString(values[valueIndex++]);
      routes = routes.filter((row) => row.resource_origin === resourceOrigin);
    }
    if (normalizedSql.includes("operation_ids ?")) {
      const operationId = readString(values[valueIndex++]);
      const wildcard = readString(values[valueIndex++]);
      routes = routes.filter((row) => {
        const operationIds = JSON.parse(row.operation_ids) as string[];
        return operationIds.includes(operationId) || operationIds.includes(wildcard);
      });
    }
    const limit = readNumber(values[valueIndex++]);
    return routes
      .sort((left, right) => {
        const createdAtComparison =
          Date.parse(right.created_at) - Date.parse(left.created_at);
        return createdAtComparison === 0
          ? right.id.localeCompare(left.id)
          : createdAtComparison;
      })
      .slice(0, limit);
  }

  selectRouteVersions(
    normalizedSql: string,
    values: readonly unknown[]
  ): StoredRouteVersionRow[] {
    if (normalizedSql.includes("where claim_hash = $1")) {
      const claimHash = readString(values[0]);
      const version = this.routeVersions.find((row) => row.claim_hash === claimHash);
      return version === undefined ? [] : [version];
    }
    const routeId = readString(values[0]);
    return this.routeVersions
      .filter((row) => row.route_id === routeId)
      .sort((left, right) => left.version - right.version);
  }

  updateRouteCurrentVersion(values: readonly unknown[]): StoredRouteRow[] {
    const route = this.routes.find((row) => row.id === readString(values[0]));
    if (route === undefined || route.current_version !== readNumber(values[11])) {
      return [];
    }
    route.current_version = readNumber(values[1]);
    route.campaign_version_min = readNumber(values[2]);
    route.payout_wallet = readString(values[3]);
    route.claim_hash = readString(values[4]) as `sha256:${string}`;
    route.claim_json = readString(values[5]);
    route.signing_bytes_hex = readString(values[6]);
    route.issued_at = readString(values[7]);
    route.expires_at = readString(values[8]);
    route.nonce = readString(values[9]);
    route.metadata_hash = readNullableString(values[10]) as `sha256:${string}` | null;
    return [route];
  }

  suspendRoute(values: readonly unknown[]): StoredRouteRow[] {
    const route = this.routes.find((row) => row.id === readString(values[0]));
    if (route === undefined || route.status !== "active") {
      return [];
    }
    route.status = "suspended";
    return [route];
  }

  insertWalletAuthChallenge(values: readonly unknown[]): void {
    this.walletAuthChallenges.push({
      id: readString(values[0]),
      wallet: readString(values[1]),
      network: readString(values[2]),
      purpose: readString(values[3]),
      nonce: readString(values[4]),
      message: readString(values[5]),
      expires_at: readString(values[6]),
      created_at: readString(values[7]),
      consumed_at: readNullableString(values[8])
    });
  }

  selectWalletAuthChallenge(challengeId: unknown): StoredWalletAuthChallengeRow[] {
    const challenge = this.walletAuthChallenges.find(
      (row) => row.id === readString(challengeId)
    );
    return challenge === undefined ? [] : [challenge];
  }

  consumeWalletAuthChallenge(values: readonly unknown[]): QueryResultRow[] {
    const challengeId = readString(values[0]);
    const consumedAt = readString(values[1]);
    const challenge = this.walletAuthChallenges.find(
      (row) => row.id === challengeId
    );
    if (challenge === undefined || challenge.consumed_at !== null) {
      return [];
    }
    challenge.consumed_at = consumedAt;
    return [{ id: challenge.id }];
  }

  insertWalletAuthSession(values: readonly unknown[]): void {
    this.walletAuthSessions.push({
      token_hash: readString(values[0]),
      session_id: readString(values[1]),
      wallet: readString(values[2]),
      network: readString(values[3]),
      purpose: readString(values[4]),
      challenge_id: readString(values[5]),
      issued_at: readString(values[6]),
      expires_at: readString(values[7])
    });
  }

  insertWalletAuthRefreshToken(values: readonly unknown[]): void {
    this.walletAuthRefreshTokens.push({
      token_hash: readString(values[0]),
      refresh_token_id: readString(values[1]),
      session_id: readString(values[2]),
      wallet: readString(values[3]),
      network: readString(values[4]),
      purpose: readString(values[5]),
      challenge_id: readString(values[6]),
      issued_at: readString(values[7]),
      expires_at: readString(values[8]),
      revoked_at: readNullableString(values[9]),
      replaced_by_session_id: readNullableString(values[10])
    });
  }

  selectWalletAuthSession(tokenHash: unknown): StoredWalletAuthSessionRow[] {
    const session = this.walletAuthSessions.find(
      (row) => row.token_hash === readString(tokenHash)
    );
    return session === undefined ? [] : [session];
  }

  selectWalletAuthRefreshToken(
    tokenHash: unknown
  ): StoredWalletAuthRefreshTokenRow[] {
    const refreshToken = this.walletAuthRefreshTokens.find(
      (row) => row.token_hash === readString(tokenHash)
    );
    return refreshToken === undefined ? [] : [refreshToken];
  }

  revokeWalletAuthRefreshToken(values: readonly unknown[]): QueryResultRow[] {
    const tokenHash = readString(values[0]);
    const revokedAt = readString(values[1]);
    const replacedBySessionId = readNullableString(values[2]);
    const refreshToken = this.walletAuthRefreshTokens.find(
      (row) => row.token_hash === tokenHash
    );
    if (refreshToken === undefined || refreshToken.revoked_at !== null) {
      return [];
    }
    refreshToken.revoked_at = revokedAt;
    refreshToken.replaced_by_session_id = replacedBySessionId;
    return [{ token_hash: refreshToken.token_hash }];
  }
}

type StoredReceiptRow = QueryResultRow & {
  id: string;
  receipt_hash: `sha256:${string}`;
  merchant_id: string;
  campaign_id: string;
  campaign_version: number;
  payment_id: string;
  settlement_tx_signature: string;
  network: string;
  asset_mint: string;
  payer_wallet: string;
  pay_to_wallet: string;
  receipt_json: string;
  source: string;
  verification_state: string;
  ingestion_state: string;
  created_at: string;
};

type StoredAccrualRow = QueryResultRow & {
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
  available_at: string | null;
  created_at: string;
};

type StoredLedgerTransactionRow = QueryResultRow & {
  id: string;
  source_type: string;
  source_id: string;
  asset_mint: string;
  created_at: string;
};

type StoredLedgerEntryRow = QueryResultRow & {
  id: string;
  transaction_id: string;
  account_type: string;
  account_reference: string;
  asset_mint: string;
  amount_atomic: string;
  created_at: string;
};

type StoredOutboxEventRow = QueryResultRow & {
  id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: string;
  status: string;
  attempts: number;
  available_at: string;
  locked_at: string | null;
  last_error: string | null;
  created_at: string;
};

type StoredMerchantRow = QueryResultRow & {
  id: string;
  slug?: string;
  display_name?: string;
  owner_wallet?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
};

type StoredMerchantOriginRow = QueryResultRow & {
  merchant_id: string;
  origin: string;
  verification_method: string;
  status: string;
  verified_at: string | null;
  created_at: string;
};

type StoredMerchantKeyRow = QueryResultRow & {
  merchant_id: string;
  kid: string;
  algorithm: string;
  public_key: string;
  purpose: string;
  valid_from: string;
  valid_until: string | null;
  revoked_at: string | null;
  revocation_reason: string | null;
  created_at: string;
};

type StoredCampaignRow = QueryResultRow & {
  id: string;
  merchant_id: string;
  resource_origin: string;
  status: string;
  current_version: number;
  created_at: string;
  updated_at: string;
};

type StoredCampaignVersionRow = QueryResultRow & {
  campaign_id: string;
  version: number;
  terms_hash: `sha256:${string}`;
  terms_json: string;
  signing_bytes_hex: string;
  network: string;
  asset_mint: string;
  commission_bps: number;
  protocol_fee_bps: number;
  payout_threshold_atomic: string;
  starts_at: string;
  ends_at: string | null;
  merchant_kid: string | null;
  merchant_signature: string | null;
  activated_at: string | null;
  created_at: string;
};

type StoredCampaignOperationRow = QueryResultRow & {
  campaign_id: string;
  campaign_version: number;
  operation_id: string;
  method: string;
  path_template: string;
  input_schema: string | null;
};

type StoredRouteRow = QueryResultRow & {
  id: string;
  current_version: number;
  campaign_id: string;
  campaign_version_min: number;
  referrer_wallet: string;
  payout_wallet: string;
  resource_origin: string;
  operation_ids: string;
  claim_hash: `sha256:${string}`;
  claim_json: string;
  signing_bytes_hex: string;
  status: string;
  issued_at: string;
  expires_at: string;
  nonce: string;
  metadata_hash: `sha256:${string}` | null;
  created_at: string;
  activated_at: string;
};

type StoredRouteVersionRow = QueryResultRow & {
  route_id: string;
  version: number;
  campaign_version_min: number;
  payout_wallet: string;
  claim_hash: `sha256:${string}`;
  claim_json: string;
  signing_bytes_hex: string;
  issued_at: string;
  expires_at: string;
  nonce: string;
  metadata_hash: `sha256:${string}` | null;
  created_at: string;
};

type StoredWalletAuthChallengeRow = QueryResultRow & {
  id: string;
  wallet: string;
  network: string;
  purpose: string;
  nonce: string;
  message: string;
  expires_at: string;
  created_at: string;
  consumed_at: string | null;
};

type StoredWalletAuthSessionRow = QueryResultRow & {
  token_hash: string;
  session_id: string;
  wallet: string;
  network: string;
  purpose: string;
  challenge_id: string;
  issued_at: string;
  expires_at: string;
};

type StoredWalletAuthRefreshTokenRow = QueryResultRow & {
  token_hash: string;
  refresh_token_id: string;
  session_id: string;
  wallet: string;
  network: string;
  purpose: string;
  challenge_id: string;
  issued_at: string;
  expires_at: string;
  revoked_at: string | null;
  replaced_by_session_id: string | null;
};

function result<Row extends QueryResultRow>(rows: Row[]): QueryResult<Row> {
  return {
    command: rows.length === 0 ? "INSERT" : "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows
  };
}

function commandResult<Row extends QueryResultRow>(rowCount: number): QueryResult<Row> {
  return {
    command: "UPDATE",
    rowCount,
    oid: 0,
    fields: [],
    rows: []
  };
}

function normalizeSql(text: string): string {
  return text.replace(/\s+/gu, " ").trim().toLowerCase();
}

function compareOutboxEvents(
  left: StoredOutboxEventRow,
  right: StoredOutboxEventRow
): number {
  return (
    Date.parse(left.available_at) - Date.parse(right.available_at) ||
    Date.parse(left.created_at) - Date.parse(right.created_at) ||
    left.id.localeCompare(right.id)
  );
}

function readString(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("expected string query value");
  }
  return value;
}

function readNumber(value: unknown): number {
  if (typeof value !== "number") {
    throw new Error("expected number query value");
  }
  return value;
}

function readNullableString(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  return readString(value);
}

function readNullableStringArray(value: unknown): string[] | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error("expected nullable string array query value");
  }
  return value;
}

function readJsonPayload(value: unknown): Record<string, unknown> {
  const payload = JSON.parse(readString(value));
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("expected object payload");
  }
  return payload as Record<string, unknown>;
}

function findOutboxEvent(
  events: StoredOutboxEventRow[],
  eventType: string
): StoredOutboxEventRow | undefined {
  return events.find((event) => event.event_type === eventType);
}
