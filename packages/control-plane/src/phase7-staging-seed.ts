import { fileURLToPath } from "node:url";

import {
  buildReferralClaimSigningBytes,
  deriveEd25519PublicKey,
  hashProtocolObject,
  hexToBytes,
  signEd25519Message,
  type ReferralClaimV1
} from "@split402/protocol";
import { Pool } from "pg";

import {
  buildCampaignTermsSigningBytes,
  createCampaignVersionRecord,
  type CampaignProfile,
  type CampaignTermsInput
} from "./campaigns.js";
import { readControlPlaneMigrationPoolConfig } from "./migrate.js";
import {
  PostgresCampaignRegistry,
  PostgresMerchantRegistry,
  PostgresRouteRegistry,
  type PostgresQueryExecutor
} from "./postgres.js";
import type { RouteDraft, RouteRecord, UnsignedReferralClaim } from "./routes.js";

const REQUIRED_CONFIRMATION = "seed-hosted-staging";
const DEFAULT_SERVICE_SEED_HEX =
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const DEFAULT_REFERRER_SEED_HEX =
  "202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f";
const DEFAULT_PAYOUT_SEED_HEX =
  "404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f";
const DEFAULT_OWNER_SEED_HEX =
  "a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf";
const DEFAULT_PAY_TO_SEED_HEX =
  "808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f";

const DEFAULT_MERCHANT_ID = "mrc_00000000000000000000000000000001";
const DEFAULT_CAMPAIGN_ID = "cmp_00000000000000000000000000000002";
const DEFAULT_ROUTE_ID = "rte_00000000000000000000000000000003";
const DEFAULT_PAYOUT_WALLET_ID = "mpw_00000000000000000000000000000007";
const DEFAULT_NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const DEFAULT_DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const DEFAULT_OPERATION_ID = "wallet-risk-score";
const DEFAULT_MERCHANT_ORIGIN = "http://localhost:4023";
const DEFAULT_ROUTE_ISSUED_AT = "2026-06-28T00:00:00Z";
const DEFAULT_ROUTE_EXPIRES_AT = "2026-12-31T00:00:00Z";
const DEFAULT_CAMPAIGN_STARTS_AT = "2026-06-28T00:00:00Z";

export interface Phase7StagingSeedConfig {
  confirmed: boolean;
  merchantId: string;
  campaignId: string;
  routeId: string;
  payoutWalletId: string;
  merchantSlug: string;
  merchantDisplayName: string;
  merchantOrigin: string;
  ownerWallet: string;
  serviceKid: string;
  serviceSeed: Uint8Array;
  servicePublicKey: string;
  referrerSeed: Uint8Array;
  referrerWallet: string;
  payoutSeed: Uint8Array;
  payoutWallet: string;
  payoutSignerReference: string;
  network: string;
  asset: string;
  payToWallet: string;
  requiredAmountAtomic: string;
  commissionBps: number;
  protocolFeeBpsOfCommission: number;
  payoutThresholdAtomic: string;
  routeIssuedAt: string;
  routeExpiresAt: string;
  campaignStartsAt: string;
  campaignEndsAt: string | null;
  now: string;
}

export interface Phase7StagingSeedResult {
  schema: "split402.phase7_staging_seed.v1";
  merchantId: string;
  campaignId: string;
  routeId: string;
  merchantOrigin: string;
  servicePublicKey: string;
  referrerWallet: string;
  payoutWallet: string;
  payToWallet: string;
  network: string;
  asset: string;
  requiredAmountAtomic: string;
  commissionBps: number;
  protocolFeeBpsOfCommission: number;
  campaignTermsHash: string;
  referralClaimHash: string;
  proofEnv: Record<string, string>;
  notes: string[];
}

