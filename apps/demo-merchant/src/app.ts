import "./env.js";

import express from "express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type { FacilitatorClient, RoutesConfig } from "@x402/core/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { split402RequestContext } from "@split402/express";
import {
  base58Encode,
  deriveEd25519PublicKey,
  hashProtocolObject,
  hexToBytes,
  type Split402ReceiptV1
} from "@split402/protocol";
import {
  createSplit402ResourceServerExtension,
  declareSplit402,
  type Split402CampaignConfig
} from "@split402/x402-extension";

export const SOLANA_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
export const DEFAULT_DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const DEFAULT_SERVICE_SEED_HEX =
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
export const DEFAULT_PAY_TO = base58Encode(
  hexToBytes("808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f")
);

export const MERCHANT_ID = "mrc_00000000000000000000000000000001";
export const CAMPAIGN_ID = "cmp_00000000000000000000000000000002";
export const OPERATION_ID = "wallet-risk-score";

export interface DemoMerchantConfig {
  merchantOrigin: string;
  paymentAsset: string;
  requiredAmountAtomic: string;
  commissionBps: number;
  serviceSeed: Uint8Array;
  syncFacilitator: boolean;
  facilitatorUrl: string;
  receipts: Split402ReceiptV1[];
}

export interface DemoMerchantRuntime {
  app: express.Express;
  config: DemoMerchantConfig;
  servicePublicKey: string;
  merchantPayTo: string;
}

export interface DemoMerchantOptions extends Partial<DemoMerchantConfig> {
  facilitatorClient?: FacilitatorClient;
}

export function createDemoMerchantApp(
  overrides: DemoMerchantOptions = {}
): DemoMerchantRuntime {
  const config = readDemoMerchantConfig(overrides);
  const servicePublicKey = deriveEd25519PublicKey(config.serviceSeed);
  const merchantPayTo = readMerchantPayTo();
  const campaign = createCampaign(config, merchantPayTo);
  const routes = createRoutes(config, merchantPayTo);
  const facilitator =
    overrides.facilitatorClient ??
    new HTTPFacilitatorClient({
      url: config.facilitatorUrl
    });
  const split402Extension = createSplit402ResourceServerExtension({
    merchantId: MERCHANT_ID,
    merchantOrigin: config.merchantOrigin,
    servicePrivateSeed: config.serviceSeed,
    serviceKid: "kid_demo_merchant_1",
    resolveCampaign: () => campaign,
    receiptSink: (receipt: Split402ReceiptV1) => {
      config.receipts.push(receipt);
    }
  });
  const x402Server = new x402ResourceServer(facilitator)
    .register(SOLANA_DEVNET, new ExactSvmScheme())
    .registerExtension(split402Extension);

  const app = express();
  app.use(express.json({ limit: "64kb" }));

  app.get("/", (_req, res) => {
    res.json({
      name: "Split402 Public Alpha Merchant",
      description: "x402-paid demo API with signed Split402 referral receipts.",
      health: "/health",
      discovery: "/.well-known/split402.json",
      paidRoutes: ["POST /v1/risk"]
    });
  });

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      merchantId: MERCHANT_ID,
      merchantOrigin: config.merchantOrigin,
      merchantPayTo,
      paymentAsset: config.paymentAsset,
      requiredAmountAtomic: config.requiredAmountAtomic,
      commissionBps: config.commissionBps,
      split402ServicePublicKey: servicePublicKey,
      receipts: config.receipts.length
    });
  });

  app.get("/.well-known/split402.json", (_req, res) => {
    res.json({
      protocol: "split402",
      version: "0.1-public-alpha",
      merchantId: MERCHANT_ID,
      merchantOrigin: config.merchantOrigin,
      servicePublicKey,
      settlementMode: "accrual",
      routes: [
        {
          method: "POST",
          path: "/v1/risk",
          operationId: OPERATION_ID,
          campaignId: CAMPAIGN_ID,
          campaignVersion: 1,
          network: SOLANA_DEVNET,
          asset: config.paymentAsset,
          requiredAmountAtomic: config.requiredAmountAtomic,
          commissionBps: config.commissionBps,
          payToWallet: merchantPayTo
        }
      ],
      sdk: {
        package: "@split402/agent-sdk",
        client: "Split402AgentClient"
      }
    });
  });

  app.get("/debug/receipts", (_req, res) => {
    res.json({ receipts: config.receipts });
  });

  app.use(split402RequestContext("/v1/risk"));
  app.use(
    paymentMiddleware(routes, x402Server, undefined, undefined, config.syncFacilitator)
  );

  app.post("/v1/risk", (req, res) => {
    const wallet = readWallet(req.body);
    res.json({
      wallet,
      riskScore: riskScore(wallet),
      labels: ["demo", "x402-paid", "split402-attributed"],
      merchantId: MERCHANT_ID
    });
  });

  return {
    app,
    config,
    servicePublicKey,
    merchantPayTo
  };
}

