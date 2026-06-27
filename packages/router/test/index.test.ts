import {
  createSampleProtocolArtifacts,
  type Split402ReceiptV1
} from "@split402/protocol";
import { describe, expect, it, vi } from "vitest";

import {
  Split402ControlPlaneDiscoveryClient,
  Split402Router,
  Split402RouterProviderError,
  type Split402CapabilityProvider,
  type Split402DiscoveryFetch,
  type Split402DiscoveryFetchResponse,
  type Split402RouterExecutor
} from "../src/index.js";

const sample = createSampleProtocolArtifacts();
const receipt = sample.artifacts.receipt;
const referralClaim = sample.artifacts.referralClaim;
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

  it("accepts receipts that match the supplied referral claim", async () => {
    const router = new Split402Router({
      providers: [provider()],
      executor: executorReturning(receipt)
    });

    const result = await router.execute({
      capability: "solana.wallet-risk",
      input: { wallet: "wallet_1" },
      budget: {
        network: receipt.network,
        asset: receipt.asset,
        maxAmountAtomic: receipt.requiredAmountAtomic
      },
      referralClaim,
      maxAttempts: 1
    });

    expect(result.receipt.referralClaimHash).toBe(receipt.referralClaimHash);
  });

  it("rejects receipts whose attribution does not match the supplied referral claim", async () => {
    const cases: Array<{
      name: string;
      returnedReceipt: Split402ReceiptV1;
      expectedError: string;
    }> = [
      {
        name: "route id",
        returnedReceipt: {
          ...receipt,
          routeId: "rte_ffffffffffffffffffffffffffffffff"
        },
        expectedError: "receipt routeId does not match referralClaim routeId"
      },
      {
        name: "claim hash",
        returnedReceipt: {
          ...receipt,
          referralClaimHash:
            "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
        },
        expectedError: "receipt referralClaimHash does not match referralClaim"
      },
      {
        name: "referrer wallet",
        returnedReceipt: {
          ...receipt,
          referrerWallet: sample.keys.payerWallet
        },
        expectedError:
          "receipt referrerWallet does not match referralClaim referrerWallet"
      },
      {
        name: "payout wallet",
        returnedReceipt: {
          ...receipt,
          payoutWallet: sample.keys.payerWallet
        },
        expectedError:
          "receipt payoutWallet does not match referralClaim payoutWallet"
      }
    ];

    for (const testCase of cases) {
      const router = new Split402Router({
        providers: [provider({ providerId: `provider-${testCase.name}` })],
        executor: executorReturning(testCase.returnedReceipt),
        verifyReceipts: false
      });

      await expect(
        router.execute({
          capability: "solana.wallet-risk",
          input: { wallet: "wallet_1" },
          budget: {
            network: receipt.network,
            asset: receipt.asset,
            maxAmountAtomic: receipt.requiredAmountAtomic
          },
          referralClaim,
          maxAttempts: 1
        })
      ).rejects.toMatchObject({
        code: "execution_failed",
        attempts: [
          expect.objectContaining({
            retryable: true,
            error: expect.stringContaining(testCase.expectedError)
          })
        ]
      });
    }
  });
});

