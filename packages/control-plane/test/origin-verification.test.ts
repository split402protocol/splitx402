import { describe, expect, it } from "vitest";

import { checkMerchantOriginWellKnown } from "../src/index.js";

const MERCHANT_ID = "mrc_00000000000000000000000000000001";
const ORIGIN = "https://merchant.example";

describe("merchant origin well-known check", () => {
  it("passes when the well-known document matches the merchant", async () => {
    const check = await checkMerchantOriginWellKnown({
      origin: ORIGIN,
      merchantId: MERCHANT_ID,
      fetchImpl: createFetch(
        jsonResponse({
          protocol: "split402",
          merchantId: MERCHANT_ID,
          servicePublicKey: "6cP4my1zUvbPB6XJ8vfLwQrEyQyLL5MMBqPFbnb5KBUq"
        })
      )
    });

    expect(check.ok).toBe(true);
    expect(check.checkedUrl).toBe(`${ORIGIN}/.well-known/split402.json`);
    expect(check.status).toBe(200);
    expect(check.errors).toEqual([]);
    expect(check.discovered?.merchantId).toBe(MERCHANT_ID);
  });

  it("fails when the document names a different merchant", async () => {
    const check = await checkMerchantOriginWellKnown({
      origin: ORIGIN,
      merchantId: MERCHANT_ID,
      fetchImpl: createFetch(
        jsonResponse({
          protocol: "split402",
          merchantId: "mrc_00000000000000000000000000000099",
          servicePublicKey: "6cP4my1zUvbPB6XJ8vfLwQrEyQyLL5MMBqPFbnb5KBUq"
        })
      )
    });

    expect(check.ok).toBe(false);
    expect(check.errors.join("; ")).toMatch(/does not match/u);
  });

  it("fails on missing protocol or service key", async () => {
    const check = await checkMerchantOriginWellKnown({
      origin: ORIGIN,
      merchantId: MERCHANT_ID,
      fetchImpl: createFetch(jsonResponse({ merchantId: MERCHANT_ID }))
    });

    expect(check.ok).toBe(false);
    expect(check.errors).toHaveLength(2);
    expect(check.errors.join("; ")).toMatch(/protocol/u);
    expect(check.errors.join("; ")).toMatch(/servicePublicKey/u);
  });

  it("fails on non-200 responses without parsing", async () => {
    const check = await checkMerchantOriginWellKnown({
      origin: ORIGIN,
      merchantId: MERCHANT_ID,
      fetchImpl: createFetch(new Response("missing", { status: 404 }))
    });

    expect(check.ok).toBe(false);
    expect(check.status).toBe(404);
    expect(check.errors).toEqual(["well-known request returned HTTP 404"]);
  });

  it("fails on invalid JSON and oversized documents", async () => {
    const invalidJson = await checkMerchantOriginWellKnown({
      origin: ORIGIN,
      merchantId: MERCHANT_ID,
      fetchImpl: createFetch(new Response("not-json", { status: 200 }))
    });
    expect(invalidJson.ok).toBe(false);
    expect(invalidJson.errors).toEqual([
      "well-known document is not valid JSON"
    ]);

    const oversized = await checkMerchantOriginWellKnown({
      origin: ORIGIN,
      merchantId: MERCHANT_ID,
      fetchImpl: createFetch(
        new Response(`"${"x".repeat(70_000)}"`, { status: 200 })
      )
    });
    expect(oversized.ok).toBe(false);
    expect(oversized.errors.join("; ")).toMatch(/exceeds/u);
  });

  it("reports network failures without throwing", async () => {
    const check = await checkMerchantOriginWellKnown({
      origin: ORIGIN,
      merchantId: MERCHANT_ID,
      fetchImpl: () => Promise.reject(new Error("connection refused"))
    });

    expect(check.ok).toBe(false);
    expect(check.errors).toEqual([
      "well-known request failed: connection refused"
    ]);
  });

  it("requests the well-known URL with redirects disabled", async () => {
    const requests: { url: string; redirect?: string }[] = [];
    await checkMerchantOriginWellKnown({
      origin: ORIGIN,
      merchantId: MERCHANT_ID,
      fetchImpl: (input, init) => {
        requests.push({
          url: String(input),
          ...(init?.redirect === undefined ? {} : { redirect: init.redirect })
        });
        return Promise.resolve(jsonResponse({}));
      }
    });

    expect(requests).toEqual([
      {
        url: `${ORIGIN}/.well-known/split402.json`,
        redirect: "error"
      }
    ]);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function createFetch(response: Response): typeof fetch {
  return () => Promise.resolve(response);
}
