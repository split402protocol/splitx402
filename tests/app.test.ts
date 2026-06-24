import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { encodePaymentSignatureHeader, decodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentPayload, PaymentRequired } from "@x402/core/types";
import {
  declarePaymentIdentifierExtension,
  PAYMENT_IDENTIFIER,
} from "@x402/extensions/payment-identifier";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AppConfig } from "../src/config.js";
import { loadConfig } from "../src/config.js";
import { createApp } from "../src/server.js";

let dataDir: string;
let config: AppConfig;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "splitx402-test-"));
  config = loadConfig({
    NODE_ENV: "test",
    PORT: "4021",
    LOG_LEVEL: "silent",
    SPLITX402_PAYMENT_MODE: "mock",
    SPLITX402_NETWORK: "eip155:84532",
    SPLITX402_ASSET: "USDC",
    SPLITX402_PRICE_USD: "0.001",
    SPLITX402_PAY_TO: "0x0000000000000000000000000000000000000000",
    SPLITX402_FACILITATOR_URL: "https://x402.org/facilitator",
    SPLITX402_SYNC_FACILITATOR: "false",
    SPLITX402_RESOURCE_BASE_URL: "http://localhost:4021",
    SPLITX402_DATA_DIR: dataDir,
  });
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("SplitX402 Phase 1 service", () => {
  it("returns health status", async () => {
    const { app } = createApp(config);

    await request(app)
      .get("/v1/health")
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          status: "ok",
          service: "splitx402",
          phase: "phase-1",
          paymentMode: "mock",
        });
      });
  });

  it("returns an x402 payment challenge for unpaid paid-demo requests", async () => {
    const { app } = createApp(config);

    await request(app)
      .get("/v1/paid-demo")
      .expect(402)
      .expect(({ body, headers }) => {
        expect(body.error).toBe("payment_required");
        expect(headers["payment-required"]).toBeTypeOf("string");

        const paymentRequired = decodePaymentRequiredHeader(headers["payment-required"] as string);
        expect(paymentRequired.x402Version).toBe(2);
        expect(paymentRequired.accepts[0]).toMatchObject({
          scheme: "exact",
          network: "eip155:84532",
          amount: "1000",
          payTo: "0x0000000000000000000000000000000000000000",
        });
        expect(paymentRequired.extensions?.[PAYMENT_IDENTIFIER]).toMatchObject({
          info: { required: true },
        });
      });
  });

  it("exposes service discovery metadata", async () => {
    const { app } = createApp(config);

    await request(app)
      .get("/.well-known/splitx402.json")
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          protocol: "splitx402",
          version: "0.1-phase-1",
          settlementMode: "mock",
        });
        expect(body.routes[0]).toMatchObject({
          method: "GET",
          path: "/v1/paid-demo",
          paymentIdentifierRequired: true,
        });
      });
  });

  it("rejects invalid payment signatures", async () => {
    const { app } = createApp(config);

    await request(app)
      .get("/v1/paid-demo")
      .set("PAYMENT-SIGNATURE", "not-valid-base64")
      .expect(402)
      .expect(({ body }) => {
        expect(body.reason).toBe("invalid_payment_signature");
      });
  });

  it("accepts a mock paid request and records settlement", async () => {
    const { app, store } = createApp(config);
    const challenge = await request(app).get("/v1/paid-demo").expect(402);
    const paymentRequired = decodePaymentRequiredHeader(
      challenge.headers["payment-required"] as string,
    ) as PaymentRequired;
    const paymentId = "pay_1234567890abcdef";

    const paymentPayload: PaymentPayload = {
      x402Version: 2,
      resource: paymentRequired.resource,
      accepted: firstAccept(paymentRequired),
      payload: {
        payer: "0x1111111111111111111111111111111111111111",
      },
      extensions: {
        [PAYMENT_IDENTIFIER]: {
          ...declarePaymentIdentifierExtension(true),
          info: {
            required: true,
            id: paymentId,
          },
        },
      },
    };

    await request(app)
      .get("/v1/paid-demo")
      .set("PAYMENT-SIGNATURE", encodePaymentSignatureHeader(paymentPayload))
      .expect(200)
      .expect(({ body, headers }) => {
        expect(headers["payment-response"]).toBeTypeOf("string");
        expect(body).toMatchObject({
          ok: true,
          paymentId,
          settlementStatus: "mock-settled",
        });
      });

    await expect(store.findByPaymentId(paymentId)).resolves.toMatchObject({
      paymentId,
      status: "mock-settled",
      amount: "1000",
      network: "eip155:84532",
      transaction: `mock:${paymentId}`,
    });
  });

  it("exposes recorded payment settlement by payment id", async () => {
    const { app } = createApp(config);
    const challenge = await request(app).get("/v1/paid-demo").expect(402);
    const paymentRequired = decodePaymentRequiredHeader(challenge.headers["payment-required"] as string);
    const paymentId = "pay_abcdef1234567890";
    const paymentPayload: PaymentPayload = {
      x402Version: 2,
      resource: paymentRequired.resource,
      accepted: firstAccept(paymentRequired),
      payload: {},
      extensions: {
        [PAYMENT_IDENTIFIER]: {
          ...declarePaymentIdentifierExtension(true),
          info: {
            required: true,
            id: paymentId,
          },
        },
      },
    };

    await request(app)
      .get("/v1/paid-demo")
      .set("PAYMENT-SIGNATURE", encodePaymentSignatureHeader(paymentPayload))
      .expect(200);

    await request(app)
      .get(`/v1/payments/${paymentId}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.payment).toMatchObject({
          paymentId,
          status: "mock-settled",
        });
      });
  });
});

function firstAccept(paymentRequired: PaymentRequired) {
  const accepted = paymentRequired.accepts[0];
  expect(accepted).toBeDefined();
  return accepted!;
}
