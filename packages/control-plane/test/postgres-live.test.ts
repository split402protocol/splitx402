import {
  buildReferralClaimSigningBytes,
  createSampleProtocolArtifacts,
  deriveEd25519PublicKey,
  hexToBytes,
  signEd25519Message,
  type ReferralClaimV1,
  type Split402ReceiptV1
} from "@split402/protocol";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  applyControlPlaneMigrations,
  buildCampaignTermsSigningBytes,
  createMerchantReceiptKeyResolver,
  loadControlPlaneMigrations,
  PostgresCampaignRegistry,
  PostgresMerchantRegistry,
  PostgresOutboxEventStore,
  PostgresReceiptIngestionStore,
  PostgresRouteRegistry,
  PostgresWalletAuthStore,
  ReceiptIngestor,
  WalletAuthenticator,
  type ControlPlaneMigration,
  type ControlPlaneMigrationResult,
  type CampaignTermsInput,
  type CampaignVersionRecord,
  type RouteDraft,
  type UnsignedReferralClaim
} from "../src/index.js";

const DATABASE_URL = process.env.SPLIT402_TEST_DATABASE_URL;
const describeLive = DATABASE_URL === undefined ? describe.skip : describe;
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
const OWNER_WALLET = deriveEd25519PublicKey(OWNER_SEED);
const REFERRER_WALLET = deriveEd25519PublicKey(REFERRER_SEED);
const PAYOUT_WALLET = deriveEd25519PublicKey(PAYOUT_SEED);

