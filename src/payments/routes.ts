import type { RoutesConfig } from "@x402/core/server";
import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { declarePaymentIdentifierExtension, PAYMENT_IDENTIFIER } from "@x402/extensions/payment-identifier";

import type { AppConfig } from "../config.js";

export const PAID_DEMO_ROUTE = "/v1/paid-demo";
export const PAID_DEMO_METHOD = "GET";

const USDC_DECIMALS = 6;

export function createAcceptedPayment(config: AppConfig): PaymentRequirements {
  return {
    scheme: "exact",
    network: config.network,
    asset: config.asset,
    amount: usdToAtomicUnits(config.priceUsd),
    payTo: config.payTo,
    maxTimeoutSeconds: 60,
    extra: {
      price: `$${config.priceUsd}`,
      asset: config.asset,
    },
  };
}

export function createPaymentRequired(config: AppConfig): PaymentRequired {
  return {
    x402Version: 2,
    error: "Payment required",
    resource: {
      url: `${config.resourceBaseUrl}${PAID_DEMO_ROUTE}`,
      description: "Split402 paid demo response",
      mimeType: "application/json",
      serviceName: "Split402",
      tags: ["split402", "x402", "phase-1"],
    },
    accepts: [createAcceptedPayment(config)],
    extensions: {
      [PAYMENT_IDENTIFIER]: declarePaymentIdentifierExtension(true),
    },
  };
}

export function createX402Routes(config: AppConfig): RoutesConfig {
  return {
    [`${PAID_DEMO_METHOD} ${PAID_DEMO_ROUTE}`]: {
      accepts: [
        {
          scheme: "exact",
          price: `$${config.priceUsd}`,
          network: config.network,
          payTo: config.payTo,
          maxTimeoutSeconds: 60,
          extra: {
            asset: config.asset,
          },
        },
      ],
      resource: `${config.resourceBaseUrl}${PAID_DEMO_ROUTE}`,
      description: "Split402 paid demo response",
      mimeType: "application/json",
      serviceName: "Split402",
      tags: ["split402", "x402", "phase-1"],
      extensions: {
        [PAYMENT_IDENTIFIER]: declarePaymentIdentifierExtension(true),
      },
      unpaidResponseBody: () => ({
        contentType: "application/json",
        body: {
          error: "payment_required",
          message: "Provide an x402 PAYMENT-SIGNATURE with a payment-identifier.",
        },
      }),
      settlementFailedResponseBody: (_context, settleResult) => ({
        contentType: "application/json",
        body: {
          error: "settlement_failed",
          reason: settleResult.errorReason,
          message: settleResult.errorMessage,
        },
      }),
    },
  };
}

function usdToAtomicUnits(decimal: string): string {
  const [whole = "0", fraction = ""] = decimal.split(".");
  const paddedFraction = fraction.padEnd(USDC_DECIMALS, "0").slice(0, USDC_DECIMALS);
  const amount = `${whole}${paddedFraction}`.replace(/^0+/, "");
  return amount === "" ? "0" : amount;
}
