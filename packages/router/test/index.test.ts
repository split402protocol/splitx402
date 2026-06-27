import {
  createSampleProtocolArtifacts,
  type Split402ReceiptV1
} from "@split402/protocol";
import { describe, expect, it, vi } from "vitest";

import {
  Split402Router,
  Split402RouterProviderError,
  type Split402CapabilityProvider,
  type Split402RouterExecutor
} from "../src/index.js";

const sample = createSampleProtocolArtifacts();
const receipt = sample.artifacts.receipt;
const merchantPublicKey = sample.keys.merchantPublicKey;

describe("Split402Router", () => {
  it("selects the cheapest provider within budget when reliability is equal", () => {
    const router = new Split402Router({
      providers: [
        provider({ providerId: "provider-expensive", amountAtomic: "50000" }),
        provider({ providerId: "provider-cheap", amountAtomic: "10000" }),
        provider({ providerId: "provider-over-budget", amountAtomic: "90000" })
      ]
    });

    expect(
      router
        .rankProviders({
          capability: "solana.wallet-risk",
          input: {},
          budget: {
            network: receipt.network,
            asset: receipt.asset,
            maxAmountAtomic: "50000"
          }
        })
        .map((item) => item.providerId)
    ).toEqual(["provider-cheap", "provider-expensive"]);
  });

  it("selects higher reliability before a cheaper provider", () => {
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-cheaper",
          amountAtomic: "10000",
          reliability: { successRateBps: 9000, medianLatencyMs: 50 }
        }),
        provider({
          providerId: "provider-reliable",
          amountAtomic: "20000",
          reliability: { successRateBps: 9900, medianLatencyMs: 200 }
        })
      ]
    });

    expect(
      router
        .rankProviders({
          capability: "solana.wallet-risk",
          input: {},
          budget: {
            network: receipt.network,
            asset: receipt.asset,
            maxAmountAtomic: "50000"
          }
        })
        .map((item) => item.providerId)
    ).toEqual(["provider-reliable", "provider-cheaper"]);
  });

  it("rejects when every provider exceeds budget", async () => {
    const router = new Split402Router({
      providers: [provider({ providerId: "provider-expensive", amountAtomic: "50001" })],
      executor: executorReturning(receipt)
    });

    await expect(
      router.execute({
        capability: "solana.wallet-risk",
        input: { wallet: "wallet_1" },
        budget: {
          network: receipt.network,
          asset: receipt.asset,
          maxAmountAtomic: "50000"
        }
      })
    ).rejects.toMatchObject({
      code: "budget_exceeded"
    });
  });

  it("falls back after retryable provider failure", async () => {
    const execute = vi
      .fn<Split402RouterExecutor["execute"]>()
      .mockRejectedValueOnce(
        new Split402RouterProviderError("upstream unavailable", {
          statusCode: 503
        })
      )
      .mockResolvedValueOnce({
        data: { risk: "low" },
        receipt
      });
    const router = new Split402Router({
      providers: [
        provider({ providerId: "provider-a" }),
        provider({ providerId: "provider-b" })
      ],
      executor: { execute }
    });

    const result = await router.execute<{ risk: string }>({
      capability: "solana.wallet-risk",
      input: { wallet: "wallet_1" },
      budget: {
        network: receipt.network,
        asset: receipt.asset,
        maxAmountAtomic: receipt.requiredAmountAtomic
      }
    });

    expect(result.providerId).toBe("provider-b");
    expect(result.data).toEqual({ risk: "low" });
    expect(result.attempts).toEqual([
      expect.objectContaining({
        providerId: "provider-a",
        status: "failed",
        retryable: true
      }),
      expect.objectContaining({
        providerId: "provider-b",
        status: "success",
        receiptId: receipt.receiptId
      })
    ]);
  });

  it("does not fall back on a non-retryable provider 400", async () => {
    const execute = vi
      .fn<Split402RouterExecutor["execute"]>()
      .mockRejectedValue(
        new Split402RouterProviderError("invalid input", {
          statusCode: 400
        })
      );
    const router = new Split402Router({
      providers: [
        provider({ providerId: "provider-a" }),
        provider({ providerId: "provider-b" })
      ],
      executor: { execute }
    });

    await expect(
      router.execute({
        capability: "solana.wallet-risk",
        input: { wallet: "" },
        budget: {
          network: receipt.network,
          asset: receipt.asset,
          maxAmountAtomic: receipt.requiredAmountAtomic
        }
      })
    ).rejects.toMatchObject({
      code: "execution_failed",
      attempts: [
        expect.objectContaining({
          providerId: "provider-a",
          status: "failed",
          retryable: false
        })
      ]
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("verifies receipts and fails closed by default", async () => {
    const missingKeyRouter = new Split402Router({
      providers: [provider({ providerId: "provider-no-key" }, { omitPublicKey: true })],
      executor: executorReturning(receipt)
    });
    await expect(
      missingKeyRouter.execute({
        capability: "solana.wallet-risk",
        input: { wallet: "wallet_1" },
        budget: {
          network: receipt.network,
          asset: receipt.asset,
          maxAmountAtomic: receipt.requiredAmountAtomic
        },
        maxAttempts: 1
      })
    ).rejects.toMatchObject({
      code: "execution_failed",
      attempts: [
        expect.objectContaining({
          providerId: "provider-no-key",
          retryable: true,
          error: expect.stringContaining("merchantPublicKey is required")
        })
      ]
    });

    const invalidReceipt = {
      ...receipt,
      referrerCreditAtomic: "1"
    };
    const invalidRouter = new Split402Router({
      providers: [provider({ providerId: "provider-invalid" })],
      executor: executorReturning(invalidReceipt)
    });
    await expect(
      invalidRouter.execute({
        capability: "solana.wallet-risk",
        input: { wallet: "wallet_1" },
        budget: {
          network: receipt.network,
          asset: receipt.asset,
          maxAmountAtomic: receipt.requiredAmountAtomic
        },
        maxAttempts: 1
      })
    ).rejects.toMatchObject({
      code: "execution_failed",
      attempts: [
        expect.objectContaining({
          providerId: "provider-invalid",
          retryable: true,
          error: expect.stringContaining("invalid receipt signature")
        })
      ]
    });
  });
});

function provider(
  overrides: Partial<Split402CapabilityProvider> = {},
  options: { omitPublicKey?: boolean } = {}
): Split402CapabilityProvider {
  const base = {
    providerId: "provider-a",
    capability: "solana.wallet-risk",
    merchantOrigin: receipt.merchantOrigin,
    path: "/v1/risk",
    method: "POST",
    operationId: receipt.operationId,
    campaignId: receipt.campaignId,
    network: receipt.network,
    asset: receipt.asset,
    amountAtomic: receipt.requiredAmountAtomic
  } satisfies Omit<Split402CapabilityProvider, "merchantPublicKey">;
  return {
    ...base,
    ...(options.omitPublicKey ? {} : { merchantPublicKey }),
    ...overrides
  };
}

function executorReturning(
  returnedReceipt: Split402ReceiptV1
): Split402RouterExecutor {
  return {
    execute: async () => ({
      data: { ok: true },
      receipt: returnedReceipt
    })
  };
}
