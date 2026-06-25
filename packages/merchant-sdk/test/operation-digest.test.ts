import {
  calculateOperationDigest,
  createSampleProtocolArtifacts
} from "@split402/protocol";
import { describe, expect, it } from "vitest";

import {
  MerchantOperationDigestError,
  buildGetOperationDigestInput,
  buildJsonPostOperationDigestInput,
  calculateGetOperationDigest,
  calculateJsonPostOperationDigest
} from "../src/index.js";

describe("merchant operation digest helpers", () => {
  it("builds canonical GET operation digest inputs", () => {
    const receipt = createSampleProtocolArtifacts().artifacts.receipt;
    const input = {
      merchantId: receipt.merchantId,
      operationId: "wallet-balance",
      pathTemplate: "/v1/wallets/:wallet/balance",
      pathParams: { wallet: receipt.payerWallet },
      query: {
        asset: receipt.asset,
        includePending: "true",
        tag: ["alpha", "beta"]
      },
      paymentId: receipt.paymentId,
      offerNonce: receipt.offerNonce
    };

    expect(buildGetOperationDigestInput(input)).toEqual({
      ...input,
      method: "GET"
    });
    expect(calculateGetOperationDigest(input)).toBe(
      calculateOperationDigest({
        ...input,
        method: "GET"
      })
    );
  });

  it("builds canonical JSON POST operation digest inputs", () => {
    const receipt = createSampleProtocolArtifacts().artifacts.receipt;
    const input = {
      merchantId: receipt.merchantId,
      operationId: receipt.operationId,
      pathTemplate: "/v1/risk/:wallet",
      pathParams: { wallet: receipt.payerWallet },
      query: { includeLabels: "true" },
      body: {
        includeScore: true,
        weights: [1, 2, 3],
        metadata: { source: "merchant-sdk-test" }
      },
      paymentId: receipt.paymentId,
      offerNonce: receipt.offerNonce
    };

    expect(buildJsonPostOperationDigestInput(input)).toEqual({
      ...input,
      method: "POST"
    });
    expect(calculateJsonPostOperationDigest(input)).toBe(
      calculateOperationDigest({
        ...input,
        method: "POST"
      })
    );
  });

  it("rejects non-JSON-compatible request values before hashing", () => {
    const receipt = createSampleProtocolArtifacts().artifacts.receipt;
    const base = {
      merchantId: receipt.merchantId,
      operationId: receipt.operationId,
      pathTemplate: "/v1/risk/:wallet",
      paymentId: receipt.paymentId,
      offerNonce: receipt.offerNonce
    };
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() =>
      calculateJsonPostOperationDigest({
        ...base,
        body: { invalid: undefined }
      })
    ).toThrow(MerchantOperationDigestError);
    expect(() =>
      calculateJsonPostOperationDigest({
        ...base,
        body: { invalid: Number.NaN }
      })
    ).toThrow(MerchantOperationDigestError);
    expect(() =>
      calculateJsonPostOperationDigest({
        ...base,
        body: circular
      })
    ).toThrow(MerchantOperationDigestError);
    expect(() =>
      calculateGetOperationDigest({
        ...base,
        pathParams: { wallet: undefined }
      })
    ).toThrow(MerchantOperationDigestError);
  });
});
