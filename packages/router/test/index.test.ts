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
          budget: {
            network: receipt.network,
            asset: receipt.asset,
            maxAmountAtomic: "50000"
          }
        })
        .map((item) => item.providerId)
    ).toEqual(["provider-reliable", "provider-cheaper"]);
  });

  it("quotes selected provider and attempted fallback set before execution", () => {
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
        }),
        provider({
          providerId: "provider-third",
          amountAtomic: "30000",
          reliability: { successRateBps: 8000, medianLatencyMs: 10 }
        })
      ]
    });

    expect(
      router.quoteExecution({
        capability: "solana.wallet-risk",
        budget: {
          network: receipt.network,
          asset: receipt.asset,
          maxAmountAtomic: "50000"
        },
        maxAttempts: 2
      })
    ).toMatchObject({
      capability: "solana.wallet-risk",
      selectedProviderId: "provider-reliable",
      quotedAmountAtomic: "20000",
      maxAttempts: 2,
      rankedProviders: [
        {
          rank: 1,
          providerId: "provider-reliable",
          amountAtomic: "20000",
          reliability: { successRateBps: 9900, medianLatencyMs: 200 }
        },
        {
          rank: 2,
          providerId: "provider-cheaper",
          amountAtomic: "10000",
          reliability: { successRateBps: 9000, medianLatencyMs: 50 }
        }
      ]
    });
  });

  it("quotes only providers that match the supplied referral claim", () => {
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
      ]
    });

    expect(
      router.quoteExecution({
        capability: "solana.wallet-risk",
        budget: {
          network: receipt.network,
          asset: receipt.asset,
          maxAmountAtomic: receipt.requiredAmountAtomic
        },
        referralClaim
      })
    ).toMatchObject({
      selectedProviderId: "provider-matching-route",
      rankedProviders: [
        expect.objectContaining({
          providerId: "provider-matching-route"
        })
      ]
    });
  });

  it("quotes only providers whose inputSchema accepts supplied input", () => {
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-price",
          amountAtomic: "9000",
          metadata: {
            inputSchema: {
              type: "object",
              required: ["symbol"],
              properties: {
                symbol: { type: "string" }
              },
              additionalProperties: false
            }
          }
        }),
        provider({
          providerId: "provider-wallet",
          amountAtomic: receipt.requiredAmountAtomic,
          metadata: {
            inputSchema: {
              type: "object",
              required: ["wallet"],
              properties: {
                wallet: { type: "string" }
              },
              additionalProperties: false
            }
          }
        })
      ]
    });

    expect(
      router.quoteExecution({
        capability: "solana.wallet-risk",
        input: { wallet: "wallet_1" },
        budget: {
          network: receipt.network,
          asset: receipt.asset,
          maxAmountAtomic: receipt.requiredAmountAtomic
        }
      })
    ).toMatchObject({
      selectedProviderId: "provider-wallet",
      rankedProviders: [
        expect.objectContaining({
          providerId: "provider-wallet"
        })
      ]
    });
  });

  it("rejects quotes before payment when input matches no provider schema", () => {
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-wallet",
          metadata: {
            inputSchema: {
              type: "object",
              required: ["wallet"],
              properties: {
                wallet: { type: "string" }
              },
              additionalProperties: false
            }
          }
        })
      ]
    });

    expect(() =>
      router.quoteExecution({
        capability: "solana.wallet-risk",
        input: { wallet: 123 },
        budget: {
          network: receipt.network,
          asset: receipt.asset,
          maxAmountAtomic: receipt.requiredAmountAtomic
        }
      })
    ).toThrow(
      "input does not match any provider inputSchema for solana.wallet-risk"
    );
  });

  it("rejects quotes when every provider exceeds budget", () => {
    const router = new Split402Router({
      providers: [provider({ providerId: "provider-expensive", amountAtomic: "50001" })]
    });

    expect(() =>
      router.quoteExecution({
        capability: "solana.wallet-risk",
        budget: {
          network: receipt.network,
          asset: receipt.asset,
          maxAmountAtomic: "50000"
        }
      })
    ).toThrowError(/exceed the requested budget/u);
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

  it("skips providers whose inputSchema does not accept the request", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>().mockResolvedValue({
      data: { risk: "low" },
      receipt
    });
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-price",
          amountAtomic: "9000",
          metadata: {
            inputSchema: {
              type: "object",
              required: ["symbol"],
              properties: {
                symbol: { type: "string" }
              },
              additionalProperties: false
            }
          }
        }),
        provider({
          providerId: "provider-wallet",
          amountAtomic: receipt.requiredAmountAtomic,
          metadata: {
            inputSchema: {
              type: "object",
              required: ["wallet"],
              properties: {
                wallet: { type: "string" }
              },
              additionalProperties: false
            }
          }
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

    expect(result.providerId).toBe("provider-wallet");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.objectContaining({ providerId: "provider-wallet" }),
        body: { wallet: "wallet_1" }
      })
    );
  });

  it("rejects before payment when no provider inputSchema accepts the request", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>();
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-wallet",
          metadata: {
            inputSchema: {
              type: "object",
              required: ["wallet"],
              properties: {
                wallet: { type: "string" }
              },
              additionalProperties: false
            }
          }
        })
      ],
      executor: { execute }
    });

    await expect(
      router.execute({
        capability: "solana.wallet-risk",
        input: { wallet: 123 },
        budget: {
          network: receipt.network,
          asset: receipt.asset,
          maxAmountAtomic: receipt.requiredAmountAtomic
        }
      })
    ).rejects.toMatchObject({
      code: "invalid_request",
      message: "input does not match any provider inputSchema for solana.wallet-risk",
      attempts: [
        expect.objectContaining({
          providerId: "provider-wallet",
          retryable: false,
          error: expect.stringContaining("input.wallet must be string")
        })
      ]
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("fails closed before payment when a provider inputSchema is malformed", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>();
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-malformed-schema",
          metadata: {
            inputSchema: {
              type: "object",
              required: ["wallet"],
              properties: "wallet"
            }
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
        }
      })
    ).rejects.toMatchObject({
      code: "invalid_request",
      attempts: [
        expect.objectContaining({
          providerId: "provider-malformed-schema",
          retryable: false,
          error: expect.stringContaining("input properties must be an object")
        })
      ]
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects before payment when input violates provider string constraints", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>();
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-wallet-pattern",
          metadata: {
            inputSchema: {
              type: "object",
              required: ["wallet"],
              properties: {
                wallet: {
                  type: "string",
                  pattern: "^wallet_[0-9]+$",
                  minLength: 8,
                  maxLength: 20
                }
              },
              additionalProperties: false
            }
          }
        })
      ],
      executor: { execute }
    });

    await expect(
      router.execute({
        capability: "solana.wallet-risk",
        input: { wallet: "abc" },
        budget: {
          network: receipt.network,
          asset: receipt.asset,
          maxAmountAtomic: receipt.requiredAmountAtomic
        }
      })
    ).rejects.toMatchObject({
      code: "invalid_request",
      attempts: [
        expect.objectContaining({
          providerId: "provider-wallet-pattern",
          retryable: false,
          error: expect.stringContaining(
            "input.wallet must match pattern ^wallet_[0-9]+$"
          )
        })
      ]
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects before payment when input violates provider number constraints", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>();
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-confidence-range",
          metadata: {
            inputSchema: {
              type: "object",
              required: ["confidence"],
              properties: {
                confidence: {
                  type: "integer",
                  minimum: 1,
                  maximum: 100
                }
              },
              additionalProperties: false
            }
          }
        })
      ],
      executor: { execute }
    });

    await expect(
      router.execute({
        capability: "solana.wallet-risk",
        input: { confidence: 0 },
        budget: {
          network: receipt.network,
          asset: receipt.asset,
          maxAmountAtomic: receipt.requiredAmountAtomic
        }
      })
    ).rejects.toMatchObject({
      code: "invalid_request",
      attempts: [
        expect.objectContaining({
          providerId: "provider-confidence-range",
          retryable: false,
          error: expect.stringContaining("input.confidence must be at least 1")
        })
      ]
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("executes when input satisfies provider schema constraints", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>().mockResolvedValue({
      data: { risk: "low" },
      receipt
    });
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-constrained",
          metadata: {
            inputSchema: {
              type: "object",
              required: ["wallet", "confidence"],
              properties: {
                wallet: {
                  type: "string",
                  pattern: "^wallet_[0-9]+$",
                  minLength: 8
                },
                confidence: {
                  type: "integer",
                  minimum: 1,
                  maximum: 100
                }
              },
              additionalProperties: false
            }
          }
        })
      ],
      executor: { execute }
    });

    const input = { wallet: "wallet_123", confidence: 80 };
    const result = await router.execute({
      capability: "solana.wallet-risk",
      input,
      budget: {
        network: receipt.network,
        asset: receipt.asset,
        maxAmountAtomic: receipt.requiredAmountAtomic
      }
    });

    expect(result.providerId).toBe("provider-constrained");
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.objectContaining({ providerId: "provider-constrained" }),
        body: input
      })
    );
  });

  it("rejects before payment when input violates provider array item constraints", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>();
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-wallet-list",
          metadata: {
            inputSchema: {
              type: "object",
              required: ["wallets"],
              properties: {
                wallets: {
                  type: "array",
                  minItems: 1,
                  maxItems: 3,
                  items: {
                    type: "string",
                    pattern: "^wallet_[0-9]+$"
                  }
                }
              },
              additionalProperties: false
            }
          }
        })
      ],
      executor: { execute }
    });

    await expect(
      router.execute({
        capability: "solana.wallet-risk",
        input: { wallets: ["wallet_1", "bad"] },
        budget: {
          network: receipt.network,
          asset: receipt.asset,
          maxAmountAtomic: receipt.requiredAmountAtomic
        }
      })
    ).rejects.toMatchObject({
      code: "invalid_request",
      attempts: [
        expect.objectContaining({
          providerId: "provider-wallet-list",
          retryable: false,
          error: expect.stringContaining(
            "input.wallets[1] must match pattern ^wallet_[0-9]+$"
          )
        })
      ]
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects before payment when input violates provider array length constraints", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>();
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-wallet-list",
          metadata: {
            inputSchema: {
              type: "object",
              required: ["wallets"],
              properties: {
                wallets: {
                  type: "array",
                  minItems: 1,
                  maxItems: 2,
                  items: { type: "string" }
                }
              },
              additionalProperties: false
            }
          }
        })
      ],
      executor: { execute }
    });

    await expect(
      router.execute({
        capability: "solana.wallet-risk",
        input: { wallets: ["wallet_1", "wallet_2", "wallet_3"] },
        budget: {
          network: receipt.network,
          asset: receipt.asset,
          maxAmountAtomic: receipt.requiredAmountAtomic
        }
      })
    ).rejects.toMatchObject({
      code: "invalid_request",
      attempts: [
        expect.objectContaining({
          providerId: "provider-wallet-list",
          retryable: false,
          error: expect.stringContaining("input.wallets must contain at most 2 items")
        })
      ]
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("executes when input satisfies provider array constraints", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>().mockResolvedValue({
      data: { risk: "low" },
      receipt
    });
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-wallet-list",
          metadata: {
            inputSchema: {
              type: "object",
              required: ["wallets"],
              properties: {
                wallets: {
                  type: "array",
                  minItems: 1,
                  maxItems: 3,
                  items: {
                    type: "string",
                    pattern: "^wallet_[0-9]+$"
                  }
                }
              },
              additionalProperties: false
            }
          }
        })
      ],
      executor: { execute }
    });

    const input = { wallets: ["wallet_1", "wallet_2"] };
    const result = await router.execute({
      capability: "solana.wallet-risk",
      input,
      budget: {
        network: receipt.network,
        asset: receipt.asset,
        maxAmountAtomic: receipt.requiredAmountAtomic
      }
    });

    expect(result.providerId).toBe("provider-wallet-list");
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.objectContaining({ providerId: "provider-wallet-list" }),
        body: input
      })
    );
  });

  it("executes when input satisfies nullable provider schema branches", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>().mockResolvedValue({
      data: { risk: "low" },
      receipt
    });
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-nullable-input",
          metadata: {
            inputSchema: {
              type: "object",
              required: ["wallet", "tags", "memo", "details", "score"],
              properties: {
                wallet: { type: "string" },
                tags: {
                  type: ["array", "null"],
                  minItems: 1,
                  items: { type: "string" }
                },
                memo: {
                  type: ["string", "null"],
                  minLength: 3
                },
                details: {
                  type: ["object", "null"],
                  properties: {
                    chain: { type: "string" }
                  },
                  additionalProperties: false
                },
                score: {
                  type: ["integer", "null"],
                  minimum: 1,
                  maximum: 100
                }
              },
              additionalProperties: false
            }
          }
        })
      ],
      executor: { execute }
    });

    const input = {
      wallet: "wallet_1",
      tags: null,
      memo: null,
      details: null,
      score: null
    };
    const result = await router.execute({
      capability: "solana.wallet-risk",
      input,
      budget: {
        network: receipt.network,
        asset: receipt.asset,
        maxAmountAtomic: receipt.requiredAmountAtomic
      }
    });

    expect(result.providerId).toBe("provider-nullable-input");
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.objectContaining({ providerId: "provider-nullable-input" }),
        body: input
      })
    );
  });

  it("rejects before payment when input violates nullable array/object branches", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>();
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-nullable-input",
          metadata: {
            inputSchema: {
              type: "object",
              required: ["wallet", "tags", "details"],
              properties: {
                wallet: { type: "string" },
                tags: {
                  type: ["array", "null"],
                  items: { type: "string" }
                },
                details: {
                  type: ["object", "null"],
                  properties: {
                    chain: { type: "string" }
                  },
                  additionalProperties: false
                }
              },
              additionalProperties: false
            }
          }
        })
      ],
      executor: { execute }
    });

    await expect(
      router.execute({
        capability: "solana.wallet-risk",
        input: {
          wallet: "wallet_1",
          tags: "wallet_2",
          details: "solana"
        },
        budget: {
          network: receipt.network,
          asset: receipt.asset,
          maxAmountAtomic: receipt.requiredAmountAtomic
        }
      })
    ).rejects.toMatchObject({
      code: "invalid_request",
      attempts: [
        expect.objectContaining({
          providerId: "provider-nullable-input",
          retryable: false,
          error: expect.stringContaining("input.tags must be array or null")
        })
      ]
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("keeps numeric constraints on nullable integer branches", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>();
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-nullable-score",
          metadata: {
            inputSchema: {
              type: "object",
              required: ["score"],
              properties: {
                score: {
                  type: ["integer", "null"],
                  minimum: 1,
                  maximum: 100
                }
              },
              additionalProperties: false
            }
          }
        })
      ],
      executor: { execute }
    });

    await expect(
      router.execute({
        capability: "solana.wallet-risk",
        input: { score: 0 },
        budget: {
          network: receipt.network,
          asset: receipt.asset,
          maxAmountAtomic: receipt.requiredAmountAtomic
        }
      })
    ).rejects.toMatchObject({
      code: "invalid_request",
      attempts: [
        expect.objectContaining({
          providerId: "provider-nullable-score",
          retryable: false,
          error: expect.stringContaining("input.score must be at least 1")
        })
      ]
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("executes when input satisfies provider anyOf schema", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>().mockResolvedValue({
      data: { risk: "low" },
      receipt
    });
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-anyof-input",
          metadata: {
            inputSchema: {
              anyOf: [
                {
                  type: "object",
                  required: ["wallet"],
                  properties: {
                    wallet: { type: "string" }
                  },
                  additionalProperties: false
                },
                {
                  type: "object",
                  required: ["account"],
                  properties: {
                    account: { type: "string" }
                  },
                  additionalProperties: false
                }
              ]
            }
          }
        })
      ],
      executor: { execute }
    });

    const input = { wallet: "wallet_1" };
    const result = await router.execute({
      capability: "solana.wallet-risk",
      input,
      budget: {
        network: receipt.network,
        asset: receipt.asset,
        maxAmountAtomic: receipt.requiredAmountAtomic
      }
    });

    expect(result.providerId).toBe("provider-anyof-input");
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.objectContaining({ providerId: "provider-anyof-input" }),
        body: input
      })
    );
  });

  it("rejects before payment when input matches no provider anyOf schema", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>();
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-anyof-input",
          metadata: {
            inputSchema: {
              anyOf: [
                {
                  type: "object",
                  required: ["wallet"],
                  properties: { wallet: { type: "string" } },
                  additionalProperties: false
                },
                {
                  type: "object",
                  required: ["account"],
                  properties: { account: { type: "string" } },
                  additionalProperties: false
                }
              ]
            }
          }
        })
      ],
      executor: { execute }
    });

    await expect(
      router.execute({
        capability: "solana.wallet-risk",
        input: { symbol: "SOL" },
        budget: {
          network: receipt.network,
          asset: receipt.asset,
          maxAmountAtomic: receipt.requiredAmountAtomic
        }
      })
    ).rejects.toMatchObject({
      code: "invalid_request",
      attempts: [
        expect.objectContaining({
          providerId: "provider-anyof-input",
          retryable: false,
          error: expect.stringContaining(
            "input must match at least one anyOf schema"
          )
        })
      ]
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects before payment when input violates provider oneOf uniqueness", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>();
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-oneof-input",
          metadata: {
            inputSchema: {
              oneOf: [
                {
                  type: "object",
                  required: ["wallet"],
                  properties: { wallet: { type: "string" } }
                },
                {
                  type: "object",
                  required: ["wallet"],
                  properties: { wallet: { pattern: "^wallet_" } }
                }
              ]
            }
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
        }
      })
    ).rejects.toMatchObject({
      code: "invalid_request",
      attempts: [
        expect.objectContaining({
          providerId: "provider-oneof-input",
          retryable: false,
          error: expect.stringContaining(
            "input must match exactly one oneOf schema"
          )
        })
      ]
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("executes when input satisfies exactly one provider oneOf schema", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>().mockResolvedValue({
      data: { risk: "low" },
      receipt
    });
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-oneof-input",
          metadata: {
            inputSchema: {
              oneOf: [
                {
                  type: "object",
                  required: ["wallet"],
                  properties: { wallet: { type: "string" } },
                  additionalProperties: false
                },
                {
                  type: "object",
                  required: ["account"],
                  properties: { account: { type: "string" } },
                  additionalProperties: false
                }
              ]
            }
          }
        })
      ],
      executor: { execute }
    });

    const input = { wallet: "wallet_1" };
    const result = await router.execute({
      capability: "solana.wallet-risk",
      input,
      budget: {
        network: receipt.network,
        asset: receipt.asset,
        maxAmountAtomic: receipt.requiredAmountAtomic
      }
    });

    expect(result.providerId).toBe("provider-oneof-input");
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.objectContaining({ providerId: "provider-oneof-input" }),
        body: input
      })
    );
  });

  it("executes when input satisfies every provider allOf schema", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>().mockResolvedValue({
      data: { risk: "low" },
      receipt
    });
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-allof-input",
          metadata: {
            inputSchema: {
              allOf: [
                {
                  type: "object",
                  required: ["wallet"],
                  properties: { wallet: { type: "string" } }
                },
                {
                  type: "object",
                  properties: { wallet: { pattern: "^wallet_[0-9]+$" } }
                }
              ]
            }
          }
        })
      ],
      executor: { execute }
    });

    const input = { wallet: "wallet_1" };
    const result = await router.execute({
      capability: "solana.wallet-risk",
      input,
      budget: {
        network: receipt.network,
        asset: receipt.asset,
        maxAmountAtomic: receipt.requiredAmountAtomic
      }
    });

    expect(result.providerId).toBe("provider-allof-input");
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.objectContaining({ providerId: "provider-allof-input" }),
        body: input
      })
    );
  });

  it("rejects before payment when input violates a provider allOf schema", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>();
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-allof-input",
          metadata: {
            inputSchema: {
              allOf: [
                {
                  type: "object",
                  required: ["wallet"],
                  properties: { wallet: { type: "string" } }
                },
                {
                  type: "object",
                  properties: { wallet: { pattern: "^wallet_[0-9]+$" } }
                }
              ]
            }
          }
        })
      ],
      executor: { execute }
    });

    await expect(
      router.execute({
        capability: "solana.wallet-risk",
        input: { wallet: "bad" },
        budget: {
          network: receipt.network,
          asset: receipt.asset,
          maxAmountAtomic: receipt.requiredAmountAtomic
        }
      })
    ).rejects.toMatchObject({
      code: "invalid_request",
      attempts: [
        expect.objectContaining({
          providerId: "provider-allof-input",
          retryable: false,
          error: expect.stringContaining("input must match allOf schema 2")
        })
      ]
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("executes when input does not match provider not schema", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>().mockResolvedValue({
      data: { risk: "low" },
      receipt
    });
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-not-input",
          metadata: {
            inputSchema: {
              type: "object",
              required: ["wallet"],
              properties: {
                wallet: { type: "string" }
              },
              not: {
                type: "object",
                required: ["sandboxOnly"],
                properties: {
                  sandboxOnly: { const: true }
                }
              }
            }
          }
        })
      ],
      executor: { execute }
    });

    const input = { wallet: "wallet_1" };
    const result = await router.execute({
      capability: "solana.wallet-risk",
      input,
      budget: {
        network: receipt.network,
        asset: receipt.asset,
        maxAmountAtomic: receipt.requiredAmountAtomic
      }
    });

    expect(result.providerId).toBe("provider-not-input");
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.objectContaining({ providerId: "provider-not-input" }),
        body: input
      })
    );
  });

  it("rejects before payment when input matches provider not schema", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>();
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-not-input",
          metadata: {
            inputSchema: {
              type: "object",
              required: ["wallet"],
              properties: {
                wallet: { type: "string" }
              },
              not: {
                type: "object",
                required: ["sandboxOnly"],
                properties: {
                  sandboxOnly: { const: true }
                }
              }
            }
          }
        })
      ],
      executor: { execute }
    });

    await expect(
      router.execute({
        capability: "solana.wallet-risk",
        input: { wallet: "wallet_1", sandboxOnly: true },
        budget: {
          network: receipt.network,
          asset: receipt.asset,
          maxAmountAtomic: receipt.requiredAmountAtomic
        }
      })
    ).rejects.toMatchObject({
      code: "invalid_request",
      attempts: [
        expect.objectContaining({
          providerId: "provider-not-input",
          retryable: false,
          error: expect.stringContaining("input must not match not schema")
        })
      ]
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects malformed provider combinator schemas before payment", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>();
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-malformed-combinator",
          metadata: {
            inputSchema: {
              anyOf: []
            }
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
        }
      })
    ).rejects.toMatchObject({
      code: "invalid_request",
      attempts: [
        expect.objectContaining({
          providerId: "provider-malformed-combinator",
          retryable: false,
          error: expect.stringContaining(
            "input anyOf must be a non-empty array of schema objects"
          )
        })
      ]
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects malformed provider not schemas before payment", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>();
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-malformed-not",
          metadata: {
            inputSchema: {
              type: "object",
              not: true
            }
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
        }
      })
    ).rejects.toMatchObject({
      code: "invalid_request",
      attempts: [
        expect.objectContaining({
          providerId: "provider-malformed-not",
          retryable: false,
          error: expect.stringContaining("input not must be a schema object")
        })
      ]
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("executes when input satisfies provider const and uniqueItems constraints", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>().mockResolvedValue({
      data: { risk: "low" },
      receipt
    });
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-const-unique",
          metadata: {
            inputSchema: {
              type: "object",
              required: ["tool", "wallets"],
              properties: {
                tool: {
                  type: "string",
                  const: "risk.score"
                },
                wallets: {
                  type: "array",
                  uniqueItems: true,
                  items: { type: "string" }
                }
              },
              additionalProperties: false
            }
          }
        })
      ],
      executor: { execute }
    });

    const input = {
      tool: "risk.score",
      wallets: ["wallet_1", "wallet_2"]
    };
    const result = await router.execute({
      capability: "solana.wallet-risk",
      input,
      budget: {
        network: receipt.network,
        asset: receipt.asset,
        maxAmountAtomic: receipt.requiredAmountAtomic
      }
    });

    expect(result.providerId).toBe("provider-const-unique");
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.objectContaining({ providerId: "provider-const-unique" }),
        body: input
      })
    );
  });

  it("rejects before payment when input violates provider const constraints", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>();
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-const",
          metadata: {
            inputSchema: {
              type: "object",
              required: ["tool"],
              properties: {
                tool: {
                  type: "string",
                  const: "risk.score"
                }
              }
            }
          }
        })
      ],
      executor: { execute }
    });

    await expect(
      router.execute({
        capability: "solana.wallet-risk",
        input: { tool: "risk.audit" },
        budget: {
          network: receipt.network,
          asset: receipt.asset,
          maxAmountAtomic: receipt.requiredAmountAtomic
        }
      })
    ).rejects.toMatchObject({
      code: "invalid_request",
      attempts: [
        expect.objectContaining({
          providerId: "provider-const",
          retryable: false,
          error: expect.stringContaining(
            "input.tool must equal the schema const value"
          )
        })
      ]
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects before payment when input violates provider uniqueItems constraints", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>();
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-unique-wallets",
          metadata: {
            inputSchema: {
              type: "object",
              required: ["wallets"],
              properties: {
                wallets: {
                  type: "array",
                  uniqueItems: true,
                  items: { type: "string" }
                }
              }
            }
          }
        })
      ],
      executor: { execute }
    });

    await expect(
      router.execute({
        capability: "solana.wallet-risk",
        input: { wallets: ["wallet_1", "wallet_1"] },
        budget: {
          network: receipt.network,
          asset: receipt.asset,
          maxAmountAtomic: receipt.requiredAmountAtomic
        }
      })
    ).rejects.toMatchObject({
      code: "invalid_request",
      attempts: [
        expect.objectContaining({
          providerId: "provider-unique-wallets",
          retryable: false,
          error: expect.stringContaining("input.wallets items must be unique")
        })
      ]
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects malformed provider uniqueItems schemas before payment", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>();
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-malformed-unique-items",
          metadata: {
            inputSchema: {
              type: "object",
              required: ["wallets"],
              properties: {
                wallets: {
                  type: "array",
                  uniqueItems: "yes"
                }
              }
            }
          }
        })
      ],
      executor: { execute }
    });

    await expect(
      router.execute({
        capability: "solana.wallet-risk",
        input: { wallets: ["wallet_1"] },
        budget: {
          network: receipt.network,
          asset: receipt.asset,
          maxAmountAtomic: receipt.requiredAmountAtomic
        }
      })
    ).rejects.toMatchObject({
      code: "invalid_request",
      attempts: [
        expect.objectContaining({
          providerId: "provider-malformed-unique-items",
          retryable: false,
          error: expect.stringContaining(
            "input.wallets uniqueItems must be a boolean"
          )
        })
      ]
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("executes when input satisfies numeric and object property bounds", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>().mockResolvedValue({
      data: { risk: "low" },
      receipt
    });
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-bounded-input",
          metadata: {
            inputSchema: {
              type: "object",
              minProperties: 2,
              maxProperties: 3,
              required: ["score", "threshold"],
              properties: {
                score: {
                  type: "integer",
                  exclusiveMinimum: 0,
                  exclusiveMaximum: 101,
                  multipleOf: 5
                },
                threshold: {
                  type: "number",
                  minimum: 0,
                  maximum: 1,
                  multipleOf: 0.25
                },
                note: { type: "string" }
              },
              additionalProperties: false
            }
          }
        })
      ],
      executor: { execute }
    });

    const input = { score: 80, threshold: 0.5, note: "review" };
    const result = await router.execute({
      capability: "solana.wallet-risk",
      input,
      budget: {
        network: receipt.network,
        asset: receipt.asset,
        maxAmountAtomic: receipt.requiredAmountAtomic
      }
    });

    expect(result.providerId).toBe("provider-bounded-input");
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.objectContaining({ providerId: "provider-bounded-input" }),
        body: input
      })
    );
  });

  it("rejects before payment when input violates exclusive numeric bounds", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>();
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-exclusive-score",
          metadata: {
            inputSchema: {
              type: "object",
              required: ["score"],
              properties: {
                score: {
                  type: "integer",
                  exclusiveMinimum: 0,
                  exclusiveMaximum: 100
                }
              }
            }
          }
        })
      ],
      executor: { execute }
    });

    await expect(
      router.execute({
        capability: "solana.wallet-risk",
        input: { score: 100 },
        budget: {
          network: receipt.network,
          asset: receipt.asset,
          maxAmountAtomic: receipt.requiredAmountAtomic
        }
      })
    ).rejects.toMatchObject({
      code: "invalid_request",
      attempts: [
        expect.objectContaining({
          providerId: "provider-exclusive-score",
          retryable: false,
          error: expect.stringContaining("input.score must be less than 100")
        })
      ]
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects before payment when input violates numeric multipleOf", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>();
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-multiple-score",
          metadata: {
            inputSchema: {
              type: "object",
              required: ["score"],
              properties: {
                score: {
                  type: "integer",
                  multipleOf: 5
                }
              }
            }
          }
        })
      ],
      executor: { execute }
    });

    await expect(
      router.execute({
        capability: "solana.wallet-risk",
        input: { score: 82 },
        budget: {
          network: receipt.network,
          asset: receipt.asset,
          maxAmountAtomic: receipt.requiredAmountAtomic
        }
      })
    ).rejects.toMatchObject({
      code: "invalid_request",
      attempts: [
        expect.objectContaining({
          providerId: "provider-multiple-score",
          retryable: false,
          error: expect.stringContaining("input.score must be a multiple of 5")
        })
      ]
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects before payment when input violates object property counts", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>();
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-property-count",
          metadata: {
            inputSchema: {
              type: "object",
              minProperties: 2,
              maxProperties: 2,
              properties: {
                wallet: { type: "string" },
                mode: { type: "string" }
              }
            }
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
        }
      })
    ).rejects.toMatchObject({
      code: "invalid_request",
      attempts: [
        expect.objectContaining({
          providerId: "provider-property-count",
          retryable: false,
          error: expect.stringContaining(
            "input must contain at least 2 properties"
          )
        })
      ]
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects malformed numeric and property-count schemas before payment", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>();
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-malformed-bounds",
          metadata: {
            inputSchema: {
              type: "object",
              minProperties: -1,
              required: ["score"],
              properties: {
                score: {
                  type: "number",
                  exclusiveMinimum: "0",
                  multipleOf: 0
                }
              }
            }
          }
        })
      ],
      executor: { execute }
    });

    await expect(
      router.execute({
        capability: "solana.wallet-risk",
        input: { score: 10 },
        budget: {
          network: receipt.network,
          asset: receipt.asset,
          maxAmountAtomic: receipt.requiredAmountAtomic
        }
      })
    ).rejects.toMatchObject({
      code: "invalid_request",
      attempts: [
        expect.objectContaining({
          providerId: "provider-malformed-bounds",
          retryable: false,
          error: expect.stringContaining(
            "input minProperties must be a non-negative integer"
          )
        })
      ]
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("executes when input satisfies patternProperties and propertyNames", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>().mockResolvedValue({
      data: { risk: "low" },
      receipt
    });
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-dynamic-filters",
          metadata: {
            inputSchema: {
              type: "object",
              propertyNames: {
                type: "string",
                pattern: "^(wallet|metric\\.[a-z]+)$"
              },
              properties: {
                wallet: { type: "string" }
              },
              patternProperties: {
                "^metric\\.": {
                  type: "number",
                  minimum: 0
                }
              },
              additionalProperties: false
            }
          }
        })
      ],
      executor: { execute }
    });

    const input = {
      wallet: "wallet_1",
      "metric.latency": 120,
      "metric.score": 0.9
    };
    const result = await router.execute({
      capability: "solana.wallet-risk",
      input,
      budget: {
        network: receipt.network,
        asset: receipt.asset,
        maxAmountAtomic: receipt.requiredAmountAtomic
      }
    });

    expect(result.providerId).toBe("provider-dynamic-filters");
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.objectContaining({ providerId: "provider-dynamic-filters" }),
        body: input
      })
    );
  });

  it("rejects before payment when dynamic property values violate patternProperties", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>();
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-dynamic-filters",
          metadata: {
            inputSchema: {
              type: "object",
              patternProperties: {
                "^metric\\.": {
                  type: "number",
                  minimum: 0
                }
              },
              additionalProperties: false
            }
          }
        })
      ],
      executor: { execute }
    });

    await expect(
      router.execute({
        capability: "solana.wallet-risk",
        input: { "metric.latency": -1 },
        budget: {
          network: receipt.network,
          asset: receipt.asset,
          maxAmountAtomic: receipt.requiredAmountAtomic
        }
      })
    ).rejects.toMatchObject({
      code: "invalid_request",
      attempts: [
        expect.objectContaining({
          providerId: "provider-dynamic-filters",
          retryable: false,
          error: expect.stringContaining("input.metric.latency must be at least 0")
        })
      ]
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects before payment when propertyNames rejects an input key", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>();
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-property-names",
          metadata: {
            inputSchema: {
              type: "object",
              propertyNames: {
                type: "string",
                pattern: "^metric\\."
              },
              patternProperties: {
                "^metric\\.": { type: "number" }
              },
              additionalProperties: false
            }
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
        }
      })
    ).rejects.toMatchObject({
      code: "invalid_request",
      attempts: [
        expect.objectContaining({
          providerId: "provider-property-names",
          retryable: false,
          error: expect.stringContaining(
            "input.wallet name must match pattern ^metric\\."
          )
        })
      ]
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects before payment when additionalProperties blocks non-pattern keys", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>();
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-pattern-only",
          metadata: {
            inputSchema: {
              type: "object",
              patternProperties: {
                "^metric\\.": { type: "number" }
              },
              additionalProperties: false
            }
          }
        })
      ],
      executor: { execute }
    });

    await expect(
      router.execute({
        capability: "solana.wallet-risk",
        input: {
          "metric.latency": 100,
          wallet: "wallet_1"
        },
        budget: {
          network: receipt.network,
          asset: receipt.asset,
          maxAmountAtomic: receipt.requiredAmountAtomic
        }
      })
    ).rejects.toMatchObject({
      code: "invalid_request",
      attempts: [
        expect.objectContaining({
          providerId: "provider-pattern-only",
          retryable: false,
          error: expect.stringContaining("input.wallet is not allowed")
        })
      ]
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects malformed dynamic property schemas before payment", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>();
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-malformed-dynamic",
          metadata: {
            inputSchema: {
              type: "object",
              propertyNames: "metric",
              patternProperties: {
                "[": { type: "number" }
              }
            }
          }
        })
      ],
      executor: { execute }
    });

    await expect(
      router.execute({
        capability: "solana.wallet-risk",
        input: { "metric.latency": 100 },
        budget: {
          network: receipt.network,
          asset: receipt.asset,
          maxAmountAtomic: receipt.requiredAmountAtomic
        }
      })
    ).rejects.toMatchObject({
      code: "invalid_request",
      attempts: [
        expect.objectContaining({
          providerId: "provider-malformed-dynamic",
          retryable: false,
          error: expect.stringContaining(
            "input patternProperties must be an object of schema objects"
          )
        })
      ]
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("executes when additionalProperties schema accepts extra fields", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>().mockResolvedValue({
      data: { risk: "low" },
      receipt
    });
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-extra-filter-map",
          metadata: {
            inputSchema: {
              type: "object",
              properties: {
                wallet: { type: "string" }
              },
              additionalProperties: {
                type: "number",
                minimum: 0
              }
            }
          }
        })
      ],
      executor: { execute }
    });

    const input = {
      wallet: "wallet_1",
      latency: 120,
      score: 0.9
    };
    const result = await router.execute({
      capability: "solana.wallet-risk",
      input,
      budget: {
        network: receipt.network,
        asset: receipt.asset,
        maxAmountAtomic: receipt.requiredAmountAtomic
      }
    });

    expect(result.providerId).toBe("provider-extra-filter-map");
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.objectContaining({ providerId: "provider-extra-filter-map" }),
        body: input
      })
    );
  });

  it("rejects before payment when extra fields violate additionalProperties schema", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>();
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-extra-filter-map",
          metadata: {
            inputSchema: {
              type: "object",
              properties: {
                wallet: { type: "string" }
              },
              additionalProperties: {
                type: "number",
                minimum: 0
              }
            }
          }
        })
      ],
      executor: { execute }
    });

    await expect(
      router.execute({
        capability: "solana.wallet-risk",
        input: {
          wallet: "wallet_1",
          latency: -1
        },
        budget: {
          network: receipt.network,
          asset: receipt.asset,
          maxAmountAtomic: receipt.requiredAmountAtomic
        }
      })
    ).rejects.toMatchObject({
      code: "invalid_request",
      attempts: [
        expect.objectContaining({
          providerId: "provider-extra-filter-map",
          retryable: false,
          error: expect.stringContaining("input.latency must be at least 0")
        })
      ]
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not apply additionalProperties schema to explicit or pattern properties", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>().mockResolvedValue({
      data: { risk: "low" },
      receipt
    });
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-mixed-properties",
          metadata: {
            inputSchema: {
              type: "object",
              properties: {
                wallet: { type: "string" }
              },
              patternProperties: {
                "^metric\\.": { type: "number" }
              },
              additionalProperties: {
                type: "boolean"
              }
            }
          }
        })
      ],
      executor: { execute }
    });

    const input = {
      wallet: "wallet_1",
      "metric.latency": 100,
      includeHistory: true
    };
    const result = await router.execute({
      capability: "solana.wallet-risk",
      input,
      budget: {
        network: receipt.network,
        asset: receipt.asset,
        maxAmountAtomic: receipt.requiredAmountAtomic
      }
    });

    expect(result.providerId).toBe("provider-mixed-properties");
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.objectContaining({ providerId: "provider-mixed-properties" }),
        body: input
      })
    );
  });

  it("rejects malformed additionalProperties schemas before payment", async () => {
    const execute = vi.fn<Split402RouterExecutor["execute"]>();
    const router = new Split402Router({
      providers: [
        provider({
          providerId: "provider-malformed-additional-properties",
          metadata: {
            inputSchema: {
              type: "object",
              additionalProperties: "number"
            }
          }
        })
      ],
      executor: { execute }
    });

    await expect(
      router.execute({
        capability: "solana.wallet-risk",
        input: { latency: 100 },
        budget: {
          network: receipt.network,
          asset: receipt.asset,
          maxAmountAtomic: receipt.requiredAmountAtomic
        }
      })
    ).rejects.toMatchObject({
      code: "invalid_request",
      attempts: [
        expect.objectContaining({
          providerId: "provider-malformed-additional-properties",
          retryable: false,
          error: expect.stringContaining(
            "input additionalProperties must be a boolean or schema object"
          )
        })
      ]
    });
    expect(execute).not.toHaveBeenCalled();
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

  it("probes OpenAPI path parameters with concrete example values", async () => {
    const requestedPaths: string[] = [];
    const discovery = new Split402ExternalX402DiscoveryClient({
      merchantOrigin: "https://x402.example",
      providerIdPrefix: "openapi-examples",
      capabilityMapper: () => "research.topic",
      fetch: async (url) => {
        const parsed = new URL(url);
        requestedPaths.push(parsed.pathname);
        if (parsed.pathname === "/.well-known/x402") {
          return jsonResponse({ version: 1, paid_routes: [] });
        }
        if (parsed.pathname === "/openapi.json") {
          return jsonResponse({
            openapi: "3.0.3",
            paths: {
              "/research/{topic}": {
                get: {
                  operationId: "get.research.topic",
                  parameters: [
                    {
                      name: "topic",
                      in: "path",
                      required: true,
                      examples: {
                        agentPayments: { value: "agent payments" }
                      },
                      schema: { type: "string" }
                    }
                  ],
                  "x-payment-info": {
                    price: {
                      mode: "fixed",
                      currency: "USD",
                      amount: "0.02"
                    }
                  }
                }
              }
            }
          });
        }
        if (parsed.pathname === "/research/agent%20payments") {
          return textResponse("", {
            status: 402,
            headers: {
              "Payment-Required": encodePaymentRequiredHeader({
                ...externalPaymentRequired({ includeSplit402: false }),
                resource: {
                  url: "https://x402.example/research/agent%20payments",
                  description: "Research topic",
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
                    extra: {}
                  }
                ]
              })
            }
          });
        }
        return jsonResponse({}, 404);
      }
    });

    await expect(
      discovery.discoverCandidates({ capability: "research.topic" })
    ).resolves.toEqual([
      expect.objectContaining({
        providerId: "openapi-examples:get.research.topic",
        path: "/research/agent%20payments",
        operationId: "get.research.topic",
        readiness: "requires_split402_campaign",
        blockers: ["missing Split402 offer extension"]
      })
    ]);
    expect(requestedPaths).toContain("/research/agent%20payments");
    expect(requestedPaths).not.toContain("/research/topic");
  });

  it("enriches external paid MCP gateway candidates with tool catalog metadata", async () => {
    const discovery = new Split402ExternalX402DiscoveryClient({
      merchantOrigin: "https://x402.example",
      providerIdPrefix: "mcp-gateway",
      capabilityMapper: () => "mcp.revenue-tools",
      fetch: async (url) => {
        const parsed = new URL(url);
        if (parsed.pathname === "/.well-known/x402") {
          return jsonResponse({
            version: 1,
            paid_routes: [
              {
                method: "POST",
                path: "/mcp/call",
                price: "$0.05",
                description: "Paid MCP-style tool execution gateway.",
                example_unpaid_curl:
                  "curl -i -X POST https://x402.example/mcp/call"
              }
            ]
          });
        }
        if (parsed.pathname === "/openapi.json") {
          return jsonResponse({ openapi: "3.0.3", paths: {} });
        }
        if (parsed.pathname === "/mcp/tools") {
          return jsonResponse({
            schema_version: "revenue.paid_mcp.catalog.v1",
            payment: {
              protocol: "x402",
              paid_call_route: "https://x402.example/mcp/call",
              price_usdc: 0.05
            },
            tools: [
              {
                name: "scan_revenue_surfaces",
                description: "Rank current monetization surfaces.",
                input_schema: {
                  type: "object",
                  properties: { focus: { type: "string" } }
                }
              },
              {
                name: "audit_x402_endpoint",
                description: "Audit an x402 endpoint.",
                inputSchema: {
                  type: "object",
                  properties: { url: { type: "string" } },
                  required: ["url"]
                }
              }
            ]
          });
        }
        if (parsed.pathname === "/mcp/call") {
          return textResponse("", {
            status: 402,
            headers: {
              "Payment-Required": encodePaymentRequiredHeader(
                {
                  ...externalPaymentRequired({ includeSplit402: false }),
                  resource: {
                    url: "https://x402.example/mcp/call",
                    description: "Paid MCP-style tool execution gateway",
                    mimeType: "application/json"
                  }
                }
              )
            }
          });
        }
        return jsonResponse({}, 404);
      }
    });

    await expect(
      discovery.discoverCandidates({ capability: "mcp.revenue-tools" })
    ).resolves.toEqual([
      expect.objectContaining({
        providerId: "mcp-gateway:post.mcp.call",
        path: "/mcp/call",
        inputSchema: expect.objectContaining({
          properties: expect.objectContaining({
            tool: expect.objectContaining({
              enum: ["scan_revenue_surfaces", "audit_x402_endpoint"]
            })
          }),
          required: ["tool"]
        }),
        mcpTools: [
          {
            name: "scan_revenue_surfaces",
            description: "Rank current monetization surfaces.",
            inputSchema: {
              type: "object",
              properties: { focus: { type: "string" } }
            }
          },
          {
            name: "audit_x402_endpoint",
            description: "Audit an x402 endpoint.",
            inputSchema: {
              type: "object",
              properties: { url: { type: "string" } },
              required: ["url"]
            }
          }
        ],
        readiness: "requires_split402_campaign",
        blockers: ["missing Split402 offer extension"]
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