export function readPhase7StagingSeedConfig(
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date()
): Phase7StagingSeedConfig {
  const confirmed = env.SPLIT402_PHASE7_SEED_CONFIRM === REQUIRED_CONFIRMATION;
  const serviceSeed = readSeedHex(
    env.SPLIT402_SERVICE_SEED_HEX ?? DEFAULT_SERVICE_SEED_HEX,
    "SPLIT402_SERVICE_SEED_HEX"
  );
  const referrerSeed = readSeedHex(
    env.SPLIT402_REFERRER_SEED_HEX ?? DEFAULT_REFERRER_SEED_HEX,
    "SPLIT402_REFERRER_SEED_HEX"
  );
  const payoutSeed = readSeedHex(
    env.SPLIT402_PAYOUT_SEED_HEX ?? DEFAULT_PAYOUT_SEED_HEX,
    "SPLIT402_PAYOUT_SEED_HEX"
  );
  const ownerWallet =
    readOptionalString(env.SPLIT402_PHASE7_OWNER_WALLET) ??
    deriveEd25519PublicKey(
      readSeedHex(
        env.SPLIT402_PHASE7_OWNER_SEED_HEX ?? DEFAULT_OWNER_SEED_HEX,
        "SPLIT402_PHASE7_OWNER_SEED_HEX"
      )
    );
  const payToWallet =
    readOptionalString(env.SPLIT402_MERCHANT_PAY_TO) ??
    deriveEd25519PublicKey(
      readSeedHex(
        env.SPLIT402_PHASE7_PAY_TO_SEED_HEX ?? DEFAULT_PAY_TO_SEED_HEX,
        "SPLIT402_PHASE7_PAY_TO_SEED_HEX"
      )
    );

  return {
    confirmed,
    merchantId: readOptionalString(env.SPLIT402_PHASE7_MERCHANT_ID) ?? DEFAULT_MERCHANT_ID,
    campaignId: readOptionalString(env.SPLIT402_PHASE7_CAMPAIGN_ID) ?? DEFAULT_CAMPAIGN_ID,
    routeId: readOptionalString(env.SPLIT402_PHASE7_ROUTE_ID) ?? DEFAULT_ROUTE_ID,
    payoutWalletId:
      readOptionalString(env.SPLIT402_PHASE7_PAYOUT_WALLET_ID) ??
      DEFAULT_PAYOUT_WALLET_ID,
    merchantSlug:
      readOptionalString(env.SPLIT402_PHASE7_MERCHANT_SLUG) ?? "phase7-demo-merchant",
    merchantDisplayName:
      readOptionalString(env.SPLIT402_PHASE7_MERCHANT_DISPLAY_NAME) ??
      "Split402 Phase 7 Demo Merchant",
    merchantOrigin:
      readOptionalString(env.SPLIT402_PHASE7_MERCHANT_ORIGIN) ??
      readOptionalString(env.SPLIT402_MERCHANT_ORIGIN) ??
      DEFAULT_MERCHANT_ORIGIN,
    ownerWallet,
    serviceKid: readOptionalString(env.SPLIT402_PHASE7_SERVICE_KID) ?? "kid_demo_merchant_1",
    serviceSeed,
    servicePublicKey: deriveEd25519PublicKey(serviceSeed),
    referrerSeed,
    referrerWallet: deriveEd25519PublicKey(referrerSeed),
    payoutSeed,
    payoutWallet: deriveEd25519PublicKey(payoutSeed),
    payoutSignerReference:
      readOptionalString(env.SPLIT402_PHASE7_PAYOUT_SIGNER_REFERENCE) ??
      "phase7:staging-demo",
    network: readOptionalString(env.SPLIT402_NETWORK) ?? DEFAULT_NETWORK,
    asset: readOptionalString(env.SPLIT402_ASSET) ?? DEFAULT_DEVNET_USDC,
    payToWallet,
    requiredAmountAtomic:
      readOptionalString(env.SPLIT402_REQUIRED_AMOUNT_ATOMIC) ?? "10000",
    commissionBps: readBasisPoints(env.SPLIT402_COMMISSION_BPS ?? "1000", "SPLIT402_COMMISSION_BPS"),
    protocolFeeBpsOfCommission: readBasisPoints(
      env.SPLIT402_PROTOCOL_FEE_BPS_OF_COMMISSION ?? "1000",
      "SPLIT402_PROTOCOL_FEE_BPS_OF_COMMISSION"
    ),
    payoutThresholdAtomic:
      readOptionalString(env.SPLIT402_PHASE7_PAYOUT_THRESHOLD_ATOMIC) ?? "1",
    routeIssuedAt:
      readOptionalString(env.SPLIT402_PHASE7_ROUTE_ISSUED_AT) ??
      DEFAULT_ROUTE_ISSUED_AT,
    routeExpiresAt:
      readOptionalString(env.SPLIT402_PHASE7_ROUTE_EXPIRES_AT) ??
      DEFAULT_ROUTE_EXPIRES_AT,
    campaignStartsAt:
      readOptionalString(env.SPLIT402_PHASE7_CAMPAIGN_STARTS_AT) ??
      DEFAULT_CAMPAIGN_STARTS_AT,
    campaignEndsAt:
      readOptionalString(env.SPLIT402_PHASE7_CAMPAIGN_ENDS_AT) ?? null,
    now: now.toISOString()
  };
}

