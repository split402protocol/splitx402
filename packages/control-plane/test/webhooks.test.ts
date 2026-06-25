import { describe, expect, it } from "vitest";

import {
  HttpWebhookDispatcher,
  createWebhookEnvelope,
  createWebhookSignature,
  type OutboxEventRecord,
  type WebhookFetch,
  type WebhookFetchResponse
} from "../src/index.js";

describe("HttpWebhookDispatcher", () => {
  it("posts signed webhook envelopes", async () => {
    const calls: Array<{
      input: string;
      init: Parameters<WebhookFetch>[1];
    }> = [];
    const fetch: WebhookFetch = async (input, init) => {
      calls.push({ input, init });
      return { status: 202 };
    };
    const dispatcher = new HttpWebhookDispatcher({
      endpointUrl: "https://merchant.example/webhooks/split402",
      secret: "webhook-secret",
      fetch,
      now: () => new Date("2026-06-24T00:05:00Z")
    });
    const event = createWebhookEvent();

    const result = await dispatcher.dispatch(event);

    expect(result).toEqual({ status: "delivered", statusCode: 202 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe("https://merchant.example/webhooks/split402");
    expect(calls[0]?.init.method).toBe("POST");
    const body = calls[0]?.init.body ?? "";
    expect(JSON.parse(body)).toEqual(createWebhookEnvelope(event));
    expect(calls[0]?.init.headers).toEqual(
      expect.objectContaining({
        "content-type": "application/json",
        "split402-event-id": event.id,
        "split402-event-type": event.eventType,
        "split402-event-timestamp": "2026-06-24T00:05:00.000Z",
        "split402-webhook-signature": createWebhookSignature(
          "webhook-secret",
          "2026-06-24T00:05:00.000Z",
          body
        )
      })
    );
  });

  it("classifies retryable and rejected webhook responses", async () => {
    const retryDispatcher = new HttpWebhookDispatcher({
      endpointUrl: "https://merchant.example/webhooks/split402",
      secret: "webhook-secret",
      fetch: createStaticFetch({ status: 503, text: async () => "try later" })
    });
    const rejectedDispatcher = new HttpWebhookDispatcher({
      endpointUrl: "https://merchant.example/webhooks/split402",
      secret: "webhook-secret",
      fetch: createStaticFetch({ status: 400, text: async () => "bad event" })
    });

    await expect(retryDispatcher.dispatch(createWebhookEvent())).resolves.toEqual({
      status: "retry",
      statusCode: 503,
      error: "webhook returned 503: try later"
    });
    await expect(rejectedDispatcher.dispatch(createWebhookEvent())).resolves.toEqual({
      status: "rejected",
      statusCode: 400,
      error: "webhook returned 400: bad event"
    });
  });
});

function createStaticFetch(response: WebhookFetchResponse): WebhookFetch {
  return async () => response;
}

function createWebhookEvent(): OutboxEventRecord {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    eventType: "webhook.receipt.accepted.v1",
    aggregateType: "receipt",
    aggregateId: "rcp_00000000000000000000000000000001",
    payload: {
      receiptId: "rcp_00000000000000000000000000000001",
      merchantId: "mrc_00000000000000000000000000000001"
    },
    status: "processing",
    attempts: 1,
    availableAt: "2026-06-24T00:02:00Z",
    lockedAt: "2026-06-24T00:04:00Z",
    createdAt: "2026-06-24T00:02:00Z"
  };
}
