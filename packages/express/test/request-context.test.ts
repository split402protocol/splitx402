import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { getSplit402RequestContext, split402RequestContext } from "../src/index.js";

describe("Split402 Express request context", () => {
  it("captures method, path template, params, query, body, and referral hint", async () => {
    const app = express();
    app.use(express.json());
    app.post(
      "/v1/risk/:wallet",
      split402RequestContext("/v1/risk/:wallet"),
      (req, res) => {
        res.json(getSplit402RequestContext(req));
      }
    );

    await request(app)
      .post("/v1/risk/Wallet111?includeLabels=true&tag=alpha&tag=beta")
      .set("Split402-Claim", "claim-demo")
      .send({ includeScore: true })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({
          method: "POST",
          pathTemplate: "/v1/risk/:wallet",
          pathParams: { wallet: "Wallet111" },
          query: { includeLabels: "true", tag: ["alpha", "beta"] },
          body: { includeScore: true },
          referralClaimHint: "claim-demo"
        });
      });
  });

  it("returns a fallback context when middleware was not installed", async () => {
    const app = express();
    app.get("/v1/plain", (req, res) => {
      res.json(getSplit402RequestContext(req));
    });

    await request(app)
      .get("/v1/plain?mode=basic")
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({
          method: "GET",
          pathTemplate: "/v1/plain",
          pathParams: {},
          query: { mode: "basic" },
          body: null
        });
      });
  });
});
