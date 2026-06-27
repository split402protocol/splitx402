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

  it("renders referrer data using the control-plane response contracts", async () => {
    const { app } = createDashboardApp({
      config: {
        controlPlaneUrl: "https://control.example",
        port: 4027
      }
    });

    const response = await request(app).get("/").expect(200);

    expect(response.text).toContain("renderBalance(balances?.summary)");
    expect(response.text).toContain("renderPayouts(payouts?.items ?? [])");
    expect(response.text).toContain("value?.assets");
    expect(response.text).toContain("availableAmountAtomic");
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

  it("protects dashboard APIs when a viewer token is configured", async () => {
    const calls: Array<{ url: string; authorization?: string }> = [];
    let now = Date.parse("2030-06-26T00:00:00.000Z");
    const agent = request.agent(
      createDashboardApp({
        config: {
          controlPlaneUrl: "https://control.example",
          port: 4027,
          viewerToken: "viewer-secret",
          secureSessionCookie: false,
          sessionMaxAgeSeconds: 60
        },
        fetch: fakeFetch(calls, {
          dashboard: {
            schema: "split402.merchant_dashboard_summary.v1"
          }
        }),
        now: () => now
      }).app
    );

    await agent.get("/health").expect(200);
    await agent.get("/api/config").expect(401);
    await agent
      .post("/api/session")
      .send({ token: "wrong" })
      .expect(401);

    const session = await agent
      .post("/api/session")
      .send({ token: "viewer-secret" })
      .expect(200);

    const cookies = session.headers["set-cookie"];
    const sessionCookie = Array.isArray(cookies) ? cookies[0] : cookies;
    expect(sessionCookie).toContain("split402_dashboard_session=");
    expect(sessionCookie).toContain("Max-Age=60");
    await agent.get("/api/config").expect(200, {
      controlPlaneUrl: "https://control.example",
      configuredBearerToken: false,
      viewerAuthRequired: true,
      sessionMaxAgeSeconds: 60
    });
    await agent
      .get("/api/merchants/mrc_1/dashboard-summary")
      .set("Authorization", "Bearer caller-token")
      .expect(200);
    now = Date.parse("2030-06-26T00:01:01.000Z");
    await agent.get("/api/config").expect(401);

    expect(calls).toEqual([
      {
        url: "https://control.example/v1/merchants/mrc_1/dashboard-summary",
        authorization: "Bearer caller-token"
      }
    ]);
  });

  it("accepts the dashboard token header without forwarding it upstream", async () => {
    const calls: Array<{ url: string; authorization?: string }> = [];
    const { app } = createDashboardApp({
      config: {
        controlPlaneUrl: "https://control.example",
        port: 4027,
        viewerToken: "viewer-secret",
        controlPlaneBearerToken: "control-token"
      },
      fetch: fakeFetch(calls, {
        dashboard: {
          schema: "split402.merchant_dashboard_summary.v1"
        }
      })
    });

    await request(app)
      .get("/api/merchants/mrc_1/dashboard-summary")
      .set("x-split402-dashboard-token", "viewer-secret")
      .expect(200);

    expect(calls).toEqual([
      {
        url: "https://control.example/v1/merchants/mrc_1/dashboard-summary",
        authorization: "Bearer control-token"
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
    expect(
      readDashboardConfig({}, {
        SPLIT402_DASHBOARD_VIEWER_TOKEN: "viewer-secret",
        SPLIT402_DASHBOARD_SESSION_COOKIE_NAME: "split402_staging",
        SPLIT402_DASHBOARD_SESSION_COOKIE_SECURE: "true",
        SPLIT402_DASHBOARD_SESSION_MAX_AGE_SECONDS: "600"
      })
    ).toMatchObject({
      viewerToken: "viewer-secret",
      sessionCookieName: "split402_staging",
      secureSessionCookie: true,
      sessionMaxAgeSeconds: 600
    });
    expect(() =>
      readDashboardConfig({}, {
        SPLIT402_DASHBOARD_SESSION_MAX_AGE_SECONDS: "0"
      })
    ).toThrow("SPLIT402_DASHBOARD_SESSION_MAX_AGE_SECONDS must be a positive integer");
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