describeLive("live PostgreSQL control-plane persistence", () => {
  const schema = `split402_live_${Date.now().toString(16)}`;
  let adminPool: Pool;
  let pool: Pool;
  let migrations: ControlPlaneMigration[];
  let firstMigrationRun: ControlPlaneMigrationResult[];

  beforeAll(async () => {
    adminPool = new Pool({ connectionString: DATABASE_URL });
    await adminPool.query(`create schema ${quoteIdentifier(schema)}`);
    pool = new Pool({
      connectionString: DATABASE_URL,
      options: `-c search_path=${schema}`
    });
    migrations = await loadControlPlaneMigrations();
    firstMigrationRun = await applyControlPlaneMigrations(pool, migrations);
  }, 30_000);

  afterAll(async () => {
    await pool?.end();
    if (adminPool !== undefined) {
      await adminPool.query(`drop schema if exists ${quoteIdentifier(schema)} cascade`);
      await adminPool.end();
    }
  }, 30_000);

  it("applies packaged migrations once and tracks checksums", async () => {
    const secondRun = await applyControlPlaneMigrations(pool, migrations);
    const recorded = await pool.query<{ name: string; checksum: string }>(
      `select name, checksum
         from split402_migrations
        order by name`
    );

    expect(firstMigrationRun.map((result) => result.status)).toEqual(
      migrations.map(() => "applied")
    );
    expect(secondRun.map((result) => result.status)).toEqual(
      migrations.map(() => "skipped")
    );
    expect(recorded.rows.map((row) => row.name)).toEqual(
      migrations.map((migration) => migration.name)
    );
    expect(recorded.rows.every((row) => /^sha256:[0-9a-f]{64}$/u.test(row.checksum)))
      .toBe(true);
  }, 30_000);

  it("persists merchant, campaign, auth, receipt, accrual, and ledger rows", async () => {
    const bundle = createSampleProtocolArtifacts();
    const merchantRegistry = new PostgresMerchantRegistry(pool, {
      now: () => new Date("2026-06-24T00:00:00Z")
    });
    const campaignRegistry = new PostgresCampaignRegistry(pool, {
      now: () => new Date("2026-06-24T00:00:00Z")
    });
    const routeRegistry = new PostgresRouteRegistry(pool, {
      now: () => new Date("2026-06-24T00:00:00Z")
    });
    const outboxStore = new PostgresOutboxEventStore(pool);
    const receiptStore = new PostgresReceiptIngestionStore(pool);
    const authenticator = createAuthenticator(pool);
    const ingestor = new ReceiptIngestor(receiptStore, {
      resolveMerchantPublicKey: createMerchantReceiptKeyResolver(merchantRegistry),
      now: () => new Date("2026-06-24T00:02:00Z")
    });

    await merchantRegistry.createMerchant({
      id: bundle.artifacts.receipt.merchantId,
      slug: "live-demo-merchant",
      displayName: "Live Demo Merchant",
      ownerWallet: OWNER_WALLET,
      status: "active"
    });
    await merchantRegistry.addOrigin({
      merchantId: bundle.artifacts.receipt.merchantId,
      origin: bundle.artifacts.receipt.merchantOrigin,
      status: "verified",
      verifiedAt: "2026-06-24T00:00:00Z"
    });
    await merchantRegistry.addKey({
      merchantId: bundle.artifacts.receipt.merchantId,
      kid: bundle.artifacts.receipt.kid,
      publicKey: bundle.keys.merchantPublicKey,
      validFrom: "2026-06-24T00:00:00Z"
    });
    const merchantPayoutWallet = await merchantRegistry.addPayoutWallet({
      id: "mpw_ffffffffffffffffffffffffffffffff",
      merchantId: bundle.artifacts.receipt.merchantId,
      network: bundle.artifacts.receipt.network,
      wallet: bundle.keys.payToWallet,
      asset: bundle.artifacts.receipt.asset,
      signerReference: "kms:split402-devnet-payout"
    });

    const campaign = await campaignRegistry.createCampaign({
      id: bundle.artifacts.receipt.campaignId,
      merchantId: bundle.artifacts.receipt.merchantId,
      ...createCampaignTerms(bundle.artifacts.receipt)
    });
    const signature = signCampaignTerms(campaign.current);
    const activatedCampaign = await campaignRegistry.activateCampaignVersion({
      campaignId: campaign.id,
      merchantKid: bundle.artifacts.receipt.kid,
      merchantPublicKey: bundle.keys.merchantPublicKey,
      merchantSignature: signature
    });
    const receiptRouteId = bundle.artifacts.receipt.routeId;
    if (receiptRouteId === undefined) {
      throw new Error("sample receipt is missing a route id");
    }
    const routeDraft = routeRegistry.createRouteDraft({
      id: receiptRouteId,
      campaignId: campaign.id,
      campaignVersionMin: 1,
      referrerWallet: REFERRER_WALLET,
      payoutWallet: PAYOUT_WALLET,
      resourceOrigin: bundle.artifacts.receipt.merchantOrigin,
      operationIds: [bundle.artifacts.receipt.operationId],
      issuedAt: "2026-06-24T00:00:00Z",
      expiresAt: "2026-06-25T00:00:00Z",
      nonce: "live-route-nonce-0001"
    });
    const activatedRoute = await routeRegistry.activateRoute({
      claim: signRouteDraft(routeDraft)
    });
    const loadedRoute = await routeRegistry.getRoute(activatedRoute.id);

    const challenge = await authenticator.createChallenge({
      wallet: OWNER_WALLET,
      network: bundle.artifacts.receipt.network
    });
    const authSignature = signEd25519Message(
      new TextEncoder().encode(challenge.message),
      OWNER_SEED
    ).signature;
    const session = await authenticator.createSession({
      challengeId: challenge.challengeId,
      signature: authSignature,
      publicKey: OWNER_WALLET
    });

    const ingestion = await ingestor.ingest({
      receipt: bundle.artifacts.receipt,
      source: "merchant"
    });
    const duplicate = await ingestor.ingest({
      receipt: bundle.artifacts.receipt,
      source: "buyer"
    });
    const claimedOutboxEvent = await outboxStore.claimNext({
      now: "2026-06-24T00:03:00Z",
      eventTypes: ["receipt.accepted.v1"]
    });
    if (claimedOutboxEvent === undefined) {
      throw new Error("expected a ready outbox event");
    }
    const verifiedSnapshot = await receiptStore.markReceiptChainVerified({
      receiptId: bundle.artifacts.receipt.receiptId,
      verifiedAt: "2026-06-24T00:04:00Z"
    });
    const deliveredOutboxEvent = await outboxStore.markDelivered({
      eventId: claimedOutboxEvent.id
    });
    if (ingestion.status !== "created") {
      throw new Error(`expected created ingestion, got ${ingestion.status}`);
    }

    expect(activatedCampaign.status).toBe("active");
    expect(loadedRoute?.claimHash).toBe(activatedRoute.claimHash);
    expect(session.wallet).toBe(OWNER_WALLET);
    expect(ingestion.accrual?.amountAtomic).toBe("2000");
    expect(ingestion.ledgerTransaction?.entries).toHaveLength(3);
    expect(duplicate.status).toBe("duplicate");
    expect(claimedOutboxEvent.status).toBe("processing");
    expect(claimedOutboxEvent.attempts).toBe(1);
    expect(verifiedSnapshot?.receipt.verificationState).toBe("signature_verified");
    expect(verifiedSnapshot?.accrual?.status).toBe("available");
    expect(verifiedSnapshot?.accrual?.availableAt).toBe("2026-06-24T00:04:00Z");
    if (verifiedSnapshot?.accrual === undefined) {
      throw new Error("expected verified accrual");
    }
    const payoutBatch = await receiptStore.createPayoutBatch({
      merchantId: bundle.artifacts.receipt.merchantId,
      payoutWalletId: merchantPayoutWallet.id,
      network: bundle.artifacts.receipt.network,
      asset: bundle.artifacts.receipt.asset,
      accruals: [verifiedSnapshot.accrual],
      batchId: "pbt_ffffffffffffffffffffffffffffffff",
      itemIdFactory: () => "pit_ffffffffffffffffffffffffffffffff",
      now: "2026-06-24T00:05:00Z"
    });
    const loadedPayoutBatch = await receiptStore.getPayoutBatch(payoutBatch.id);
    const counts = await readTableCounts(pool, [
      "merchants",
      "merchant_origins",
      "merchant_keys",
      "merchant_payout_wallets",
      "payout_batches",
      "payout_items",
      "payout_allocations",
      "campaigns",
      "campaign_versions",
      "campaign_operations",
      "routes",
      "route_versions",
      "wallet_auth_challenges",
      "wallet_auth_sessions",
      "wallet_auth_refresh_tokens",
      "payment_receipts",
      "commission_accruals",
      "ledger_transactions",
      "ledger_entries",
      "outbox_events"
    ]);
    expect(deliveredOutboxEvent?.status).toBe("delivered");
    expect(loadedPayoutBatch?.status).toBe("planned");
    expect(counts).toEqual({
      merchants: 1,
      merchant_origins: 1,
      merchant_keys: 1,
      merchant_payout_wallets: 1,
      payout_batches: 1,
      payout_items: 1,
      payout_allocations: 1,
      campaigns: 1,
      campaign_versions: 1,
      campaign_operations: 1,
      routes: 1,
      route_versions: 1,
      wallet_auth_challenges: 1,
      wallet_auth_sessions: 1,
      wallet_auth_refresh_tokens: 1,
      payment_receipts: 1,
      commission_accruals: 1,
      ledger_transactions: 1,
      ledger_entries: 3,
      outbox_events: 2
    });
  }, 30_000);
});