export async function runPhase7StagingSeed(
  db: PostgresQueryExecutor,
  config: Phase7StagingSeedConfig
): Promise<Phase7StagingSeedResult> {
  if (!config.confirmed) {
    throw new Error(
      `SPLIT402_PHASE7_SEED_CONFIRM must be ${REQUIRED_CONFIRMATION} to seed hosted staging`
    );
  }

  await ensureOperatorMerchant(db, config);
  await ensureOperatorOrigin(db, config);
  await ensureOperatorKey(db, config);
  await ensureOperatorPayoutWallet(db, config);

  const campaignRegistry = new PostgresCampaignRegistry(db, {
    now: () => new Date(config.now)
  });
  const routeRegistry = new PostgresRouteRegistry(db, {
    now: () => new Date(config.now)
  });
  const campaign = await ensureCampaign(campaignRegistry, config);
  const route = await ensureRoute(routeRegistry, config);

  return {
    schema: "split402.phase7_staging_seed.v1",
    merchantId: config.merchantId,
    campaignId: config.campaignId,
    routeId: config.routeId,
    merchantOrigin: config.merchantOrigin,
    servicePublicKey: config.servicePublicKey,
    referrerWallet: config.referrerWallet,
    payoutWallet: config.payoutWallet,
    payToWallet: config.payToWallet,
    network: config.network,
    asset: config.asset,
    requiredAmountAtomic: config.requiredAmountAtomic,
    commissionBps: config.commissionBps,
    protocolFeeBpsOfCommission: config.protocolFeeBpsOfCommission,
    campaignTermsHash: campaign.current.termsHash,
    referralClaimHash: route.claimHash,
    proofEnv: {
      SPLIT402_PHASE7_MERCHANT_ID: config.merchantId,
      SPLIT402_PHASE7_REFERRER_WALLET: config.referrerWallet,
      SPLIT402_DASHBOARD_MERCHANT_ID: config.merchantId,
      SPLIT402_DASHBOARD_REFERRER_WALLET: config.referrerWallet,
      SPLIT402_MCP_CAPABILITY: "solana.wallet-risk",
      SPLIT402_MCP_WALLET: config.referrerWallet,
      SPLIT402_MCP_MAX_AMOUNT_ATOMIC: config.requiredAmountAtomic,
      SPLIT402_MERCHANT_ORIGIN: config.merchantOrigin,
      SPLIT402_MERCHANT_PUBLIC_KEY: config.servicePublicKey
    },
    notes: [
      "Operator-only staging seed; this is not a public self-approval endpoint.",
      "Use only for Devnet/public-alpha hosted proof preparation.",
      "Production and mainnet readiness still require Phase 6 custody approval."
    ]
  };
}

async function ensureOperatorMerchant(
  db: PostgresQueryExecutor,
  config: Phase7StagingSeedConfig
): Promise<void> {
  const registry = new PostgresMerchantRegistry(db, {
    now: () => new Date(config.now)
  });
  const existing = await registry.getMerchantProfile(config.merchantId);
  if (existing === undefined) {
    await registry.createMerchant({
      id: config.merchantId,
      slug: config.merchantSlug,
      displayName: config.merchantDisplayName,
      ownerWallet: config.ownerWallet,
      status: "active"
    });
    return;
  }
  if (
    existing.slug !== config.merchantSlug ||
    existing.ownerWallet !== config.ownerWallet
  ) {
    throw new Error(`existing merchant ${config.merchantId} does not match seed config`);
  }
  if (existing.status === "active") {
    return;
  }
  if (existing.status !== "pending") {
    throw new Error(
      `existing merchant ${config.merchantId} has unsafe status ${existing.status}`
    );
  }
  await db.query(
    `update merchants
        set status = 'active',
            display_name = $2,
            updated_at = $3
      where id = $1
        and status = 'pending'`,
    [config.merchantId, config.merchantDisplayName, config.now]
  );
}

