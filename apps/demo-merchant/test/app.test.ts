import { decodePaymentRequiredHeader } from "@x402/core/http";
import type { FacilitatorClient } from "@x402/core/server";
import request from "supertest";
import { describe, expect, it } from "vitest";

import {
  SOLANA_MAINNET_NETWORK_ID,
  SOLANA_MAINNET_USDC_MINT,
  base58Encode
} from "@split402/protocol";

import {
  CAMPAIGN_ID,
  DEFAULT_DEVNET_USDC,
  MAINNET_DEMO_CONFIRMATION,
  MERCHANT_ID,
  OPERATION_ID,
  SOLANA_DEVNET,
  createDemoMerchantApp
} from "../src/app.js";

const DEFAULT_TEST_CONFIG = {
  merchantOrigin: "http://localhost:4021",
  paymentAsset: DEFAULT_DEVNET_USDC,
  requiredAmountAtomic: "10000",
  commissionBps: 2000
};

describe("Split402 demo merchant", () => {
  it("exposes root metadata", async () => {
    const { app } = createDemoMerchantApp({
      ...DEFAULT_TEST_CONFIG,
      syncFacilitator: false
    });

    await request(app)
      .get("/")
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          name: "Split402 Public Alpha Merchant",
          health: "/health",
          discovery: "/.well-known/split402.json",
          paidRoutes: ["POST /v1/risk"]
        });
      });
  });

  it("exposes health with merchant and campaign defaults", async () => {
    const { app, merchantPayTo, servicePublicKey } = createDemoMerchantApp({
      ...DEFAULT_TEST_CONFIG,
      syncFacilitator: false
    });

    await request(app)
      .get("/health")
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          ok: true,
          merchantId: MERCHANT_ID,
          merchantOrigin: "http://localhost:4021",
          merchantPayTo,
          paymentAsset: DEFAULT_DEVNET_USDC,
          requiredAmountAtomic: "10000",
          commissionBps: 2000,
          split402ServicePublicKey: servicePublicKey,
          receipts: 0
        });
      });
  });

  it("publishes Split402 discovery metadata", async () => {
    const { app, merchantPayTo, servicePublicKey } = createDemoMerchantApp({
      ...DEFAULT_TEST_CONFIG,
      syncFacilitator: false
    });

    await request(app)
      .get("/.well-known/split402.json")
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          protocol: "split402",
          version: "0.1-public-alpha",
          merchantId: MERCHANT_ID,
          merchantOrigin: "http://localhost:4021",
          servicePublicKey,
          settlementMode: "accrual"
        });
        expect(body.routes[0]).toMatchObject({
          method: "POST",
          path: "/v1/risk",
          operationId: OPERATION_ID,
          campaignId: CAMPAIGN_ID,
          campaignVersion: 1,
          network: SOLANA_DEVNET,
          asset: DEFAULT_DEVNET_USDC,
          requiredAmountAtomic: "10000",
          commissionBps: 2000,
          payToWallet: merchantPayTo
        });
      });
  });

  it("exposes an empty receipt debug list before paid calls", async () => {
    const { app } = createDemoMerchantApp({
      ...DEFAULT_TEST_CONFIG,
      syncFacilitator: false
    });

    await request(app)
      .get("/debug/receipts")
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({ receipts: [] });
      });
  });

  it("returns an x402 challenge with Split402 offer metadata for unpaid risk requests", async () => {
    const { app } = createDemoMerchantApp({
      ...DEFAULT_TEST_CONFIG,
      facilitatorClient: createSupportedFacilitatorClient()
    });

    await request(app)
      .post("/v1/risk")
      .send({ wallet: "Wallet111" })
      .expect(402)
      .expect(({ headers }) => {
        expect(headers["payment-required"]).toBeTypeOf("string");
        const paymentRequired = decodePaymentRequiredHeader(headers["payment-required"] as string);
        expect(paymentRequired.accepts[0]).toMatchObject({
          scheme: "exact",
          network: SOLANA_DEVNET,
          payTo: expect.any(String)
        });
        expect(paymentRequired.extensions?.split402).toBeDefined();
      });
  });

  it("refuses mainnet with demo defaults and no canary acknowledgement", () => {
    expect(() =>
      createDemoMerchantApp({
        merchantOrigin: "http://localhost:4021",
        requiredAmountAtomic: "10000",
        commissionBps: 2000,
        network: "solana:mainnet",
        syncFacilitator: false
      })
    ).toThrow(/refusing to start the demo merchant on Solana Mainnet/u);
  });

  it("refuses mainnet amounts above the canary gross cap", () => {
    expect(() =>
      createDemoMerchantApp({
        ...mainnetGuardOverrides(),
        requiredAmountAtomic: "100001"
      })
    ).toThrow(/canary cap/u);
  });

  it("serves mainnet offers when every canary guard is satisfied", async () => {
    const { app, config, merchantPayTo } = createDemoMerchantApp({
      ...mainnetGuardOverrides(),
      syncFacilitator: true,
      facilitatorClient: createSupportedFacilitatorClient(SOLANA_MAINNET_NETWORK_ID)
    });

    expect(config.network.networkId).toBe(SOLANA_MAINNET_NETWORK_ID);
    expect(config.paymentAsset).toBe(SOLANA_MAINNET_USDC_MINT);
    expect(merchantPayTo).toBe(MAINNET_TEST_PAY_TO);

    await request(app)
      .get("/health")
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          ok: true,
          network: SOLANA_MAINNET_NETWORK_ID,
          networkLabel: "Solana Mainnet",
          paymentAsset: SOLANA_MAINNET_USDC_MINT
        });
      });

    await request(app)
      .post("/v1/risk")
      .send({ wallet: "Wallet111" })
      .expect(402)
      .expect(({ headers }) => {
        const paymentRequired = decodePaymentRequiredHeader(headers["payment-required"] as string);
        expect(paymentRequired.accepts[0]).toMatchObject({
          scheme: "exact",
          network: SOLANA_MAINNET_NETWORK_ID,
          asset: SOLANA_MAINNET_USDC_MINT
        });
      });
  });
});

const MAINNET_TEST_PAY_TO = base58Encode(new Uint8Array(32).fill(9));

function mainnetGuardOverrides() {
  return {
    merchantOrigin: "http://localhost:4021",
    requiredAmountAtomic: "10000",
    commissionBps: 2000,
    network: "solana:mainnet",
    mainnetCanaryConfirmation: MAINNET_DEMO_CONFIRMATION,
    serviceSeed: new Uint8Array(32).fill(7),
    merchantPayTo: MAINNET_TEST_PAY_TO,
    syncFacilitator: false
  };
}

function createSupportedFacilitatorClient(
  network: `${string}:${string}` = SOLANA_DEVNET
): FacilitatorClient {
  return {
    async getSupported() {
      return {
        kinds: [
          {
            x402Version: 2,
            scheme: "exact",
            network
          }
        ],
        extensions: [],
        signers: {}
      };
    },
    async verify() {
      throw new Error("Unexpected facilitator verify call in unpaid request test");
    },
    async settle() {
      throw new Error("Unexpected facilitator settle call in unpaid request test");
    }
  };
}