function createAuthenticator(pool: Pool): WalletAuthenticator {
  let sequence = 0;
  return new WalletAuthenticator(new PostgresWalletAuthStore(pool), {
    now: () => new Date("2026-06-24T00:00:00Z"),
    challengeIdFactory: () => nextAuthId("chl", ++sequence),
    sessionIdFactory: () => nextAuthId("ses", ++sequence),
    refreshTokenIdFactory: () => nextAuthId("rft", ++sequence),
    nonceFactory: () => `live-nonce-${sequence}`,
    accessTokenFactory: () => `live-postgres-token-${sequence}`,
    refreshTokenFactory: () => `live-postgres-refresh-token-${sequence}`
  });
}

function createCampaignTerms(receipt: Split402ReceiptV1): CampaignTermsInput {
  return {
    resourceOrigin: receipt.merchantOrigin,
    operations: [
      {
        operationId: receipt.operationId,
        method: "POST",
        pathTemplate: "/v1/risk"
      }
    ],
    network: receipt.network,
    asset: receipt.asset,
    requiredAmountAtomic: receipt.requiredAmountAtomic,
    payToWallet: receipt.payToWallet,
    commissionBps: receipt.commissionBps,
    payoutThresholdAtomic: "100000",
    startsAt: "2026-06-24T00:00:00Z",
    endsAt: null
  };
}

function signCampaignTerms(version: CampaignVersionRecord): string {
  return signEd25519Message(
    buildCampaignTermsSigningBytes(version.terms),
    MERCHANT_SEED
  ).signature;
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

function nextAuthId(prefix: "chl" | "ses" | "rft", sequence: number): string {
  return `${prefix}_${sequence.toString(16).padStart(32, "0")}`;
}

async function readTableCounts(
  pool: Pool,
  tables: readonly string[]
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const result = await pool.query<{ count: string }>(
      `select count(*)::text as count from ${quoteIdentifier(table)}`
    );
    counts[table] = Number.parseInt(result.rows[0]?.count ?? "0", 10);
  }
  return counts;
}

function quoteIdentifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/u.test(value)) {
    throw new Error(`unsafe SQL identifier: ${value}`);
  }
  return `"${value}"`;
}
