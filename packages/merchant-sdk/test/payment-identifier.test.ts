import type { PaymentPayload } from "@x402/core/types";
import { describe, expect, it } from "vitest";

import {
  MerchantPaymentIdentifierError,
  SPLIT402_PAYMENT_IDENTIFIER_EXTENSION_KEY,
  appendSplit402PaymentIdentifier,
  assertRequiredSplit402PaymentIdentifier,
  createSplit402PaymentIdentifier,
  declareRequiredPaymentIdentifierExtension,
  extractSplit402PaymentIdentifier,
  validateRequiredSplit402PaymentIdentifier
} from "../src/index.js";

describe("Split402 payment identifier helpers", () => {
  it("declares payment-identifier as required for merchant route configs", () => {
    const declaration = declareRequiredPaymentIdentifierExtension();

    expect(readPaymentIdentifierInfo(declaration)).toEqual({
      required: true
    });
  });

  it("generates Split402-compatible x402 payment identifiers", () => {
    const paymentId = createSplit402PaymentIdentifier();

    expect(paymentId).toMatch(/^pay_[0-9a-f]{32,}$/u);
  });

  it("appends, extracts, validates, and asserts required identifiers", () => {
    const paymentId = "pay_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const extensions = appendSplit402PaymentIdentifier(
      declareRequiredPaymentIdentifierExtension(),
      paymentId
    );
    const paymentPayload = createPaymentPayload(extensions);

    expect(readPaymentIdentifierInfo(extensions)).toEqual({
      required: true,
      id: paymentId
    });
    expect(extractSplit402PaymentIdentifier(paymentPayload)).toBe(paymentId);
    expect(validateRequiredSplit402PaymentIdentifier(paymentPayload)).toEqual({
      valid: true
    });
    expect(assertRequiredSplit402PaymentIdentifier(paymentPayload)).toBe(paymentId);
  });

  it("rejects missing identifiers and non-Split402 identifier shapes", () => {
    expect(() =>
      assertRequiredSplit402PaymentIdentifier(
        createPaymentPayload(declareRequiredPaymentIdentifierExtension())
      )
    ).toThrow(MerchantPaymentIdentifierError);

    expect(() =>
      appendSplit402PaymentIdentifier(
        declareRequiredPaymentIdentifierExtension(),
        "txn_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      )
    ).toThrow(MerchantPaymentIdentifierError);
  });
});

function createPaymentPayload(
  extensions: Record<string, unknown>
): PaymentPayload {
  return {
    x402Version: 2,
    resource: {
      url: "https://api.example.com/v1/risk"
    },
    accepted: {
      scheme: "exact",
      network: "solana:devnet",
      amount: "10000",
      asset: "So11111111111111111111111111111111111111112",
      payTo: "Merchant111111111111111111111111111111111111",
      maxTimeoutSeconds: 60,
      extra: {}
    },
    payload: {},
    extensions
  };
}

function readPaymentIdentifierInfo(
  extensions: Record<string, unknown>
): Record<string, unknown> {
  const extension = extensions[SPLIT402_PAYMENT_IDENTIFIER_EXTENSION_KEY];
  if (typeof extension !== "object" || extension === null || Array.isArray(extension)) {
    throw new Error("missing payment-identifier extension");
  }
  const info = (extension as Record<string, unknown>).info;
  if (typeof info !== "object" || info === null || Array.isArray(info)) {
    throw new Error("missing payment-identifier info");
  }
  return info as Record<string, unknown>;
}
