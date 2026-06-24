import { createSampleProtocolArtifacts } from "@split402/protocol";
import request from "supertest";
import { describe, expect, it } from "vitest";

import {
  InMemoryMerchantRegistry,
  InMemoryReceiptIngestionStore,
  ReceiptIngestor,
  createControlPlaneApp
} from "../src/index.js";

describe("control-plane HTTP API", () => {
  it("exposes a Phase 4 health endpoint", async () => {
    const { app } = createTestApp();

    const response = await request(app).get("/v1/health").expect(200);

    expect(response.body).toEqual({
      status: "ok",
      service: "split402-control-plane",
      phase: "phase-4"
    });
  });

  it("accepts a public receipt submission", async () => {
    const { app, store, receipt } = createTestApp();

    const response = await request(app)
      .post("/v1/receipts")
      .send({
        receipt,
        source: "buyer"
      })
      .expect(201);

    expect(response.body).toEqual(
      expect.objectContaining({
        status: "created",
        statusCode: 201
      })
    );
    expect(response.body.receipt).toEqual(
      expect.objectContaining({
        id: receipt.receiptId,
        source: "buyer",
        verificationState: "pending_chain_verification"
      })
    );
    expect(response.body.accrual).toEqual(
      expect.objectContaining({
        receiptId: receipt.receiptId,
        amountAtomic: "2000"
      })
    );
    expect(store.listAccruals()).toHaveLength(1);
  });

  it("returns duplicate instead of creating a second accrual", async () => {
    const { app, store, receipt } = createTestApp();

    await request(app).post("/v1/receipts").send({ receipt }).expect(201);
    const response = await request(app)
      .post("/v1/receipts")
      .send({ receipt })
      .expect(200);

    expect(response.body.status).toBe("duplicate");
    expect(store.listAccruals()).toHaveLength(1);
  });

  it("rejects malformed receipt submission envelopes", async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post("/v1/receipts")
      .send({ source: "buyer" })
      .expect(400);

    expect(response.body).toEqual({
      status: "rejected",
      errors: ["request body must include receipt"]
    });
  });

  it("rejects invalid receipt source values", async () => {
    const { app, receipt } = createTestApp();

    const response = await request(app)
      .post("/v1/receipts")
      .send({
        receipt,
        source: "partner"
      })
      .expect(400);

    expect(response.body).toEqual({
      status: "rejected",
      errors: ["source must be one of buyer, merchant, relay, or unknown"]
    });
  });

  it("creates merchants, origins, service keys, and key revocations", async () => {
    const bundle = createSampleProtocolArtifacts();
    const { app } = createTestApp({ withMerchantRegistry: true });

    const merchantResponse = await request(app)
      .post("/v1/merchants")
      .send({
        id: bundle.artifacts.receipt.merchantId,
        slug: "demo-merchant",
        displayName: "Demo Merchant",
        ownerWallet: bundle.keys.payerWallet
      })
      .expect(201);
    const originResponse = await request(app)
      .post(`/v1/merchants/${bundle.artifacts.receipt.merchantId}/origins`)
      .send({
        origin: bundle.artifacts.receipt.merchantOrigin,
        verificationMethod: "well_known"
      })
      .expect(201);
    const keyResponse = await request(app)
      .post(`/v1/merchants/${bundle.artifacts.receipt.merchantId}/keys`)
      .send({
        kid: bundle.artifacts.receipt.kid,
        publicKey: bundle.keys.merchantPublicKey,
        validFrom: "2026-06-24T00:00:00Z"
      })
      .expect(201);
    const profileResponse = await request(app)
      .get(`/v1/merchants/${bundle.artifacts.receipt.merchantId}`)
      .expect(200);
    const revokeResponse = await request(app)
      .post(
        `/v1/merchants/${bundle.artifacts.receipt.merchantId}/keys/${bundle.artifacts.receipt.kid}/revoke`
      )
      .send({
        revokedAt: "2026-06-24T00:02:00Z",
        reason: "rotation complete"
      })
      .expect(200);

    expect(merchantResponse.body.merchant.id).toBe(
      bundle.artifacts.receipt.merchantId
    );
    expect(originResponse.body.origin.origin).toBe(
      bundle.artifacts.receipt.merchantOrigin
    );
    expect(keyResponse.body.key.publicKey).toBe(bundle.keys.merchantPublicKey);
    expect(profileResponse.body.merchant.origins).toHaveLength(1);
    expect(profileResponse.body.merchant.keys).toHaveLength(1);
    expect(revokeResponse.body.key.revocationReason).toBe("rotation complete");
  });

  it("returns conflicts for duplicate merchant slugs", async () => {
    const bundle = createSampleProtocolArtifacts();
    const { app } = createTestApp({ withMerchantRegistry: true });
    const merchantBody = {
      id: bundle.artifacts.receipt.merchantId,
      slug: "demo-merchant",
      displayName: "Demo Merchant",
      ownerWallet: bundle.keys.payerWallet
    };

    await request(app).post("/v1/merchants").send(merchantBody).expect(201);
    const response = await request(app)
      .post("/v1/merchants")
      .send({
        ...merchantBody,
        id: "mrc_ffffffffffffffffffffffffffffffff"
      })
      .expect(409);

    expect(response.body.error).toBe("conflict");
  });
});

function createTestApp(options: { withMerchantRegistry?: boolean } = {}) {
  const bundle = createSampleProtocolArtifacts();
  const store = new InMemoryReceiptIngestionStore();
  const ingestor = new ReceiptIngestor(store, {
    resolveMerchantPublicKey: () => bundle.keys.merchantPublicKey,
    now: () => new Date("2026-06-24T00:02:00Z")
  });

  return {
    app: createControlPlaneApp({
      ingestor,
      ...(options.withMerchantRegistry === true
        ? {
            merchantRegistry: new InMemoryMerchantRegistry({
              now: () => new Date("2026-06-24T00:02:00Z")
            })
          }
        : {})
    }),
    store,
    receipt: bundle.artifacts.receipt
  };
}
