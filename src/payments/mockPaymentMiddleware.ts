import type { NextFunction, Request, RequestHandler, Response } from "express";
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import type { PaymentPayload, SettleResponse } from "@x402/core/types";
import {
  extractPaymentIdentifier,
  validatePaymentIdentifierRequirement,
} from "@x402/extensions/payment-identifier";

import type { AppConfig } from "../config.js";
import type { SettlementStore } from "../store/settlementStore.js";
import { createAcceptedPayment, createPaymentRequired, PAID_DEMO_METHOD, PAID_DEMO_ROUTE } from "./routes.js";

import type { Logger } from "pino";

export function createMockPaymentMiddleware(
  config: AppConfig,
  store: SettlementStore,
  logger: Logger,
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== PAID_DEMO_METHOD || req.path !== PAID_DEMO_ROUTE) {
      next();
      return;
    }

    const paymentRequired = createPaymentRequired(config);
    const signature = req.header("PAYMENT-SIGNATURE");

    if (!signature) {
      sendPaymentRequired(res, paymentRequired, "missing_payment_signature");
      return;
    }

    const paymentPayload = decodePaymentPayload(signature);

    if (!paymentPayload) {
      sendPaymentRequired(res, paymentRequired, "invalid_payment_signature");
      return;
    }

    const paymentIdValidation = validatePaymentIdentifierRequirement(paymentPayload, true);
    const paymentId = extractPaymentIdentifier(paymentPayload);

    if (!paymentIdValidation.valid || !paymentId) {
      sendPaymentRequired(res, paymentRequired, "missing_or_invalid_payment_identifier");
      return;
    }

    if (!acceptedPaymentMatches(paymentPayload, createAcceptedPayment(config))) {
      sendPaymentRequired(res, paymentRequired, "payment_requirements_mismatch");
      return;
    }

    const settlement: SettleResponse = {
      success: true,
      transaction: `mock:${paymentId}`,
      network: config.network,
      amount: createAcceptedPayment(config).amount,
      payer: mockPayer(paymentPayload),
    };

    await store.append({
      paymentId,
      route: PAID_DEMO_ROUTE,
      method: PAID_DEMO_METHOD,
      amount: settlement.amount ?? createAcceptedPayment(config).amount,
      asset: config.asset,
      network: settlement.network,
      payer: settlement.payer,
      transaction: settlement.transaction,
      status: "mock-settled",
      raw: settlement,
      createdAt: new Date().toISOString(),
    });

    logger.info(
      {
        paymentId,
        route: PAID_DEMO_ROUTE,
        amount: settlement.amount,
        network: settlement.network,
        status: "mock-settled",
      },
      "mock x402 payment accepted",
    );

    res.setHeader("PAYMENT-RESPONSE", encodePaymentResponseHeader(settlement));
    res.locals.paymentId = paymentId;
    next();
  };
}

function decodePaymentPayload(signature: string): PaymentPayload | null {
  try {
    return decodePaymentSignatureHeader(signature);
  } catch {
    return null;
  }
}

function sendPaymentRequired(res: Response, paymentRequired: ReturnType<typeof createPaymentRequired>, reason: string) {
  res
    .status(402)
    .setHeader("PAYMENT-REQUIRED", encodePaymentRequiredHeader(paymentRequired))
    .json({
      error: "payment_required",
      reason,
      accepts: paymentRequired.accepts,
      extensions: paymentRequired.extensions,
    });
}

function acceptedPaymentMatches(paymentPayload: PaymentPayload, expected: ReturnType<typeof createAcceptedPayment>) {
  const accepted = paymentPayload.accepted;

  return (
    accepted.scheme === expected.scheme &&
    accepted.network === expected.network &&
    accepted.asset === expected.asset &&
    accepted.amount === expected.amount &&
    accepted.payTo === expected.payTo
  );
}

function mockPayer(paymentPayload: PaymentPayload): string | undefined {
  const payer = paymentPayload.payload["payer"];
  return typeof payer === "string" ? payer : undefined;
}

