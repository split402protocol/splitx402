import express from "express";
import { pinoHttp } from "pino-http";

import type { AppConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createPaymentMiddleware } from "./payments/index.js";
import { PAID_DEMO_ROUTE } from "./payments/routes.js";
import { SettlementStore } from "./store/settlementStore.js";

export function createApp(config: AppConfig) {
  const logger = createLogger(config);
  const store = new SettlementStore(config.dataDir);
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "128kb" }));
  app.use(
    pinoHttp({
      logger,
      customSuccessMessage: (_req: express.Request, res: express.Response) =>
        `request completed with ${res.statusCode}`,
    }),
  );

  app.get("/v1/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "split402",
      phase: "phase-1",
      paymentMode: config.paymentMode,
    });
  });

  app.get("/.well-known/split402.json", (_req, res) => {
    res.json({
      protocol: "split402",
      version: "0.1-phase-1",
      service: "Split402",
      settlementMode: config.paymentMode === "mock" ? "mock" : "x402-exact",
      routes: [
        {
          method: "GET",
          path: PAID_DEMO_ROUTE,
          network: config.network,
          asset: config.asset,
          priceUsd: config.priceUsd,
          payTo: config.payTo,
          paymentIdentifierRequired: true,
        },
      ],
    });
  });

  app.use(createPaymentMiddleware(config, store, logger));

  app.get(PAID_DEMO_ROUTE, (_req, res) => {
    res.json({
      ok: true,
      service: "split402",
      route: PAID_DEMO_ROUTE,
      paymentId: typeof res.locals.paymentId === "string" ? res.locals.paymentId : null,
      settlementStatus: config.paymentMode === "mock" ? "mock-settled" : "settled",
      message: "Phase 1 paid demo response",
    });
  });

  app.get("/v1/payments/:paymentId", async (req, res, next) => {
    try {
      const record = await store.findByPaymentId(req.params.paymentId);

      if (!record) {
        res.status(404).json({ error: "payment_not_found" });
        return;
      }

      res.json({ payment: record });
    } catch (error) {
      next(error);
    }
  });

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error({ error }, "unhandled request error");
    res.status(500).json({ error: "internal_server_error" });
  });

  return { app, logger, store };
}
