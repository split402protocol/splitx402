import {
  buildOfferSigningBytes,
  createSampleProtocolArtifacts,
  hexToBytes,
  signEd25519Message,
  type Split402OfferV1,
  type Split402ReceiptV1
} from "@split402/protocol";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";
import { describe, expect, it, vi } from "vitest";

import {
  Split402ControlPlaneDiscoveryClient,
  Split402ExternalX402DiscoveryClient,
  Split402Router,
  Split402RouterProviderError,
  type Split402CapabilityProvider,
  type Split402DiscoveryFetch,
  type Split402DiscoveryFetchResponse,
  type Split402ExternalX402DiscoveryFetch,
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

  it("searches capabilities with optional budget filters", () => {
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-devnet-cheap",
          amountAtomic: "10000",
          network: receipt.network,
          asset: receipt.asset
        }),
        provider({
          providerId: "provider-devnet-expensive",
          amountAtomic: "60000",
          network: receipt.network,
          asset: receipt.asset
        }),
        provider({
          providerId: "provider-other-asset",
          amountAtomic: "10000",
          network: receipt.network,
          asset: "other-asset"
        })
      ]
    });

    expect(
      router
        .searchCapabilities({
          capability: "solana.wallet-risk",
          budget: {
            network: receipt.network,
            asset: receipt.asset,
            maxAmountAtomic: "50000"
          }
        })
        .map((item) => item.providerId)
    ).toEqual(["provider-devnet-cheap"]);
  });

  it("ignores malformed provider prices during search and budgeted ranking", () => {
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-invalid-price",
          amountAtomic: "10.5"
        }),
        provider({
          providerId: "provider-valid",
          amountAtomic: "10000"
        })
      ]
    });

    const input = {
      capability: "solana.wallet-risk",
      input: {},
      budget: {
        network: receipt.network,
        asset: receipt.asset,
        maxAmountAtomic: "50000"
      }
    };

    expect(router.rankProviders(input).map((item) => item.providerId)).toEqual([
      "provider-valid"
    ]);
    expect(router.searchCapabilities(input).map((item) => item.providerId)).toEqual([
      "provider-valid"
    ]);
    expect(
      router
        .searchCapabilities({
          capability: "solana.wallet-risk"
        })
        .map((item) => item.providerId)
    ).toEqual(["provider-valid"]);
  });

  it("executes a valid provider when another matching provider has a malformed price", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>().mockResolvedValue({
      data: { risk: "low" },
      receipt
    });
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-invalid-price",
          amountAtomic: "10.5"
        }),
        provider({
          providerId: "provider-valid",
          amountAtomic: receipt.requiredAmountAtomic
        })
      ],
      executor: { execute }
    });

    const result = await router.execute({
      capability: "solana.wallet-risk",
      input: { wallet: "wallet_1" },
      budget: {
        network: receipt.network,
        asset: receipt.asset,
        maxAmountAtomic: receipt.requiredAmountAtomic
      }
    });

    expect(result.providerId).toBe("provider-valid");
    expect(result.provider).toEqual(
      expect.objectContaining({
        providerId: "provider-valid",
        payToWallet: receipt.payToWallet,
        amountAtomic: receipt.requiredAmountAtomic
      })
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.objectContaining({ providerId: "provider-valid" })
      })
    );
  });

  it("passes EVM signer config to provider execution", async () => {
    const evmReceipt = {
      ...receipt,
      network: "eip155:8453"
    } satisfies Split402ReceiptV1;
    const execute = vi.fn<Split402RouterExecutor["execute"]>().mockResolvedValue({
      data: { price: "100000" },
      receipt: evmReceipt
    });
    const evmSigner = {
      address: "0x0000000000000000000000000000000000000001" as const,
      signTypedData: vi.fn(async () => "0x01" as const)
    };
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-base",
          capability: "crypto.price",
          network: evmReceipt.network,
          amountAtomic: evmReceipt.requiredAmountAtomic
        })
      ],
      evmSigner,
      evmNetworks: ["eip155:8453"],
      executor: { execute },
      verifyReceipts: false
    });

    await router.execute({
      capability: "crypto.price",
      input: { format: "json" },
      budget: {
        network: evmReceipt.network,
        asset: evmReceipt.asset,
        maxAmountAtomic: evmReceipt.requiredAmountAtomic
      }
    });

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        evmSigner,
        evmNetworks: ["eip155:8453"],
        provider: expect.objectContaining({
          network: "eip155:8453"
        })
      })
    );
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

  it("skips providers whose route metadata conflicts with the supplied referral claim", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>().mockResolvedValue({
      data: { risk: "low" },
      receipt
    });
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-wrong-route",
          routeId: "rte_ffffffffffffffffffffffffffffffff",
          reliability: { successRateBps: 10_000 }
        }),
        provider({
          providerId: "provider-matching-route",
          routeId: referralClaim.routeId,
          metadata: {
            referrerWallet: referralClaim.referrerWallet,
            payoutWallet: referralClaim.payoutWallet
          },
          reliability: { successRateBps: 9000 }
        })
      ],
      executor: { execute }
    });

    const result = await router.execute({
      capability: "solana.wallet-risk",
      input: { wallet: "wallet_1" },
      budget: {
        network: receipt.network,
        asset: receipt.asset,
        maxAmountAtomic: receipt.requiredAmountAtomic
      },
      referralClaim
    });

    expect(result.providerId).toBe("provider-matching-route");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.objectContaining({
          providerId: "provider-matching-route"
        }),
        referralClaim
      })
    );
  });

  it("rejects before execution when no provider metadata matches the supplied referral claim", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>();
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-wrong-route",
          routeId: "rte_ffffffffffffffffffffffffffffffff"
        }),
        provider({
          providerId: "provider-wrong-wallets",
          routeId: referralClaim.routeId,
          metadata: {
            referrerWallet: sample.keys.payerWallet,
            payoutWallet: referralClaim.payoutWallet
          }
        })
      ],
      executor: { execute }
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
        referralClaim
      })
    ).rejects.toMatchObject({
      code: "execution_failed",
      message: "no providers match the supplied referralClaim for solana.wallet-risk",
      attempts: [
        expect.objectContaining({
          providerId: "provider-wrong-route",
          retryable: false,
          error: expect.stringContaining(
            "provider routeId does not match referralClaim routeId"
          )
        }),
        expect.objectContaining({
          providerId: "provider-wrong-wallets",
          retryable: false,
          error: expect.stringContaining(
            "provider referrerWallet does not match referralClaim referrerWallet"
          )
        })
      ]
    });
    expect(execute).not.toHaveBeenCalled();
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
        name: "pay-to wallet",
        returnedReceipt: {
          ...receipt,
          payToWallet: sample.keys.payerWallet
        },
        expectedError:
          "receipt payToWallet does not match provider payToWallet"
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
        payToWallet: receipt.payToWallet,
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

  it("discovers GET router providers from control-plane route metadata", async () => {
    const discovery = new Split402ControlPlaneDiscoveryClient({
      controlPlaneUrl: "https://control.example",
      fetch: controlPlaneFetch([], {
        resourceOverrides: {
          resource: `${receipt.merchantOrigin}/price/btc`,
          metadata: {
            method: "GET",
            operationId: "price.btc",
            split402: {
              routeId: "rte_1",
              campaignId: receipt.campaignId,
              referrerWallet: receipt.referrerWallet,
              payoutWallet: receipt.payoutWallet
            }
          }
        }
      }),
      capabilityMapper: (resource) =>
        resource.metadata.operationId === "price.btc"
          ? "crypto.price"
          : undefined,
      now: () => new Date("2026-06-24T00:03:00.000Z")
    });

    await expect(
      discovery.discoverProviders({ capability: "crypto.price" })
    ).resolves.toEqual([
      expect.objectContaining({
        providerId: "rte_1:price.btc",
        capability: "crypto.price",
        merchantOrigin: receipt.merchantOrigin,
        path: "/price/btc",
        method: "GET",
        operationId: "price.btc",
        campaignId: receipt.campaignId
      })
    ]);
  });

  it("skips discovered providers without a merchant verification key by default", async () => {
    const discovery = new Split402ControlPlaneDiscoveryClient({
      controlPlaneUrl: "https://control.example",
      fetch: controlPlaneFetch([], { omitMerchantKey: true })
    });

    await expect(discovery.discoverProviders()).resolves.toEqual([]);
  });

  it("skips discovered providers with blank or malformed payment fields", async () => {
    const blankPayToDiscovery = new Split402ControlPlaneDiscoveryClient({
      controlPlaneUrl: "https://control.example",
      fetch: controlPlaneFetch([], {
        resourceOverrides: {
          accepts: [
            {
              scheme: "exact",
              network: receipt.network,
              amount: receipt.requiredAmountAtomic,
              asset: receipt.asset,
              payTo: "   "
            }
          ]
        }
      })
    });
    await expect(blankPayToDiscovery.discoverProviders()).resolves.toEqual([]);

    const malformedAmountDiscovery = new Split402ControlPlaneDiscoveryClient({
      controlPlaneUrl: "https://control.example",
      fetch: controlPlaneFetch([], {
        resourceOverrides: {
          accepts: [
            {
              scheme: "exact",
              network: receipt.network,
              amount: "10.5",
              asset: receipt.asset,
              payTo: receipt.payToWallet
            }
          ]
        }
      })
    });
    await expect(malformedAmountDiscovery.discoverProviders()).resolves.toEqual([]);
  });
});