async function ensureOperatorOrigin(
  db: PostgresQueryExecutor,
  config: Phase7StagingSeedConfig
): Promise<void> {
  const registry = new PostgresMerchantRegistry(db, {
    now: () => new Date(config.now)
  });
  const profile = await registry.getMerchantProfile(config.merchantId);
  const existing = profile?.origins.find((origin) => origin.origin === config.merchantOrigin);
  if (existing === undefined) {
    await registry.addOrigin({
      merchantId: config.merchantId,
      origin: config.merchantOrigin,
      status: "verified",
      verifiedAt: config.now
    });
    return;
  }
  if (existing.status === "verified") {
    return;
  }
  if (existing.status === "revoked") {
    throw new Error(`existing origin ${config.merchantOrigin} is revoked`);
  }
  await db.query(
    `update merchant_origins
        set status = 'verified',
            verified_at = $3
      where merchant_id = $1
        and origin = $2
        and status in ('pending', 'failed')`,
    [config.merchantId, config.merchantOrigin, config.now]
  );
}

async function ensureOperatorKey(
  db: PostgresQueryExecutor,
  config: Phase7StagingSeedConfig
): Promise<void> {
  const registry = new PostgresMerchantRegistry(db, {
    now: () => new Date(config.now)
  });
  const profile = await registry.getMerchantProfile(config.merchantId);
  const existing = profile?.keys.find((key) => key.kid === config.serviceKid);
  if (existing === undefined) {
    await registry.addKey({
      merchantId: config.merchantId,
      kid: config.serviceKid,
      publicKey: config.servicePublicKey,
      validFrom: config.campaignStartsAt
    });
    return;
  }
  if (
    existing.publicKey !== config.servicePublicKey ||
    existing.purpose !== "offer_receipt" ||
    existing.revokedAt !== undefined
  ) {
    throw new Error(`existing merchant key ${config.serviceKid} is not usable for seed`);
  }
}

async function ensureOperatorPayoutWallet(
  db: PostgresQueryExecutor,
  config: Phase7StagingSeedConfig
): Promise<void> {
  const registry = new PostgresMerchantRegistry(db, {
    now: () => new Date(config.now)
  });
  const profile = await registry.getMerchantProfile(config.merchantId);
  const existing = profile?.payoutWallets.find((wallet) => wallet.id === config.payoutWalletId);
  if (existing === undefined) {
    await registry.addPayoutWallet({
      id: config.payoutWalletId,
      merchantId: config.merchantId,
      network: config.network,
      wallet: config.payToWallet,
      asset: config.asset,
      signerReference: config.payoutSignerReference,
      status: "active"
    });
    return;
  }
  if (
    existing.network !== config.network ||
    existing.wallet !== config.payToWallet ||
    existing.asset !== config.asset
  ) {
    throw new Error(`existing payout wallet ${config.payoutWalletId} does not match seed config`);
  }
  if (existing.status === "active") {
    return;
  }
  if (existing.status === "retired") {
    throw new Error(`existing payout wallet ${config.payoutWalletId} is retired`);
  }
  await db.query(
    `update merchant_payout_wallets
        set status = 'active'
      where id = $1
        and status = 'paused'`,
    [config.payoutWalletId]
  );
}

async function ensureCampaign(
  registry: PostgresCampaignRegistry,
  config: Phase7StagingSeedConfig
): Promise<CampaignProfile> {
  const termsInput = createCampaignTermsInput(config);
  const expectedVersion = createCampaignVersionRecord(
    { id: config.campaignId, merchantId: config.merchantId },
    1,
    termsInput,
    config.now
  );
  let campaign = await registry.getCampaign(config.campaignId);
  if (campaign === undefined) {
    campaign = await registry.createCampaign({
      id: config.campaignId,
      merchantId: config.merchantId,
      ...termsInput
    });
  }
  if (campaign.current.termsHash !== expectedVersion.termsHash) {
    throw new Error(
      `existing campaign ${config.campaignId} terms do not match staging seed`
    );
  }
  if (campaign.status === "closed" || campaign.status === "paused") {
    throw new Error(`existing campaign ${config.campaignId} has unsafe status ${campaign.status}`);
  }
  const signature = signEd25519Message(
    buildCampaignTermsSigningBytes(campaign.current.terms),
    config.serviceSeed
  );
  return registry.activateCampaignVersion({
    campaignId: config.campaignId,
    merchantKid: config.serviceKid,
    merchantPublicKey: config.servicePublicKey,
    merchantSignature: signature.signature
  });
}

