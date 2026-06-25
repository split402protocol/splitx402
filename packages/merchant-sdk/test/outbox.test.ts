import { createSampleProtocolArtifacts } from "@split402/protocol";
import { describe, expect, it } from "vitest";

import {
  ControlPlaneReceiptSubmitter,
  InMemoryMerchantReceiptOutboxStore,
  MerchantReceiptOutboxConflictError,
  MerchantReceiptOutboxDispatcher,
  type MerchantReceiptFetch,
  type MerchantReceiptSubmissionResult,
  type MerchantReceiptSubmitter
} from "../src/index.js";

describe("InMemoryMerchantReceiptOutboxStore", () => {
  it("enqueues signed receipts idempotently by receipt hash", () => {
    const receipt = createSampleProtocolArtifacts().artifacts.receipt;
    const store = new InMemoryMerchantReceiptOutboxStore();

    const first = store.enqueueReceipt({
      id: "mro_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      receipt,
      now: "2026-06-24T00:00:00Z"
    });
    const duplicate = store.enqueueReceipt({
      receipt,
      now: "2026-06-24T00:01:00Z"
    });

    expect(duplicate).toEqual(first);
    expect(store.getByReceiptId(receipt.receiptId)?.receiptHash).toBe(
      first.receiptHash
    );
    expect(() =>
      store.enqueueReceipt({
        receipt: {
          ...receipt,
          requiredAmountAtomic: "999999"
        },
        now: "2026-06-24T00:02:00Z"
      })
    ).toThrow(MerchantReceiptOutboxConflictError);
  });
});

describe("MerchantReceiptOutboxDispatcher", () => {
  it("marks created or duplicate receipt submissions accepted", async () => {
    const receipt = createSampleProtocolArtifacts().artifacts.receipt;
    const store = new InMemoryMerchantReceiptOutboxStore();
    store.enqueueReceipt({ receipt, now: "2026-06-24T00:00:00Z" });
    const dispatcher = new MerchantReceiptOutboxDispatcher(
      store,
      new SequenceSubmitter([{ status: "accepted", responseStatus: "created" }]),
      { now: () => new Date("2026-06-24T00:01:00Z") }
    );

    const result = await dispatcher.dispatchNext();
    const stored = store.getByReceiptId(receipt.receiptId);

    expect(result.status).toBe("accepted");
    expect(stored).toEqual(
      expect.objectContaining({
        status: "accepted",
        attempts: 1
      })
    );
    expect(stored).not.toHaveProperty("lastError");
  });

  it("schedules retries and only claims ready receipts", async () => {
    const receipt = createSampleProtocolArtifacts().artifacts.receipt;
    const store = new InMemoryMerchantReceiptOutboxStore();
    store.enqueueReceipt({ receipt, now: "2026-06-24T00:00:00Z" });
    let now = new Date("2026-06-24T00:01:00Z");
    const dispatcher = new MerchantReceiptOutboxDispatcher(
      store,
      new SequenceSubmitter([
        { status: "retry", error: "control plane unavailable" },
        { status: "accepted", responseStatus: "duplicate" }
      ]),
      {
        now: () => now,
        retryDelayMs: 60_000
      }
    );

    await expect(dispatcher.dispatchNext()).resolves.toEqual(
      expect.objectContaining({
        status: "retry_scheduled",
        nextAttemptAt: "2026-06-24T00:02:00.000Z"
      })
    );
    await expect(dispatcher.dispatchNext()).resolves.toEqual({ status: "idle" });

    now = new Date("2026-06-24T00:02:00Z");

    await expect(dispatcher.dispatchNext()).resolves.toEqual(
      expect.objectContaining({ status: "accepted" })
    );
    expect(store.getByReceiptId(receipt.receiptId)?.attempts).toBe(2);
  });

  it("dead-letters permanent rejections and exhausted retries", async () => {
    const receipt = createSampleProtocolArtifacts().artifacts.receipt;
    const rejectedStore = new InMemoryMerchantReceiptOutboxStore();
    rejectedStore.enqueueReceipt({ receipt, now: "2026-06-24T00:00:00Z" });
    const rejectedDispatcher = new MerchantReceiptOutboxDispatcher(
      rejectedStore,
      new SequenceSubmitter([{ status: "rejected", error: "receipt conflict" }]),
      { now: () => new Date("2026-06-24T00:01:00Z") }
    );

    await expect(rejectedDispatcher.dispatchNext()).resolves.toEqual(
      expect.objectContaining({
        status: "dead_letter",
        lastError: "receipt conflict"
      })
    );

    const retryReceipt = {
      ...receipt,
      receiptId: "rcp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      paymentId: "pay_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    };
    const retryStore = new InMemoryMerchantReceiptOutboxStore();
    retryStore.enqueueReceipt({ receipt: retryReceipt, now: "2026-06-24T00:00:00Z" });
    const retryDispatcher = new MerchantReceiptOutboxDispatcher(
      retryStore,
      new SequenceSubmitter([{ status: "retry", error: "timeout" }]),
      {
        maxAttempts: 1,
        now: () => new Date("2026-06-24T00:01:00Z")
      }
    );

    await expect(retryDispatcher.dispatchNext()).resolves.toEqual(
      expect.objectContaining({
        status: "dead_letter",
        lastError: "timeout"
      })
    );
  });
});

