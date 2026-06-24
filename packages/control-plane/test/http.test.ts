import { createSampleProtocolArtifacts } from "@split402/protocol";
import request from "supertest";
import { describe, expect, it } from "vitest";

import {
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
});

function createTestApp() {
  const bundle = createSampleProtocolArtifacts();
  const store = new InMemoryReceiptIngestionStore();
  const ingestor = new ReceiptIngestor(store, {
    resolveMerchantPublicKey: () => bundle.keys.merchantPublicKey,
    now: () => new Date("2026-06-24T00:02:00Z")
  });

  return {
    app: createControlPlaneApp({ ingestor }),
    store,
    receipt: bundle.artifacts.receipt
  };
}
