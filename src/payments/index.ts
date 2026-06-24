import type { RequestHandler } from "express";
import type { Logger } from "pino";

import type { AppConfig } from "../config.js";
import type { SettlementStore } from "../store/settlementStore.js";
import { createMockPaymentMiddleware } from "./mockPaymentMiddleware.js";
import { createX402PaymentMiddleware } from "./x402PaymentMiddleware.js";

export function createPaymentMiddleware(
  config: AppConfig,
  store: SettlementStore,
  logger: Logger,
): RequestHandler {
  if (config.paymentMode === "mock") {
    return createMockPaymentMiddleware(config, store, logger);
  }

  return createX402PaymentMiddleware(config, store, logger);
}