export function readDemoMerchantPort(): number {
  return Number.parseInt(process.env.PORT ?? "4021", 10);
}

function readDemoMerchantConfig(
  overrides: Partial<DemoMerchantConfig>
): DemoMerchantConfig {
  const serviceSeed =
    overrides.serviceSeed ??
    hexToBytes(process.env.SPLIT402_SERVICE_SEED_HEX ?? DEFAULT_SERVICE_SEED_HEX);
  return {
    merchantOrigin:
      overrides.merchantOrigin ??
      readMerchantOrigin(),
    paymentAsset:
      overrides.paymentAsset ?? process.env.SPLIT402_ASSET ?? DEFAULT_DEVNET_USDC,
    requiredAmountAtomic:
      overrides.requiredAmountAtomic ??
      process.env.SPLIT402_REQUIRED_AMOUNT_ATOMIC ??
      "10000",
    commissionBps:
      overrides.commissionBps ??
      readCommissionBps(process.env.SPLIT402_COMMISSION_BPS ?? "2000"),
    serviceSeed,
    syncFacilitator:
      overrides.syncFacilitator ??
      process.env.SPLIT402_SYNC_FACILITATOR !== "false",
    facilitatorUrl:
      overrides.facilitatorUrl ??
      process.env.X402_FACILITATOR_URL ??
      "https://x402.org/facilitator",
    receipts: overrides.receipts ?? []
  };
}

function readMerchantOrigin(): string {
  if (process.env.SPLIT402_MERCHANT_ORIGIN !== undefined) {
    return process.env.SPLIT402_MERCHANT_ORIGIN;
  }
  if (process.env.VERCEL_URL !== undefined) {
    return `https://${process.env.VERCEL_URL}`;
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL !== undefined) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return "http://localhost:4021";
}

function createCampaign(
  config: DemoMerchantConfig,
  merchantPayTo: string
): Split402CampaignConfig {
  return {
    campaignId: CAMPAIGN_ID,
    campaignVersion: 1,
    campaignTermsHash: hashProtocolObject({
      protocolVersion: "0.1",
      campaignId: CAMPAIGN_ID,
      campaignVersion: 1,
      merchantId: MERCHANT_ID,
      resourceOrigin: config.merchantOrigin,
      operationIds: [OPERATION_ID],
      network: SOLANA_DEVNET,
      asset: config.paymentAsset,
      requiredAmountAtomic: config.requiredAmountAtomic,
      payToWallet: merchantPayTo,
      commissionBps: config.commissionBps,
      commissionBase: "required_amount",
      settlementMode: "accrual"
    }),
    commissionBps: config.commissionBps,
    attributionRequired: false,
    allowSelfReferral: false
  };
}

function createRoutes(
  config: DemoMerchantConfig,
  merchantPayTo: string
): RoutesConfig {
  return {
    "POST /v1/risk": {
      accepts: [
        {
          scheme: "exact",
          network: SOLANA_DEVNET,
          price: {
            asset: config.paymentAsset,
            amount: config.requiredAmountAtomic
          },
          payTo: merchantPayTo
        }
      ],
      description: "Demo wallet risk score",
      mimeType: "application/json",
      extensions: declareSplit402({
        campaignId: CAMPAIGN_ID,
        operationId: OPERATION_ID
      })
    }
  };
}

function readMerchantPayTo(): string {
  return process.env.SPLIT402_MERCHANT_PAY_TO ?? DEFAULT_PAY_TO;
}

function readCommissionBps(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10_000) {
    throw new Error("SPLIT402_COMMISSION_BPS must be an integer from 0 to 10000");
  }
  return parsed;
}

function readWallet(body: unknown): string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return "unknown";
  }
  const wallet = (body as Record<string, unknown>).wallet;
  return typeof wallet === "string" ? wallet : "unknown";
}

function riskScore(wallet: string): number {
  let score = 17;
  for (const char of wallet) {
    score = (score * 31 + char.charCodeAt(0)) % 100;
  }
  return score;
}
