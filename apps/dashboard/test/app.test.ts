import request from "supertest";
import { describe, expect, it } from "vitest";

import {
  createDashboardApp,
  readDashboardConfig,
  type DashboardFetch,
  type DashboardFetchResponse
} from "../src/app.js";

describe("Split402 dashboard app", () => {
  it("serves the dashboard shell", async () => {
    const { app } = createDashboardApp({
      config: {
        controlPlaneUrl: "https://control.example",
        port: 4027,
        defaultMerchantId: "mrc_1",
        defaultReferrerWallet: "referrer_wallet"
      }
    });

    const response = await request(app).get("/").expect(200);

    expect(response.text).toContain("Split402 Dashboard");
    expect(response.text).toContain("Merchant, referrer, route, payout, and webhook operations");
    expect(response.text).toContain("mrc_1");
    expect(response.text).toContain("referrer_wallet");
  });

  it("proxies merchant dashboard reads to the configured control plane", async () => {
    const calls: Array<{ url: string; authorization?: string }> = [];
    const { app } = createDashboardApp({
      config: {
        controlPlaneUrl: "https://control.example/base/",
        port: 4027,
        controlPlaneBearerToken: "configured-token"
      },
      fetch: fakeFetch(calls, {
        dashboard: {
          schema: "split402.merchant_dashboard_summary.v1"
        }
      })
    });

    const response = await request(app)
      .get("/api/merchants/mrc_1/dashboard-summary")
      .expect(200);

    expect(response.body).toEqual({
      dashboard: {
        schema: "split402.merchant_dashboard_summary.v1"
      }
    });
    expect(calls).toEqual([
      {
        url: "https://control.example/v1/merchants/mrc_1/dashboard-summary",
        authorization: "Bearer configured-token"
      }
    ]);
  });

  it("proxies webhook query filters and caller authorization", async () => {
    const calls: Array<{ url: string; authorization?: string }> = [];
    const { app } = createDashboardApp({
      config: {
        controlPlaneUrl: "https://control.example",
        port: 4027,
        controlPlaneBearerToken: "configured-token"
      },
      fetch: fakeFetch(calls, { events: [] })
    });

    await request(app)
      .get("/api/merchants/mrc_1/webhook-events?status=pending&limit=25&ignored=yes")
      .set("Authorization", "Bearer caller-token")
      .expect(200);

    expect(calls).toEqual([
      {
        url: "https://control.example/v1/merchants/mrc_1/webhook-events?status=pending&limit=25",
        authorization: "Bearer caller-token"
      }
    ]);
  });

  it("proxies merchant payout obligation reads with asset filters", async () => {
    const calls: Array<{ url: string; authorization?: string }> = [];
    const { app } = createDashboardApp({
      config: {
        controlPlaneUrl: "https://control.example",
        port: 4027,
        controlPlaneBearerToken: "configured-token"
      },
      fetch: fakeFetch(calls, {
        summary: {
          schema: "split402.merchant_obligation_summary.v1",
          assets: []
        }
      })
    });

    await request(app)
      .get("/api/merchants/mrc_1/payout-obligations?asset=usdc_mint&ignored=yes")
      .expect(200);

    expect(calls).toEqual([
      {
        url: "https://control.example/v1/merchants/mrc_1/payout-obligations?asset=usdc_mint",
        authorization: "Bearer configured-token"
      }
    ]);
  });

  it("validates dashboard env configuration", () => {
    expect(() =>
      readDashboardConfig({}, {
        SPLIT402_DASHBOARD_CONTROL_PLANE_URL: "ftp://control.example"
      })
    ).toThrow("SPLIT402_DASHBOARD_CONTROL_PLANE_URL must be an http(s) URL");
    expect(
      readDashboardConfig({}, {
        SPLIT402_DASHBOARD_PORT: "4999"
      }).port
    ).toBe(4999);
  });
});

function fakeFetch(
  calls: Array<{ url: string; authorization?: string }>,
  body: unknown
): DashboardFetch {
  return async (url, init) => {
    calls.push({
      url,
      ...(init?.headers?.authorization === undefined
        ? {}
        : { authorization: init.headers.authorization })
    });
    return jsonResponse(body);
  };
}

function jsonResponse(body: unknown): DashboardFetchResponse {
  return {
    status: 200,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-type" ? "application/json" : null
    },
    text: async () => JSON.stringify(body)
  };
}