async function ensureRoute(
  registry: PostgresRouteRegistry,
  config: Phase7StagingSeedConfig
): Promise<RouteRecord> {
  const existing = await registry.getRoute(config.routeId);
  if (existing !== undefined) {
    if (
      existing.campaignId !== config.campaignId ||
      existing.referrerWallet !== config.referrerWallet ||
      existing.payoutWallet !== config.payoutWallet ||
      existing.resourceOrigin !== config.merchantOrigin ||
      existing.status !== "active"
    ) {
      throw new Error(`existing route ${config.routeId} does not match staging seed`);
    }
    return existing;
  }

  const draft = registry.createRouteDraft({
    id: config.routeId,
    campaignId: config.campaignId,
    campaignVersionMin: 1,
    referrerWallet: config.referrerWallet,
    payoutWallet: config.payoutWallet,
    resourceOrigin: config.merchantOrigin,
    operationIds: [DEFAULT_OPERATION_ID],
    issuedAt: config.routeIssuedAt,
    expiresAt: config.routeExpiresAt,
    nonce: "phase7-staging-route-0001",
    metadataHash: hashProtocolObject({ label: "Split402 Phase 7 staging route" })
  });
  return registry.activateRoute({ claim: signRouteDraft(draft, config.referrerSeed) });
}

function createCampaignTermsInput(config: Phase7StagingSeedConfig): CampaignTermsInput {
  return {
    resourceOrigin: config.merchantOrigin,
    operations: [
      {
        operationId: DEFAULT_OPERATION_ID,
        method: "POST",
        pathTemplate: "/v1/risk"
      }
    ],
    network: config.network,
    asset: config.asset,
    requiredAmountAtomic: config.requiredAmountAtomic,
    payToWallet: config.payToWallet,
    commissionBps: config.commissionBps,
    protocolFeeBpsOfCommission: config.protocolFeeBpsOfCommission,
    commissionBase: "required_amount",
    attributionRequired: false,
    allowSelfReferral: false,
    payoutThresholdAtomic: config.payoutThresholdAtomic,
    startsAt: config.campaignStartsAt,
    endsAt: config.campaignEndsAt
  };
}

function signRouteDraft(draft: RouteDraft, seed: Uint8Array): ReferralClaimV1 {
  const claim = draft.claim satisfies UnsignedReferralClaim;
  const signed = signEd25519Message(buildReferralClaimSigningBytes(claim), seed);
  return {
    ...claim,
    signature: {
      type: "solana-ed25519",
      publicKey: signed.publicKey,
      value: signed.signature
    }
  };
}

function readOptionalString(value: string | undefined): string | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  return value.trim();
}

function readSeedHex(value: string, label: string): Uint8Array {
  const trimmed = value.trim();
  if (!/^[0-9a-f]{64}$/iu.test(trimmed)) {
    throw new Error(`${label} must be 32 seed bytes encoded as 64 hex characters`);
  }
  return hexToBytes(trimmed);
}

function readBasisPoints(value: string, label: string): number {
  if (!/^[0-9]+$/u.test(value)) {
    throw new Error(`${label} must be an integer from 0 to 10000`);
  }
  const parsed = Number.parseInt(value, 10);
  if (parsed < 0 || parsed > 10_000) {
    throw new Error(`${label} must be an integer from 0 to 10000`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const config = readPhase7StagingSeedConfig();
  if (!config.confirmed) {
    throw new Error(
      `SPLIT402_PHASE7_SEED_CONFIRM must be ${REQUIRED_CONFIRMATION} to seed hosted staging`
    );
  }
  const pool = new Pool(readControlPlaneMigrationPoolConfig());
  try {
    const result = await runPhase7StagingSeed(pool, config);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
