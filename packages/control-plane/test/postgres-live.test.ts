import {
  createSampleProtocolArtifacts,
  deriveEd25519PublicKey,
  hexToBytes,
  signEd25519Message,
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
  PostgresReceiptIngestionStore,
  PostgresWalletAuthStore,
  ReceiptIngestor,
  WalletAuthenticator,
  type ControlPlaneMigration,
  type ControlPlaneMigrationResult,
  type CampaignTermsInput,
  type CampaignVersionRecord
} from "../src/index.js";

const DATABASE_URL = process.env.SPLIT402_TEST_DATABASE_URL;
const describeLive = DATABASE_URL === undefined ? describe.skip : describe;
const OWNER_SEED = hexToBytes(
  "a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf"
);
const MERCHANT_SEED = hexToBytes(
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
);
const OWNER_WALLET = deriveEd25519PublicKey(OWNER_SEED);

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
    const authenticator = createAuthenticator(pool);
    const ingestor = new ReceiptIngestor(new PostgresReceiptIngestionStore(pool), {
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
    const counts = await readTableCounts(pool, [
      "merchants",
      "merchant_origins",
      "merchant_keys",
      "campaigns",
      "campaign_versions",
      "campaign_operations",
      "wallet_auth_challenges",
      "wallet_auth_sessions",
      "payment_receipts",
      "commission_accruals",
      "ledger_transactions",
      "ledger_entries"
    ]);

    if (ingestion.status !== "created") {
      throw new Error(`expected created ingestion, got ${ingestion.status}`);
    }

    expect(activatedCampaign.status).toBe("active");
    expect(session.wallet).toBe(OWNER_WALLET);
    expect(ingestion.accrual?.amountAtomic).toBe("2000");
    expect(ingestion.ledgerTransaction?.entries).toHaveLength(3);
    expect(duplicate.status).toBe("duplicate");
    expect(counts).toEqual({
      merchants: 1,
      merchant_origins: 1,
      merchant_keys: 1,
      campaigns: 1,
      campaign_versions: 1,
      campaign_operations: 1,
      wallet_auth_challenges: 1,
      wallet_auth_sessions: 1,
      payment_receipts: 1,
      commission_accruals: 1,
      ledger_transactions: 1,
      ledger_entries: 3
    });
  }, 30_000);
});

function createAuthenticator(pool: Pool): WalletAuthenticator {
  let sequence = 0;
  return new WalletAuthenticator(new PostgresWalletAuthStore(pool), {
    now: () => new Date("2026-06-24T00:00:00Z"),
    challengeIdFactory: () => nextAuthId("chl", ++sequence),
    sessionIdFactory: () => nextAuthId("ses", ++sequence),
    nonceFactory: () => `live-nonce-${sequence}`,
    accessTokenFactory: () => `live-postgres-token-${sequence}`
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

function nextAuthId(prefix: "chl" | "ses", sequence: number): string {
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
