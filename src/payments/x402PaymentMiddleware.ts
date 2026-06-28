import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { paymentMiddleware } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import {
  extractPaymentIdentifier,
  paymentIdentifierResourceServerExtension,
} from "@x402/extensions/payment-identifier";

import type { Logger } from "pino";
import type { RequestHandler } from "express";
import type { PaymentPayload } from "@x402/core/types";

import type { AppConfig } from "../config.js";
import type { SettlementStore } from "../store/settlementStore.js";
import { createX402Routes, PAID_DEMO_METHOD, PAID_DEMO_ROUTE } from "./routes.js";

export function createX402PaymentMiddleware(
  config: AppConfig,
  store: SettlementStore,
  logger: Logger,
): RequestHandler {
  assertLegacyEvmConfig(config);

  const facilitatorClient = new HTTPFacilitatorClient({
    url: config.facilitatorUrl,
  });

  const resourceServer = new x402ResourceServer(facilitatorClient)
    .register(config.network, new ExactEvmScheme())
    .registerExtension(paymentIdentifierResourceServerExtension)
    .onAfterSettle(async (context) => {
      const paymentId = extractPaymentIdentifier(context.paymentPayload as unknown as PaymentPayload);

      if (!paymentId) {
        logger.warn({ route: PAID_DEMO_ROUTE }, "settled payment did not include payment-identifier");
        return;
      }

      await store.append({
        paymentId,
        route: PAID_DEMO_ROUTE,
        method: PAID_DEMO_METHOD,
        amount: context.result.amount ?? context.requirements.amount,
        asset: context.requirements.asset,
        network: context.result.network,
        payer: context.result.payer,
        transaction: context.result.transaction,
        status: context.result.success ? "settled" : "settlement-failed",
        raw: context.result,
        createdAt: new Date().toISOString(),
      });

      logger.info(
        {
          paymentId,
          route: PAID_DEMO_ROUTE,
          amount: context.result.amount ?? context.requirements.amount,
          network: context.result.network,
          status: context.result.success ? "settled" : "settlement-failed",
        },
        "x402 settlement recorded",
      );
    });

  return paymentMiddleware(
    createX402Routes(config),
    resourceServer,
    undefined,
    undefined,
    config.syncFacilitator,
  );
}

function assertLegacyEvmConfig(config: AppConfig): void {
  if (!config.network.startsWith("eip155:")) {
    throw new Error(
      "SPLIT402_PAYMENT_MODE=x402 is the legacy EVM transitional path; use an eip155:* network or run the canonical Solana Split402 demos",
    );
  }
  if (!/^0x[a-fA-F0-9]{40}$/u.test(config.payTo)) {
    throw new Error(
      "SPLIT402_PAYMENT_MODE=x402 requires an EVM payTo address for the legacy transitional path",
    );
  }
}