describe("ControlPlaneReceiptSubmitter", () => {
  it("submits merchant receipts and accepts created or duplicate responses", async () => {
    const receipt = createSampleProtocolArtifacts().artifacts.receipt;
    const requests: unknown[] = [];
    const submitter = new ControlPlaneReceiptSubmitter({
      controlPlaneUrl: "https://control.example/base",
      fetch: createFetch([
        response(201, { status: "created" }),
        response(200, { status: "duplicate" })
      ], requests)
    });

    await expect(submitter.submitReceipt(receipt)).resolves.toEqual(
      expect.objectContaining({
        status: "accepted",
        responseStatus: "created"
      })
    );
    await expect(submitter.submitReceipt(receipt)).resolves.toEqual(
      expect.objectContaining({
        status: "accepted",
        responseStatus: "duplicate"
      })
    );
    expect(requests).toEqual([
      {
        url: "https://control.example/v1/receipts",
        body: { receipt, source: "merchant" }
      },
      {
        url: "https://control.example/v1/receipts",
        body: { receipt, source: "merchant" }
      }
    ]);
  });

  it("classifies transient and permanent control-plane failures", async () => {
    const receipt = createSampleProtocolArtifacts().artifacts.receipt;
    const submitter = new ControlPlaneReceiptSubmitter({
      controlPlaneUrl: "https://control.example",
      fetch: createFetch([
        response(503, { error: "maintenance" }),
        response(409, { status: "conflict", errors: ["payment id conflict"] })
      ])
    });

    await expect(submitter.submitReceipt(receipt)).resolves.toEqual({
      status: "retry",
      statusCode: 503,
      error: "maintenance"
    });
    await expect(submitter.submitReceipt(receipt)).resolves.toEqual({
      status: "rejected",
      statusCode: 409,
      responseStatus: "conflict",
      error: "payment id conflict"
    });
  });
});

class SequenceSubmitter implements MerchantReceiptSubmitter {
  private index = 0;

  constructor(private readonly results: MerchantReceiptSubmissionResult[]) {}

  submitReceipt(): MerchantReceiptSubmissionResult {
    const result = this.results[this.index];
    this.index += 1;
    if (result === undefined) {
      throw new Error("unexpected submission");
    }
    return result;
  }
}

function createFetch(
  responses: ReturnType<typeof response>[],
  requests: unknown[] = []
): MerchantReceiptFetch {
  let index = 0;
  return async (input, init) => {
    const next = responses[index];
    index += 1;
    if (next === undefined) {
      throw new Error("unexpected fetch");
    }
    requests.push({
      url: input,
      body: JSON.parse(init.body)
    });
    return next;
  };
}

function response(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    }
  };
}