describe("Split402ControlPlaneDiscoveryClient", () => {
  it("discovers router providers from control-plane route and Bazaar metadata", async () => {
    const calls: Array<{ url: string; authorization?: string }> = [];
    const discovery = new Split402ControlPlaneDiscoveryClient({
      controlPlaneUrl: "https://control.example/base/",
      bearerToken: "control-token",
      fetch: controlPlaneFetch(calls),
      capabilityMapper: (resource) =>
        resource.metadata.operationId === "risk.score"
          ? "solana.wallet-risk"
          : undefined,
      now: () => new Date("2026-06-24T00:03:00.000Z")
    });

    const providers = await discovery.discoverProviders({
      capability: "solana.wallet-risk",
      limit: 25
    });

    expect(providers).toEqual([
      expect.objectContaining({
        providerId: "rte_1:risk.score",
        capability: "solana.wallet-risk",
        routeId: "rte_1",
        merchantOrigin: receipt.merchantOrigin,
        path: "/v1/risk",
        method: "POST",
        operationId: "risk.score",
        campaignId: receipt.campaignId,
        merchantPublicKey,
        network: receipt.network,
        asset: receipt.asset,
        amountAtomic: receipt.requiredAmountAtomic,
        metadata: expect.objectContaining({
          referrerWallet: receipt.referrerWallet,
          payoutWallet: receipt.payoutWallet
        })
      })
    ]);
    expect(calls).toEqual([
      {
        url: "https://control.example/v1/routes/search?status=active&limit=25",
        authorization: "Bearer control-token"
      },
      {
        url: "https://control.example/v1/routes/rte_1/bazaar-resources",
        authorization: "Bearer control-token"
      },
      {
        url: `https://control.example/v1/campaigns/${receipt.campaignId}`,
        authorization: "Bearer control-token"
      },
      {
        url: `https://control.example/v1/merchants/${receipt.merchantId}`,
        authorization: "Bearer control-token"
      }
    ]);
  });

  it("skips discovered providers without a merchant verification key by default", async () => {
    const discovery = new Split402ControlPlaneDiscoveryClient({
      controlPlaneUrl: "https://control.example",
      fetch: controlPlaneFetch([], { omitMerchantKey: true })
    });

    await expect(discovery.discoverProviders()).resolves.toEqual([]);
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

function controlPlaneFetch(
  calls: Array<{ url: string; authorization?: string }>,
  options: { omitMerchantKey?: boolean } = {}
): Split402DiscoveryFetch {
  return async (url, init) => {
    calls.push({
      url,
      ...(init?.headers?.authorization === undefined
        ? {}
        : { authorization: init.headers.authorization })
    });
    const parsed = new URL(url);
    if (parsed.pathname === "/v1/routes/search") {
      return jsonResponse({
        routes: [
          {
            id: "rte_1",
            campaignId: receipt.campaignId
          }
        ]
      });
    }
    if (parsed.pathname === "/v1/routes/rte_1/bazaar-resources") {
      return jsonResponse({
        resources: [
          {
            schema: "split402.bazaar_resource.v1",
            resource: `${receipt.merchantOrigin}/v1/risk`,
            type: "http",
            x402Version: 2,
            accepts: [
              {
                scheme: "exact",
                network: receipt.network,
                amount: receipt.requiredAmountAtomic,
                asset: receipt.asset,
                payTo: receipt.payToWallet
              }
            ],
            metadata: {
              method: "POST",
              operationId: "risk.score",
              split402: {
                routeId: "rte_1",
                campaignId: receipt.campaignId,
                referrerWallet: receipt.referrerWallet,
                payoutWallet: receipt.payoutWallet
              }
            }
          }
        ]
      });
    }
    if (parsed.pathname === `/v1/campaigns/${receipt.campaignId}`) {
      return jsonResponse({
        campaign: {
          merchantId: receipt.merchantId,
          current: {
            merchantKid: receipt.kid
          }
        }
      });
    }
    if (parsed.pathname === `/v1/merchants/${receipt.merchantId}`) {
      return jsonResponse({
        merchant: {
          keys: options.omitMerchantKey
            ? []
            : [
                {
                  kid: receipt.kid,
                  publicKey: merchantPublicKey,
                  purpose: "offer_receipt",
                  validFrom: "2026-06-24T00:00:00.000Z"
                }
              ]
        }
      });
    }
    return jsonResponse({ error: "not_found" }, 404);
  };
}

function jsonResponse(
  body: unknown,
  status = 200
): Split402DiscoveryFetchResponse {
  return {
    status,
    text: async () => JSON.stringify(body)
  };
}