describe("Split402ExternalX402DiscoveryClient", () => {
  it("discovers external x402 routes but blocks router use until Split402 campaign wiring exists", async () => {
    const discovery = new Split402ExternalX402DiscoveryClient({
      merchantOrigin: "https://x402.example",
      fetch: externalX402Fetch({
        paymentRequired: externalPaymentRequired({ includeSplit402: false })
      }),
      providerIdPrefix: "revenue-dojo",
      capabilityMapper: (route) =>
        route.operationId === "get.price.coin" ? "crypto.price" : undefined
    });

    await expect(
      discovery.discoverCandidates({ capability: "crypto.price" })
    ).resolves.toEqual([
      expect.objectContaining({
        providerId: "revenue-dojo:get.price.coin",
        capability: "crypto.price",
        merchantOrigin: "https://x402.example",
        path: "/price/btc",
        method: "GET",
        operationId: "get.price.coin",
        network: "eip155:8453",
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        payToWallet: "0x68614873C5d624c07DCAA3aFF5243DD5027c3910",
        amountAtomic: "20000",
        readiness: "requires_split402_campaign",
        blockers: ["missing Split402 offer extension"],
        source: {
          manifest: true,
          openapi: true,
          paymentRequiredHeader: true
        }
      })
    ]);
  });

  it("reports invalid Split402 offer extensions separately from missing extensions", async () => {
    const discovery = new Split402ExternalX402DiscoveryClient({
      merchantOrigin: "https://x402.example",
      fetch: externalX402Fetch({
        paymentRequired: externalPaymentRequired({
          split402Info: {
            ...sample.artifacts.offer,
            asset: "not-a-payment-identifier"
          }
        })
      }),
      providerIdPrefix: "invalid-offer",
      capabilityMapper: () => "crypto.price"
    });

    await expect(
      discovery.discoverCandidates({ capability: "crypto.price" })
    ).resolves.toEqual([
      expect.objectContaining({
        providerId: "invalid-offer:get.price.coin",
        readiness: "requires_split402_campaign",
        blockers: ["invalid Split402 offer extension"],
        split402OfferErrors: expect.arrayContaining([
          expect.stringContaining("asset:")
        ])
      })
    ]);
  });

  it("blocks router use when Split402 offers conflict with x402 payment metadata", async () => {
    const { offer, publicKey } = createSignedEvmOffer();
    const discovery = new Split402ExternalX402DiscoveryClient({
      merchantOrigin: "https://x402.example",
      fetch: externalX402Fetch({
        paymentRequired: externalPaymentRequired({
          split402Offer: offer,
          acceptOverrides: {
            network: "eip155:84532",
            amount: "10000",
            payTo: "0x0000000000000000000000000000000000000001"
          }
        })
      }),
      providerIdPrefix: "conflicting-offer",
      merchantPublicKey: publicKey,
      capabilityMapper: () => "crypto.price"
    });

    await expect(
      discovery.discoverCandidates({ capability: "crypto.price" })
    ).resolves.toEqual([
      expect.objectContaining({
        providerId: "conflicting-offer:get.price.coin",
        readiness: "requires_split402_campaign",
        blockers: ["Split402 offer does not match x402 payment metadata"],
        split402Offer: offer,
        split402OfferErrors: expect.arrayContaining([
          expect.stringContaining("network: expected eip155:84532"),
          expect.stringContaining("payToWallet: expected 0x0000000000000000000000000000000000000001"),
          expect.stringContaining("requiredAmountAtomic: expected 10000")
        ])
      })
    ]);
  });

  it("blocks router use when Split402 offer signatures cannot be verified", async () => {
    const { offer } = createSignedEvmOffer();
    const missingKeyDiscovery = new Split402ExternalX402DiscoveryClient({
      merchantOrigin: "https://x402.example",
      fetch: externalX402Fetch({
        paymentRequired: externalPaymentRequired({ split402Offer: offer })
      }),
      providerIdPrefix: "missing-key",
      capabilityMapper: () => "crypto.price"
    });

    await expect(
      missingKeyDiscovery.discoverCandidates({ capability: "crypto.price" })
    ).resolves.toEqual([
      expect.objectContaining({
        providerId: "missing-key:get.price.coin",
        readiness: "requires_split402_campaign",
        blockers: ["missing merchant public key for Split402 offer verification"],
        split402OfferErrors: [
          "merchantPublicKey: required to verify Split402 offer signature"
        ]
      })
    ]);

    const wrongKeyDiscovery = new Split402ExternalX402DiscoveryClient({
      merchantOrigin: "https://x402.example",
      fetch: externalX402Fetch({
        paymentRequired: externalPaymentRequired({ split402Offer: offer })
      }),
      providerIdPrefix: "wrong-key",
      merchantPublicKey,
      capabilityMapper: () => "crypto.price"
    });

    await expect(
      wrongKeyDiscovery.discoverCandidates({ capability: "crypto.price" })
    ).resolves.toEqual([
      expect.objectContaining({
        providerId: "wrong-key:get.price.coin",
        readiness: "requires_split402_campaign",
        blockers: ["invalid Split402 offer signature"],
        split402OfferErrors: ["invalid offer signature"]
      })
    ]);
  });

  it("creates router-ready providers when external x402 routes include Split402 offers", async () => {
    const discovery = new Split402ExternalX402DiscoveryClient({
      merchantOrigin: receipt.merchantOrigin,
      fetch: externalX402Fetch({
        paymentRequired: externalPaymentRequired({ includeSplit402: true })
      }),
      providerIdPrefix: "split402-ready",
      merchantPublicKey,
      capabilityMapper: () => "solana.wallet-risk"
    });

    const candidates = await discovery.discoverCandidates({
      capability: "solana.wallet-risk"
    });

    expect(candidates).toEqual([
      expect.objectContaining({
        providerId: "split402-ready:get.price.coin",
        readiness: "router_ready",
        blockers: [],
        split402Offer: sample.artifacts.offer,
        provider: expect.objectContaining({
          providerId: "split402-ready:get.price.coin",
          capability: "solana.wallet-risk",
          merchantOrigin: receipt.merchantOrigin,
          path: "/price/btc",
          method: "GET",
          operationId: sample.artifacts.offer.operationId,
          campaignId: sample.artifacts.offer.campaignId,
          merchantPublicKey,
          network: sample.artifacts.offer.network,
          asset: sample.artifacts.offer.asset,
          payToWallet: sample.artifacts.offer.payToWallet,
          amountAtomic: sample.artifacts.offer.requiredAmountAtomic
        })
      })
    ]);
  });

  it("creates router-ready providers for Base x402 routes with EVM Split402 offers", async () => {
    const { offer, publicKey } = createSignedEvmOffer();
    const discovery = new Split402ExternalX402DiscoveryClient({
      merchantOrigin: "https://x402.example",
      fetch: externalX402Fetch({
        paymentRequired: externalPaymentRequired({ split402Offer: offer })
      }),
      providerIdPrefix: "base-ready",
      merchantPublicKey: publicKey,
      capabilityMapper: () => "crypto.price"
    });

    await expect(
      discovery.discoverCandidates({ capability: "crypto.price" })
    ).resolves.toEqual([
      expect.objectContaining({
        providerId: "base-ready:get.price.coin",
        readiness: "router_ready",
        blockers: [],
        split402Offer: offer,
        provider: expect.objectContaining({
          providerId: "base-ready:get.price.coin",
          capability: "crypto.price",
          merchantOrigin: "https://x402.example",
          path: "/price/btc",
          method: "GET",
          operationId: "price.btc",
          campaignId: offer.campaignId,
          merchantPublicKey: publicKey,
          network: "eip155:8453",
          asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          payToWallet: "0x68614873C5d624c07DCAA3aFF5243DD5027c3910",
          amountAtomic: "20000"
        })
      })
    ]);
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
    payToWallet: receipt.payToWallet,
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
  options: {
    omitMerchantKey?: boolean;
    resourceOverrides?: Record<string, unknown>;
  } = {}
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
      const resource = {
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
      };
      return jsonResponse({
        resources: [
          {
            ...resource,
            ...(options.resourceOverrides ?? {})
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

function externalX402Fetch(options: {
  paymentRequired: PaymentRequired;
}): Split402ExternalX402DiscoveryFetch {
  return async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/.well-known/x402") {
      return jsonResponse({
        version: 1,
        resources: ["https://x402.example/price/btc"],
        ownershipProofs: ["0x68614873C5d624c07DCAA3aFF5243DD5027c3910"],
        paid_routes: [
          {
            method: "GET",
            path: "/price/{coin}",
            price: "$0.02",
            description: "Specific coin USD price.",
            example_unpaid_curl: "curl -i https://x402.example/price/btc"
          },
          {
            method: "GET",
            path: "/mcp/tools",
            price: "free",
            description: "Free tool catalog."
          }
        ],
        facilitator: "https://api.cdp.coinbase.com/platform/v2/x402"
      });
    }
    if (parsed.pathname === "/openapi.json") {
      return jsonResponse({
        openapi: "3.0.3",
        paths: {
          "/price/{coin}": {
            get: {
              description: "Returns current price for a specific cryptocurrency.",
              parameters: [
                {
                  name: "coin",
                  in: "path",
                  required: true,
                  schema: {
                    type: "string",
                    enum: ["btc", "eth"]
                  }
                }
              ],
              "x-payment-info": {
                price: {
                  mode: "fixed",
                  currency: "USD",
                  amount: "0.02"
                }
              },
              responses: {
                402: {
                  description: "Payment required"
                }
              }
            }
          }
        }
      });
    }
    if (parsed.pathname === "/price/btc") {
      return textResponse("", {
        status: 402,
        headers: {
          "Payment-Required": encodePaymentRequiredHeader(options.paymentRequired)
        }
      });
    }
    return jsonResponse({}, 404);
  };
}

function externalPaymentRequired(options: {
  includeSplit402?: boolean;
  split402Offer?: Split402OfferV1;
  split402Info?: unknown;
  acceptOverrides?: Partial<{
    network: `${string}:${string}`;
    asset: string;
    amount: string;
    payTo: string;
  }>;
}): PaymentRequired {
  const offer =
    options.split402Offer ??
    (options.includeSplit402 === true ? sample.artifacts.offer : undefined);
  const split402Info = options.split402Info ?? offer;
  if (split402Info !== undefined) {
    const paymentOffer = offer ?? sample.artifacts.offer;
    return {
      x402Version: 2,
      error: "Payment required",
      resource: {
        url: `${receipt.merchantOrigin}/price/btc`,
        description: "Split402-enabled price route",
        mimeType: "application/json"
      },
      accepts: [
        {
          scheme: "exact",
          network:
            options.acceptOverrides?.network ??
            (paymentOffer.network as `${string}:${string}`),
          asset: options.acceptOverrides?.asset ?? paymentOffer.asset,
          amount:
            options.acceptOverrides?.amount ?? paymentOffer.requiredAmountAtomic,
          payTo: options.acceptOverrides?.payTo ?? paymentOffer.payToWallet,
          maxTimeoutSeconds: 300,
          extra: {}
        }
      ],
      extensions: {
        split402: {
          info: split402Info
        }
      }
    };
  }
  return {
    x402Version: 2,
    error: "Payment required",
    resource: {
      url: "https://x402.example/price/btc",
      description: "Specific coin USD price",
      mimeType: "application/json"
    },
    accepts: [
      {
        scheme: "exact",
        network: "eip155:8453",
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        amount: "20000",
        payTo: "0x68614873C5d624c07DCAA3aFF5243DD5027c3910",
        maxTimeoutSeconds: 300,
        extra: {
          name: "USD Coin",
          version: "2"
        }
      }
    ],
    extensions: {
      bazaar: {
        info: {
          input: {
            type: "http",
            method: "GET"
          }
        }
      }
    }
  };
}

function createSignedEvmOffer(): { offer: Split402OfferV1; publicKey: string } {
  const merchantSeed = hexToBytes(
    "101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f"
  );
  const unsignedOffer = {
    ...sample.artifacts.offer,
    resourceOrigin: "https://x402.example",
    operationId: "price.btc",
    network: "eip155:8453",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    payToWallet: "0x68614873C5d624c07DCAA3aFF5243DD5027c3910",
    requiredAmountAtomic: "20000"
  };
  const signature = signEd25519Message(
    buildOfferSigningBytes(unsignedOffer),
    merchantSeed
  );
  return {
    publicKey: signature.publicKey,
    offer: {
      ...unsignedOffer,
      signature: signature.signature
    }
  };
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Split402DiscoveryFetchResponse {
  return {
    status,
    headers,
    text: async () => JSON.stringify(body)
  };
}

function textResponse(
  body: string,
  options: {
    status?: number;
    headers?: Record<string, string>;
  } = {}
): Split402DiscoveryFetchResponse {
  return {
    status: options.status ?? 200,
    headers: options.headers ?? {},
    text: async () => body
  };
}
