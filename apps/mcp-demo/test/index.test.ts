import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";
import {
  buildOfferSigningBytes,
  buildReceiptSigningBytes,
  calculateCommission,
  createSampleProtocolArtifacts,
  deriveEd25519PublicKey,
  hashProtocolObject,
  hexToBytes,
  signEd25519Message,
  type Split402OfferV1,
  type Split402ReceiptV1
} from "@split402/protocol";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";
import {
  Split402Router,
  type Split402CapabilityProvider,
  type Split402DiscoveryFetch,
  type Split402DiscoveryFetchResponse,
  type Split402ExternalX402DiscoveryFetch,
  type Split402RouterExecutor
} from "@split402/router";

import {
  createMcpGatewayContext,
  createMcpGatewayContextFromEnv,
  createWalletRiskToolResult,
  handleMcpGatewayLine,
  handleMcpGatewayLineAsync
} from "../src/gateway.js";
import {
  discoverExternalX402Onboarding,
  parseDiscoverExternalX402Args,
  writeExternalX402OnboardingOutput
} from "../src/discover-external-x402.js";
import {
  parseValidateExternalX402ArtifactsArgs,
  runValidateExternalX402ArtifactsCli,
  validateExternalX402Artifacts
} from "../src/validate-external-x402-artifacts.js";
import {
  parsePrepareExternalX402OfferArgs,
  prepareExternalX402Offer,
  runPrepareExternalX402OfferCli
} from "../src/prepare-external-x402-offer.js";
import {
  parsePrepareExternalX402ReceiptArgs,
  prepareExternalX402Receipt,
  runPrepareExternalX402ReceiptCli
} from "../src/prepare-external-x402-receipt.js";
import { runMcpGatewaySmoke } from "../src/gateway-smoke.js";
import { createMcpDemoBundle } from "../src/index.js";
import { writeMcpDemoBundleOutput } from "../src/bundle.js";

describe("createMcpDemoBundle", () => {
  it("describes the Split402 paid MCP tool and economics", () => {
    const bundle = createMcpDemoBundle({
      generatedAt: "2026-06-26T00:00:00.000Z"
    });

    expect(bundle.project).toBe("Split402");
    expect(bundle.schemaVersion).toBe("split402.mcp-demo-bundle.v1");
    expect(bundle.merchant.discoveryUrl).toBe(
      "http://localhost:4021/.well-known/split402.json"
    );
    expect(bundle.mcp.tools[0]).toMatchObject({
      name: "split402.walletRiskScore",
      paidHttpCall: {
        method: "POST",
        url: "http://localhost:4021/v1/risk"
      },
      x402: {
        scheme: "exact",
        amountAtomic: "10000"
      },
      split402: {
        commissionBps: 2000,
        protocolFeeBpsOfCommission: 1000
      }
    });
    expect(bundle.expectedEconomics).toEqual({
      paymentAmountAtomic: "10000",
      referrerCommissionBps: 2000,
      protocolFeeBpsOfCommission: 1000,
      commissionAmountAtomic: "2000",
      protocolFeeAtomic: "200",
      referrerCreditAtomic: "1800",
      merchantRetainsAtomic: "8000"
    });
  });

  it("normalizes origins and accepts custom economics", () => {
    const bundle = createMcpDemoBundle({
      merchantOrigin: "https://merchant.example/",
      requiredAmountAtomic: "250000",
      commissionBps: 1000,
      generatedAt: "2026-06-26T00:00:00.000Z"
    });

    expect(bundle.merchant.origin).toBe("https://merchant.example");
    expect(bundle.mcp.tools[0].paidHttpCall.url).toBe(
      "https://merchant.example/v1/risk"
    );
    expect(bundle.expectedEconomics.protocolFeeAtomic).toBe("2500");
    expect(bundle.expectedEconomics.referrerCreditAtomic).toBe("22500");
    expect(bundle.expectedEconomics.merchantRetainsAtomic).toBe("225000");
  });

  it("writes the MCP bundle artifact as UTF-8 JSON", () => {
    const directory = mkdtempSync(join(tmpdir(), "split402-mcp-bundle-"));
    const outputPath = join(directory, "mcp-bundle.json");
    try {
      writeMcpDemoBundleOutput(outputPath);

      const bytes = readFileSync(outputPath);
      expect([...bytes.subarray(0, 2)]).not.toEqual([0xff, 0xfe]);
      const parsed = JSON.parse(readFileSync(outputPath, "utf8")) as {
        schemaVersion: string;
      };
      expect(parsed.schemaVersion).toBe("split402.mcp-demo-bundle.v1");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("resolves relative bundle output paths from pnpm INIT_CWD", () => {
    const directory = mkdtempSync(join(tmpdir(), "split402-mcp-bundle-root-"));
    const previousInitCwd = process.env.INIT_CWD;
    process.env.INIT_CWD = directory;
    try {
      writeMcpDemoBundleOutput("evidence/mcp-bundle.json");

      const outputPath = join(directory, "evidence", "mcp-bundle.json");
      const parsed = JSON.parse(readFileSync(outputPath, "utf8")) as {
        schemaVersion: string;
      };
      expect(parsed.schemaVersion).toBe("split402.mcp-demo-bundle.v1");
    } finally {
      if (previousInitCwd === undefined) {
        delete process.env.INIT_CWD;
      } else {
        process.env.INIT_CWD = previousInitCwd;
      }
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("external x402 onboarding CLI", () => {
  it("parses merchant public keys from CLI flags and environment", () => {
    expect(
      parseDiscoverExternalX402Args([
        "https://x402.example",
        "--merchant-public-key",
        "merchant-public-key",
        "--artifacts-dir",
        "provider-artifacts"
      ])
    ).toMatchObject({
      merchantOrigin: "https://x402.example",
      merchantPublicKey: "merchant-public-key",
      artifactsDir: "provider-artifacts"
    });
    expect(
      parseDiscoverExternalX402Args([], {
        SPLIT402_EXTERNAL_X402_ORIGIN: "https://x402.example",
        SPLIT402_EXTERNAL_X402_MERCHANT_PUBLIC_KEY: "env-merchant-public-key",
        SPLIT402_EXTERNAL_X402_ARTIFACTS_DIR: "env-provider-artifacts"
      })
    ).toMatchObject({
      merchantOrigin: "https://x402.example",
      merchantPublicKey: "env-merchant-public-key",
      artifactsDir: "env-provider-artifacts"
    });
  });

  it("renders external x402 onboarding reports without router-ready claims", async () => {
    await expect(
      discoverExternalX402Onboarding({
        merchantOrigin: "https://x402.example",
        capability: "crypto.price",
        matchPath: "/price",
        providerIdPrefix: "issue-131",
        fetch: mcpExternalX402Fetch(),
        generatedAt: "2026-07-01T00:00:00.000Z"
      })
    ).resolves.toMatchObject({
      schema: "split402.external_x402_onboarding.v1",
      generatedAt: "2026-07-01T00:00:00.000Z",
      merchantOrigin: "https://x402.example",
      candidateCount: 1,
      routerReadyCount: 0,
      candidates: [
        expect.objectContaining({
          providerId: "issue-131:get.price.coin",
          capability: "crypto.price",
          path: "/price/btc",
          method: "GET",
          network: "eip155:8453",
          amountAtomic: "20000",
          readiness: "requires_split402_campaign",
          blockers: ["missing Split402 offer extension"],
          requiredSplit402Fields: expect.arrayContaining([
            "campaignId",
            "campaignVersion",
            "campaignTermsHash",
            "merchantId",
            "protocolFeeBpsOfCommission",
            "signature"
          ]),
          split402OfferTemplate: expect.objectContaining({
            extensionPath: "extensions.split402.info",
            campaignTermsTemplate: expect.objectContaining({
              resourceOrigin: "https://x402.example",
              operationIds: ["get.price.coin"],
              network: "eip155:8453",
              asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
              requiredAmountAtomic: "20000",
              payToWallet: "0x68614873C5d624c07DCAA3aFF5243DD5027c3910",
              commissionBps: 2000,
              protocolFeeBpsOfCommission: 1000,
              attributionRequired: true,
              allowSelfReferral: false
            }),
            unsignedOfferTemplate: expect.objectContaining({
              resourceOrigin: "https://x402.example",
              operationId: "get.price.coin",
              network: "eip155:8453",
              asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
              requiredAmountAtomic: "20000",
              payToWallet: "0x68614873C5d624c07DCAA3aFF5243DD5027c3910",
              campaignTermsHash:
                "sha256:<hash of finalized campaignTermsTemplate canonical JSON>"
            }),
            signatureInstructions: expect.arrayContaining([
              "Set signature on extensions.split402.info and publish only the public verification key for the kid."
            ])
          }),
          split402ReceiptTemplate: expect.objectContaining({
            responseRequirement: expect.stringContaining(
              "after successful x402 settlement"
            ),
            commissionBearingReceiptTemplate: expect.objectContaining({
              merchantOrigin: "https://x402.example",
              operationId: "get.price.coin",
              network: "eip155:8453",
              asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
              payToWallet: "0x68614873C5d624c07DCAA3aFF5243DD5027c3910",
              requiredAmountAtomic: "20000",
              settledAmountAtomic: "20000",
              commissionBaseAtomic: "20000",
              commissionAmountAtomic: "4000",
              protocolFeeAtomic: "400",
              referrerCreditAtomic: "3600"
            }),
            noReferralReceiptRule: expect.stringContaining(
              "set commissionAmountAtomic, protocolFeeAtomic, and referrerCreditAtomic to 0"
            )
          }),
          nextActions: expect.arrayContaining([
            "Add extensions.split402.info to the unpaid 402 Payment Required response.",
            "Return a merchant-signed Split402 receipt after successful x402 settlement.",
            "For Base/EVM x402 routes, run a low-value hosted staging proof before any production or mainnet claim."
          ]),
          routerReady: false
        })
      ]
    });
  });

  it("marks signed external x402 candidates router-ready when the merchant key verifies", async () => {
    const signed = createExternalSplit402Offer();

    const report = await discoverExternalX402Onboarding({
      merchantOrigin: "https://x402.example",
      capability: "crypto.price",
      matchPath: "/price",
      providerIdPrefix: "issue-131",
      merchantPublicKey: signed.merchantPublicKey,
      fetch: mcpExternalX402Fetch({ split402Offer: signed.offer }),
      generatedAt: "2026-07-01T00:00:00.000Z"
    });

    expect(report).toMatchObject({
      candidateCount: 1,
      routerReadyCount: 1,
      candidates: [
        expect.objectContaining({
          providerId: "issue-131:get.price.coin",
          path: "/price/btc",
          network: "eip155:8453",
          asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          payToWallet: "0x68614873C5d624c07DCAA3aFF5243DD5027c3910",
          amountAtomic: "20000",
          readiness: "router_ready",
          blockers: [],
          requiredSplit402Fields: [],
          split402ReceiptTemplate: expect.objectContaining({
            commissionBearingReceiptTemplate: expect.objectContaining({
              operationId: "get.price.coin",
              requiredAmountAtomic: "20000",
              commissionAmountAtomic: "4000",
              protocolFeeAtomic: "400",
              referrerCreditAtomic: "3600"
            })
          }),
          nextActions: expect.arrayContaining([
            "Register or refresh a staging Split402 route for this provider candidate.",
            "Run one low-value paid request and verify the returned merchant-signed Split402 receipt.",
            "For Base/EVM x402 routes, run a low-value hosted staging proof before any production or mainnet claim."
          ]),
          routerReady: true
        })
      ]
    });
    expect(report.candidates[0]).not.toHaveProperty("split402OfferTemplate");
    expect(report.candidates[0]).toHaveProperty("split402ReceiptTemplate");
  });

  it("writes external x402 onboarding reports as UTF-8 JSON", async () => {
    const directory = mkdtempSync(join(tmpdir(), "split402-x402-onboarding-"));
    const outputPath = join(directory, "external-x402.json");
    const artifactsDir = join(directory, "provider-artifacts");
    try {
      await writeExternalX402OnboardingOutput({
        merchantOrigin: "https://x402.example",
        capability: "crypto.price",
        matchPath: "/price",
        providerIdPrefix: "issue-131",
        fetch: mcpExternalX402Fetch(),
        outputPath,
        artifactsDir,
        generatedAt: "2026-07-01T00:00:00.000Z"
      });

      const bytes = readFileSync(outputPath);
      expect([...bytes.subarray(0, 2)]).not.toEqual([0xff, 0xfe]);
      const parsed = JSON.parse(readFileSync(outputPath, "utf8")) as {
        schema: string;
        candidateCount: number;
      };
      expect(parsed.schema).toBe("split402.external_x402_onboarding.v1");
      expect(parsed.candidateCount).toBe(1);
      const candidateDir = join(
        artifactsDir,
        "issue-131_get.price.coin"
      );
      const manifest = JSON.parse(
        readFileSync(join(artifactsDir, "manifest.json"), "utf8")
      ) as {
        schema: string;
        candidates: Array<{ files: string[] }>;
      };
      expect(manifest.schema).toBe(
        "split402.external_x402_provider_artifacts.v1"
      );
      expect(manifest.candidates[0]?.files).toEqual(
        expect.arrayContaining([
          "campaign-terms.template.json",
          "unsigned-offer.template.json",
          "receipt.template.json",
          "README.md"
        ])
      );
      const campaignTerms = JSON.parse(
        readFileSync(join(candidateDir, "campaign-terms.template.json"), "utf8")
      ) as {
        attributionRequired: boolean;
        allowSelfReferral: boolean;
      };
      expect(campaignTerms.attributionRequired).toBe(true);
      expect(campaignTerms.allowSelfReferral).toBe(false);
      expect(
        readFileSync(join(candidateDir, "README.md"), "utf8")
      ).toContain("--campaign-terms-file campaign-terms.json");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("external x402 artifact validation", () => {
  it("prepares external offers for no-secret provider signing", () => {
    const signed = createExternalSplit402Offer();
    const unsignedOffer = createUnsignedExternalOffer(signed.offer);

    expect(
      prepareExternalX402Offer({
        campaignTerms: signed.campaignTerms,
        unsignedOffer: {
          ...unsignedOffer,
          campaignTermsHash:
            "sha256:<hash of finalized campaignTermsTemplate canonical JSON>"
        }
      })
    ).toMatchObject({
      ok: true,
      errors: [],
      campaignTermsHash: signed.offer.campaignTermsHash,
      offerToSign: {
        campaignTermsHash: signed.offer.campaignTermsHash,
        operationId: "get.price.coin"
      },
      offerSigningBytesHex: expect.any(String)
    });
  });

  it("rejects prepared offers that disagree with campaign terms", () => {
    const signed = createExternalSplit402Offer();
    const unsignedOffer = createUnsignedExternalOffer(signed.offer);

    expect(
      prepareExternalX402Offer({
        campaignTerms: {
          ...signed.campaignTerms,
          requiredAmountAtomic: "10000"
        },
        unsignedOffer
      })
    ).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        "offer.requiredAmountAtomic mismatch: expected 10000, got 20000"
      ])
    });
  });

  it("runs external offer preparation from JSON files", async () => {
    const directory = mkdtempSync(join(tmpdir(), "split402-x402-prepare-"));
    const campaignTermsPath = join(directory, "campaign-terms.json");
    const unsignedOfferPath = join(directory, "unsigned-offer.json");
    const outputDir = join(directory, "prepared");
    const signed = createExternalSplit402Offer();
    const unsignedOffer = createUnsignedExternalOffer(signed.offer);
    const logs: string[] = [];
    const originalLog = console.log;
    try {
      writeFileSync(
        campaignTermsPath,
        JSON.stringify(signed.campaignTerms),
        "utf8"
      );
      writeFileSync(
        unsignedOfferPath,
        JSON.stringify({
          ...unsignedOffer,
          campaignTermsHash:
            "sha256:<hash of finalized campaignTermsTemplate canonical JSON>"
        }),
        "utf8"
      );
      console.log = (value?: unknown) => {
        logs.push(String(value));
      };

      await expect(
        runPrepareExternalX402OfferCli([
          "--campaign-terms-file",
          campaignTermsPath,
          "--unsigned-offer-file",
          unsignedOfferPath,
          "--output-dir",
          outputDir
        ])
      ).resolves.toBe(0);
    } finally {
      console.log = originalLog;
    }

    expect(JSON.parse(logs.join("\n"))).toMatchObject({
      ok: true,
      campaignTermsHash: signed.offer.campaignTermsHash
    });
    expect(
      JSON.parse(readFileSync(join(outputDir, "offer-to-sign.json"), "utf8"))
    ).toMatchObject({
      campaignTermsHash: signed.offer.campaignTermsHash
    });
    expect(readFileSync(join(outputDir, "offer-signing-bytes.hex"), "utf8")).toMatch(
      /^[0-9a-f]+\n$/u
    );
    expect(parsePrepareExternalX402OfferArgs(["--help"])).toEqual({
      help: true
    });
    rmSync(directory, { recursive: true, force: true });
  });

  it("prepares external receipts for no-secret provider signing", () => {
    const signed = createExternalSplit402Offer();
    const receipt = createExternalSplit402Receipt(signed.offer);
    const unsignedReceipt = createUnsignedExternalReceipt(receipt);

    expect(
      prepareExternalX402Receipt({
        offer: signed.offer,
        unsignedReceipt: {
          ...unsignedReceipt,
          commissionAmountAtomic: "0",
          protocolFeeAtomic: "0",
          referrerCreditAtomic: "0"
        }
      })
    ).toMatchObject({
      ok: true,
      errors: [],
      receiptToSign: {
        campaignTermsHash: signed.offer.campaignTermsHash,
        commissionAmountAtomic: "4000",
        protocolFeeAtomic: "400",
        referrerCreditAtomic: "3600",
        operationId: "get.price.coin"
      },
      receiptSigningBytesHex: expect.any(String)
    });
  });

  it("rejects external receipt preparation when a signature is already present", () => {
    const signed = createExternalSplit402Offer();
    const receipt = createExternalSplit402Receipt(signed.offer);

    expect(
      prepareExternalX402Receipt({
        offer: signed.offer,
        unsignedReceipt: receipt
      })
    ).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        "unsignedReceipt must not include signature"
      ])
    });
  });

  it("runs external receipt preparation from JSON files", async () => {
    const directory = mkdtempSync(join(tmpdir(), "split402-x402-receipt-"));
    const offerPath = join(directory, "offer.json");
    const unsignedReceiptPath = join(directory, "unsigned-receipt.json");
    const outputDir = join(directory, "prepared-receipt");
    const signed = createExternalSplit402Offer();
    const receipt = createExternalSplit402Receipt(signed.offer);
    const unsignedReceipt = createUnsignedExternalReceipt(receipt);
    const logs: string[] = [];
    const originalLog = console.log;
    try {
      writeFileSync(offerPath, JSON.stringify(signed.offer), "utf8");
      writeFileSync(
        unsignedReceiptPath,
        JSON.stringify(unsignedReceipt),
        "utf8"
      );
      console.log = (value?: unknown) => {
        logs.push(String(value));
      };

      await expect(
        runPrepareExternalX402ReceiptCli([
          "--offer-file",
          offerPath,
          "--unsigned-receipt-file",
          unsignedReceiptPath,
          "--output-dir",
          outputDir
        ])
      ).resolves.toBe(0);
    } finally {
      console.log = originalLog;
    }

    expect(JSON.parse(logs.join("\n"))).toMatchObject({
      ok: true,
      receiptToSign: {
        campaignTermsHash: signed.offer.campaignTermsHash
      }
    });
    expect(
      JSON.parse(readFileSync(join(outputDir, "receipt-to-sign.json"), "utf8"))
    ).toMatchObject({
      campaignTermsHash: signed.offer.campaignTermsHash
    });
    expect(
      readFileSync(join(outputDir, "receipt-signing-bytes.hex"), "utf8")
    ).toMatch(/^[0-9a-f]+\n$/u);
    expect(parsePrepareExternalX402ReceiptArgs(["--help"])).toEqual({
      help: true
    });
    rmSync(directory, { recursive: true, force: true });
  });

  it("validates signed offers and receipts against route metadata", () => {
    const signed = createExternalSplit402Offer();
    const receipt = createExternalSplit402Receipt(signed.offer);

    expect(
      validateExternalX402Artifacts({
        merchantOrigin: "https://x402.example",
        operationId: "get.price.coin",
        network: EXTERNAL_X402_NETWORK,
        asset: EXTERNAL_X402_ASSET,
        payToWallet: EXTERNAL_X402_PAY_TO_WALLET,
        requiredAmountAtomic: EXTERNAL_X402_AMOUNT_ATOMIC,
        merchantPublicKey: signed.merchantPublicKey,
        offer: signed.offer,
        campaignTerms: signed.campaignTerms,
        receipt
      })
    ).toEqual({
      ok: true,
      errors: [],
      checks: {
        offerSchema: true,
        offerSignature: true,
        offerMatchesPayment: true,
        campaignTermsHash: true,
        receiptSchema: true,
        receiptSignatureAndArithmetic: true,
        receiptMatchesOfferAndPayment: true
      }
    });
  });

  it("rejects campaign terms that do not match the signed offer hash", () => {
    const signed = createExternalSplit402Offer();

    expect(
      validateExternalX402Artifacts({
        merchantOrigin: "https://x402.example",
        operationId: "get.price.coin",
        network: EXTERNAL_X402_NETWORK,
        asset: EXTERNAL_X402_ASSET,
        payToWallet: EXTERNAL_X402_PAY_TO_WALLET,
        requiredAmountAtomic: EXTERNAL_X402_AMOUNT_ATOMIC,
        merchantPublicKey: signed.merchantPublicKey,
        offer: signed.offer,
        campaignTerms: {
          ...signed.campaignTerms,
          requiredAmountAtomic: "10000"
        }
      })
    ).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        expect.stringContaining("campaignTermsHash mismatch:")
      ]),
      checks: {
        offerSchema: true,
        offerSignature: true,
        offerMatchesPayment: true,
        campaignTermsHash: false
      }
    });
  });

  it("rejects artifacts that disagree with external x402 route metadata", () => {
    const signed = createExternalSplit402Offer();

    expect(
      validateExternalX402Artifacts({
        merchantOrigin: "https://x402.example",
        operationId: "get.price.coin",
        network: EXTERNAL_X402_NETWORK,
        asset: EXTERNAL_X402_ASSET,
        payToWallet: EXTERNAL_X402_PAY_TO_WALLET,
        requiredAmountAtomic: "10000",
        merchantPublicKey: signed.merchantPublicKey,
        offer: signed.offer
      })
    ).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        "offer.requiredAmountAtomic mismatch: expected 10000, got 20000"
      ]),
      checks: {
        offerSchema: true,
        offerSignature: true,
        offerMatchesPayment: false
      }
    });
  });

  it("runs artifact validation from JSON files", async () => {
    const directory = mkdtempSync(join(tmpdir(), "split402-x402-validate-"));
    const offerPath = join(directory, "offer.json");
    const receiptPath = join(directory, "receipt.json");
    const campaignTermsPath = join(directory, "campaign-terms.json");
    const signed = createExternalSplit402Offer();
    const receipt = createExternalSplit402Receipt(signed.offer);
    const logs: string[] = [];
    const originalLog = console.log;
    try {
      writeFileSync(offerPath, JSON.stringify(signed.offer), "utf8");
      writeFileSync(receiptPath, JSON.stringify(receipt), "utf8");
      writeFileSync(
        campaignTermsPath,
        JSON.stringify(signed.campaignTerms),
        "utf8"
      );
      console.log = (value?: unknown) => {
        logs.push(String(value));
      };

      await expect(
        runValidateExternalX402ArtifactsCli([
          "--merchant-origin",
          "https://x402.example",
          "--operation-id",
          "get.price.coin",
          "--network",
          EXTERNAL_X402_NETWORK,
          "--asset",
          EXTERNAL_X402_ASSET,
          "--pay-to-wallet",
          EXTERNAL_X402_PAY_TO_WALLET,
          "--required-amount-atomic",
          EXTERNAL_X402_AMOUNT_ATOMIC,
          "--merchant-public-key",
          signed.merchantPublicKey,
          "--offer-file",
          offerPath,
          "--campaign-terms-file",
          campaignTermsPath,
          "--receipt-file",
          receiptPath
        ])
      ).resolves.toBe(0);
    } finally {
      console.log = originalLog;
      rmSync(directory, { recursive: true, force: true });
    }
    expect(JSON.parse(logs.join("\n"))).toMatchObject({
      ok: true,
      checks: {
        campaignTermsHash: true
      }
    });
  });

  it("parses artifact validation help flags", () => {
    expect(parseValidateExternalX402ArtifactsArgs(["--help"])).toEqual({
      help: true
    });
  });
});

describe("MCP demo gateway", () => {
  it("exposes the Split402 paid tool through MCP tools/list", () => {
    const response = handleMcpGatewayLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list"
      }),
      createMcpDemoBundle({
        generatedAt: "2026-06-26T00:00:00.000Z"
      })
    );

    expect(response?.jsonrpc).toBe("2.0");
    expect(response?.id).toBe(1);
    const result = response?.result as {
      tools: { name: string; inputSchema?: { required?: string[] } }[];
    };
    expect(result.tools.map((tool) => tool.name)).toEqual([
      "split402.walletRiskScore",
      "split402.searchCapabilities",
      "split402.execute",
      "split402.discoverExternalX402",
      "split402.validateExternalX402Artifacts",
      "split402.getReceipt"
    ]);
    expect(result.tools[0]?.inputSchema?.required).toEqual(["wallet"]);
    expect(result.tools[1]?.inputSchema).toMatchObject({
      properties: {
        capability: { type: "string" },
        budget: {
          properties: {
            network: { type: "string" },
            asset: { type: "string" },
            maxAmountAtomic: { type: "string" }
          }
        }
      }
    });
    expect(result.tools[2]?.inputSchema).toMatchObject({
      required: ["capability", "input", "budget"],
      properties: {
        referralClaim: { type: "object" },
        budget: {
          required: ["maxAmountAtomic"]
        }
      }
    });
    expect(result.tools[3]?.inputSchema).toMatchObject({
      required: ["merchantOrigin"],
      properties: {
        merchantOrigin: { type: "string" },
        capability: { type: "string" },
        matchPath: { type: "string" },
        merchantPublicKey: { type: "string" }
      }
    });
    expect(result.tools[4]?.inputSchema).toMatchObject({
      required: [
        "merchantOrigin",
        "operationId",
        "network",
        "asset",
        "payToWallet",
        "requiredAmountAtomic",
        "merchantPublicKey",
        "offer"
      ],
      properties: {
        offer: { type: "object" },
        receipt: { type: "object" }
      }
    });
  });

  it("returns x402 and Split402 payment context for tool calls", () => {
    const response = handleMcpGatewayLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "call-1",
        method: "tools/call",
        params: {
          name: "split402.walletRiskScore",
          arguments: {
            wallet: "referrer-wallet"
          }
        }
      }),
      createMcpDemoBundle({
        generatedAt: "2026-06-26T00:00:00.000Z"
      })
    );

    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: "call-1",
      result: {
        structuredContent: {
          status: "payment_required",
          wallet: "referrer-wallet",
          paidHttpCall: {
            method: "POST",
            url: "http://localhost:4021/v1/risk",
            bodyTemplate: {
              wallet: "referrer-wallet"
            }
          },
          x402: {
            scheme: "exact",
            amountAtomic: "10000"
          },
          split402: {
            campaignId: "cmp_00000000000000000000000000000002",
            commissionBps: 2000
          },
          expectedEconomics: {
            referrerCreditAtomic: "1800"
          }
        },
        isError: false
      }
    });
  });

  it("validates required MCP tool arguments", () => {
    const response = handleMcpGatewayLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "split402.walletRiskScore",
          arguments: {}
        }
      })
    );

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 2,
      error: {
        code: -32602,
        message: "wallet argument is required"
      }
    });
  });

  it("searches router capabilities through MCP tools/call", async () => {
    const bundle = createMcpDemoBundle({
      generatedAt: "2026-06-26T00:00:00.000Z"
    });
    const sample = createSampleProtocolArtifacts();
    const response = await handleMcpGatewayLineAsync(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "search-1",
        method: "tools/call",
        params: {
          name: "split402.searchCapabilities",
          arguments: {
            capability: "solana.wallet-risk"
          }
        }
      }),
      createMcpGatewayContext(bundle)
    );

    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: "search-1",
      result: {
        structuredContent: {
          capabilities: [
            expect.objectContaining({
              providerId: "split402-demo-merchant",
              capability: "solana.wallet-risk",
              routeId: sample.artifacts.receipt.routeId,
              referrerWallet: sample.artifacts.receipt.referrerWallet,
              payoutWallet: sample.artifacts.receipt.payoutWallet,
              payToWallet: bundle.mcp.tools[0].x402.payToWallet,
              amountAtomic: "10000"
            })
          ]
        },
        isError: false
      }
    });
  });

  it("filters router capability search by budget through MCP tools/call", async () => {
    const context = createMcpGatewayContext(
      createMcpDemoBundle({
        generatedAt: "2026-06-26T00:00:00.000Z"
      })
    );

    const response = await handleMcpGatewayLineAsync(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "search-budget",
        method: "tools/call",
        params: {
          name: "split402.searchCapabilities",
          arguments: {
            capability: "solana.wallet-risk",
            budget: {
              maxAmountAtomic: "9999"
            }
          }
        }
      }),
      context
    );

    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: "search-budget",
      result: {
        structuredContent: {
          capabilities: []
        },
        isError: false
      }
    });
  });

  it("discovers external x402 onboarding candidates through MCP tools/call", async () => {
    const context = createMcpGatewayContext(
      createMcpDemoBundle({
        generatedAt: "2026-06-26T00:00:00.000Z"
      }),
      undefined,
      "router-demo-mock",
      mcpExternalX402Fetch()
    );

    const response = await handleMcpGatewayLineAsync(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "external-discovery",
        method: "tools/call",
        params: {
          name: "split402.discoverExternalX402",
          arguments: {
            merchantOrigin: "https://x402.example",
            capability: "crypto.price",
            matchPath: "/price",
            providerIdPrefix: "issue-131"
          }
        }
      }),
      context
    );

    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: "external-discovery",
      result: {
        structuredContent: {
          status: "discovered",
          merchantOrigin: "https://x402.example",
          candidateCount: 1,
          routerReadyCount: 0,
          candidates: [
            expect.objectContaining({
              providerId: "issue-131:get.price.coin",
              capability: "crypto.price",
              path: "/price/btc",
              method: "GET",
              network: "eip155:8453",
              asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
              amountAtomic: "20000",
              readiness: "requires_split402_campaign",
              blockers: ["missing Split402 offer extension"],
              requiredSplit402Fields: expect.arrayContaining([
                "campaignId",
                "campaignVersion",
                "campaignTermsHash",
                "merchantId",
                "protocolFeeBpsOfCommission",
                "signature"
              ]),
              split402OfferTemplate: expect.objectContaining({
                extensionPath: "extensions.split402.info",
                unsignedOfferTemplate: expect.objectContaining({
                  operationId: "get.price.coin",
                  network: "eip155:8453",
                  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
                  requiredAmountAtomic: "20000"
                })
              }),
              split402ReceiptTemplate: expect.objectContaining({
                commissionBearingReceiptTemplate: expect.objectContaining({
                  operationId: "get.price.coin",
                  requiredAmountAtomic: "20000",
                  commissionAmountAtomic: "4000",
                  protocolFeeAtomic: "400",
                  referrerCreditAtomic: "3600"
                })
              }),
              nextActions: expect.arrayContaining([
                "Add extensions.split402.info to the unpaid 402 Payment Required response.",
                "Return a merchant-signed Split402 receipt after successful x402 settlement.",
                "For Base/EVM x402 routes, run a low-value hosted staging proof before any production or mainnet claim."
              ]),
              routerReady: false
            })
          ]
        },
        isError: false
      }
    });
  });

  it("marks signed external x402 candidates router-ready through MCP tools/call", async () => {
    const signed = createExternalSplit402Offer();
    const context = createMcpGatewayContext(
      createMcpDemoBundle({
        generatedAt: "2026-06-26T00:00:00.000Z"
      }),
      undefined,
      "router-demo-mock",
      mcpExternalX402Fetch({ split402Offer: signed.offer })
    );

    const response = await handleMcpGatewayLineAsync(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "external-discovery-ready",
        method: "tools/call",
        params: {
          name: "split402.discoverExternalX402",
          arguments: {
            merchantOrigin: "https://x402.example",
            capability: "crypto.price",
            matchPath: "/price",
            providerIdPrefix: "issue-131",
            merchantPublicKey: signed.merchantPublicKey
          }
        }
      }),
      context
    );

    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: "external-discovery-ready",
      result: {
        structuredContent: {
          status: "discovered",
          merchantOrigin: "https://x402.example",
          candidateCount: 1,
          routerReadyCount: 1,
          candidates: [
            expect.objectContaining({
              providerId: "issue-131:get.price.coin",
              capability: "crypto.price",
              path: "/price/btc",
              method: "GET",
              network: "eip155:8453",
              asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
              payToWallet: "0x68614873C5d624c07DCAA3aFF5243DD5027c3910",
              amountAtomic: "20000",
              readiness: "router_ready",
              blockers: [],
              requiredSplit402Fields: [],
              split402ReceiptTemplate: expect.objectContaining({
                commissionBearingReceiptTemplate: expect.objectContaining({
                  operationId: "get.price.coin",
                  requiredAmountAtomic: "20000",
                  commissionAmountAtomic: "4000"
                })
              }),
              routerReady: true
            })
          ]
        },
        isError: false
      }
    });
    const structuredContent = response?.result as {
      structuredContent?: {
        candidates?: Record<string, unknown>[];
      };
    };
    expect(
      structuredContent.structuredContent?.candidates?.[0]
    ).not.toHaveProperty("split402OfferTemplate");
    expect(
      structuredContent.structuredContent?.candidates?.[0]
    ).toHaveProperty("split402ReceiptTemplate");
  });

  it("validates external x402 artifacts through MCP tools/call", async () => {
    const signed = createExternalSplit402Offer();
    const receipt = createExternalSplit402Receipt(signed.offer);

    const response = await handleMcpGatewayLineAsync(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "external-artifact-validation",
        method: "tools/call",
        params: {
          name: "split402.validateExternalX402Artifacts",
          arguments: {
            merchantOrigin: "https://x402.example",
            operationId: "get.price.coin",
            network: EXTERNAL_X402_NETWORK,
            asset: EXTERNAL_X402_ASSET,
            payToWallet: EXTERNAL_X402_PAY_TO_WALLET,
            requiredAmountAtomic: EXTERNAL_X402_AMOUNT_ATOMIC,
            merchantPublicKey: signed.merchantPublicKey,
            offer: signed.offer,
            campaignTerms: signed.campaignTerms,
            receipt
          }
        }
      }),
      createMcpGatewayContext()
    );

    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: "external-artifact-validation",
      result: {
        structuredContent: {
          status: "artifacts_checked",
          ok: true,
          errors: [],
          checks: {
            offerSchema: true,
            offerSignature: true,
            offerMatchesPayment: true,
            campaignTermsHash: true,
            receiptSchema: true,
            receiptSignatureAndArithmetic: true,
            receiptMatchesOfferAndPayment: true
          }
        },
        isError: false
      }
    });
  });

  it("reports external x402 artifact validation errors through MCP tools/call", async () => {
    const signed = createExternalSplit402Offer();

    const response = await handleMcpGatewayLineAsync(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "external-artifact-validation-fail",
        method: "tools/call",
        params: {
          name: "split402.validateExternalX402Artifacts",
          arguments: {
            merchantOrigin: "https://x402.example",
            operationId: "get.price.coin",
            network: EXTERNAL_X402_NETWORK,
            asset: EXTERNAL_X402_ASSET,
            payToWallet: EXTERNAL_X402_PAY_TO_WALLET,
            requiredAmountAtomic: "10000",
            merchantPublicKey: signed.merchantPublicKey,
            offer: signed.offer
          }
        }
      }),
      createMcpGatewayContext()
    );

    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: "external-artifact-validation-fail",
      result: {
        structuredContent: {
          status: "offer_checked",
          ok: false,
          errors: expect.arrayContaining([
            "offer.requiredAmountAtomic mismatch: expected 10000, got 20000"
          ]),
          checks: {
            offerSchema: true,
            offerSignature: true,
            offerMatchesPayment: false
          }
        },
        isError: false
      }
    });
  });

  it("rejects malformed router capability search budgets", async () => {
    const context = createMcpGatewayContext(
      createMcpDemoBundle({
        generatedAt: "2026-06-26T00:00:00.000Z"
      })
    );

    const response = await handleMcpGatewayLineAsync(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "search-bad-budget",
        method: "tools/call",
        params: {
          name: "split402.searchCapabilities",
          arguments: {
            capability: "solana.wallet-risk",
            budget: {
              maxAmountAtomic: "1.5"
            }
          }
        }
      }),
      context
    );

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: "search-bad-budget",
      error: {
        code: -32602,
        message: "budget.maxAmountAtomic must be a non-negative atomic amount string"
      }
    });
  });

  it("can build the gateway router from control-plane discovery", async () => {
    const calls: string[] = [];
    const bundle = createMcpDemoBundle({
      merchantOrigin: "https://merchant.example",
      generatedAt: "2026-06-26T00:00:00.000Z"
    });
    const context = await createMcpGatewayContextFromEnv({
      bundle,
      env: {
        SPLIT402_MCP_CONTROL_PLANE_URL: "https://control.example",
        SPLIT402_MCP_CONTROL_PLANE_TOKEN: "control-token",
        SPLIT402_MCP_CAPABILITY: "solana.wallet-risk",
        SPLIT402_MCP_DISCOVERY_LIMIT: "10"
      },
      fetch: mcpControlPlaneFetch(calls, bundle)
    });

    const response = await handleMcpGatewayLineAsync(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "search-discovered",
        method: "tools/call",
        params: {
          name: "split402.searchCapabilities",
          arguments: {
            capability: "solana.wallet-risk"
          }
        }
      }),
      context
    );

    expect(context.executionMode).toBe("router-live-agent-sdk");
    expect(response).toMatchObject({
      result: {
        structuredContent: {
          capabilities: [
            expect.objectContaining({
              providerId: "rte_discovered:wallet-risk-score",
              capability: "solana.wallet-risk",
              merchantOrigin: "https://merchant.example",
              amountAtomic: "10000"
            })
          ]
        },
        isError: false
      }
    });
    expect(calls).toEqual([
      "https://control.example/v1/routes/search?status=active&limit=10",
      "https://control.example/v1/routes/rte_discovered/bazaar-resources",
      "https://control.example/v1/campaigns/cmp_00000000000000000000000000000002",
      "https://control.example/v1/merchants/mrc_00000000000000000000000000000001"
    ]);
  });

  it("rejects invalid hosted execution signer configuration", async () => {
    const bundle = createMcpDemoBundle({
      merchantOrigin: "https://merchant.example",
      generatedAt: "2026-06-26T00:00:00.000Z"
    });

    await expect(
      createMcpGatewayContextFromEnv({
        bundle,
        env: {
          SPLIT402_MCP_CONTROL_PLANE_URL: "https://control.example",
          SPLIT402_MCP_CONTROL_PLANE_TOKEN: "control-token",
          SPLIT402_MCP_CAPABILITY: "solana.wallet-risk",
          SPLIT402_MCP_SVM_PRIVATE_KEY: "not-a-base58-key"
        },
        fetch: mcpControlPlaneFetch([], bundle)
      })
    ).rejects.toThrow("invalid base58");
  });

  it("rejects missing hosted execution signer when required", async () => {
    const bundle = createMcpDemoBundle({
      merchantOrigin: "https://merchant.example",
      generatedAt: "2026-06-26T00:00:00.000Z"
    });

    await expect(
      createMcpGatewayContextFromEnv({
        bundle,
        env: {
          SPLIT402_MCP_CONTROL_PLANE_URL: "https://control.example",
          SPLIT402_MCP_CONTROL_PLANE_TOKEN: "control-token",
          SPLIT402_MCP_CAPABILITY: "solana.wallet-risk"
        },
        fetch: mcpControlPlaneFetch([], bundle),
        requireSigner: true
      })
    ).rejects.toThrow(
      "SPLIT402_MCP_SVM_PRIVATE_KEY or SVM_PRIVATE_KEY is required for live MCP gateway execution"
    );
  });

  it("executes through the router gateway and stores receipts for lookup", async () => {
    const context = createMcpGatewayContext(
      createMcpDemoBundle({
        generatedAt: "2026-06-26T00:00:00.000Z"
      })
    );
    const executeResponse = await handleMcpGatewayLineAsync(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "execute-1",
        method: "tools/call",
        params: {
          name: "split402.execute",
          arguments: {
            capability: "solana.wallet-risk",
            input: {
              wallet: "wallet-123"
            },
            budget: {
              maxAmountAtomic: "10000"
            }
          }
        }
      }),
      context
    );

    expect(executeResponse).toMatchObject({
      jsonrpc: "2.0",
      id: "execute-1",
      result: {
        structuredContent: {
          status: "executed",
          executionMode: "router-demo-mock",
          providerId: "split402-demo-merchant",
          provider: {
            providerId: "split402-demo-merchant",
            capability: "solana.wallet-risk",
            merchantOrigin: "http://localhost:4021",
            path: "/v1/risk",
            method: "POST",
            operationId: "wallet-risk-score",
            campaignId: "cmp_00000000000000000000000000000002",
            network: expect.any(String),
            asset: expect.any(String),
            payToWallet: expect.any(String),
            amountAtomic: "10000",
            referrerWallet: expect.any(String),
            payoutWallet: expect.any(String),
            reliability: {
              successRateBps: 9500,
              medianLatencyMs: 250
            }
          },
          amountPaidAtomic: "10000",
          receiptId: expect.stringMatching(/^rcp_[0-9a-f]{32}$/u),
          receiptVerificationStatus: "verified",
          referrerCreditAtomic: "1800",
          data: {
            wallet: "wallet-123",
            risk: "low"
          }
        },
        isError: false
      }
    });
    const receiptId = (
      executeResponse?.result as { structuredContent: { receiptId: string } }
    ).structuredContent.receiptId;

    const receiptResponse = await handleMcpGatewayLineAsync(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "receipt-1",
        method: "tools/call",
        params: {
          name: "split402.getReceipt",
          arguments: {
            receiptId
          }
        }
      }),
      context
    );

    expect(receiptResponse).toMatchObject({
      jsonrpc: "2.0",
      id: "receipt-1",
      result: {
        structuredContent: {
          receiptId,
          receipt: expect.objectContaining({
            referrerCreditAtomic: "1800"
          })
        },
        isError: false
      }
    });
  });

  it("stores distinct receipts for repeated demo executions", async () => {
    const context = createMcpGatewayContext(
      createMcpDemoBundle({
        generatedAt: "2026-06-26T00:00:00.000Z"
      })
    );

    const execute = async (id: string, wallet: string) =>
      handleMcpGatewayLineAsync(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: {
            name: "split402.execute",
            arguments: {
              capability: "solana.wallet-risk",
              input: {
                wallet
              },
              budget: {
                maxAmountAtomic: "10000"
              }
            }
          }
        }),
        context
      );

    const first = await execute("execute-repeat-1", "wallet-1");
    const second = await execute("execute-repeat-2", "wallet-2");
    const firstReceiptId = (
      first?.result as { structuredContent: { receiptId: string } }
    ).structuredContent.receiptId;
    const secondReceiptId = (
      second?.result as { structuredContent: { receiptId: string } }
    ).structuredContent.receiptId;

    expect(firstReceiptId).toMatch(/^rcp_[0-9a-f]{32}$/u);
    expect(secondReceiptId).toMatch(/^rcp_[0-9a-f]{32}$/u);
    expect(firstReceiptId).not.toBe(secondReceiptId);

    const firstLookup = await handleMcpGatewayLineAsync(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "receipt-repeat-1",
        method: "tools/call",
        params: {
          name: "split402.getReceipt",
          arguments: {
            receiptId: firstReceiptId
          }
        }
      }),
      context
    );
    const secondLookup = await handleMcpGatewayLineAsync(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "receipt-repeat-2",
        method: "tools/call",
        params: {
          name: "split402.getReceipt",
          arguments: {
            receiptId: secondReceiptId
          }
        }
      }),
      context
    );

    expect(firstLookup).toMatchObject({
      result: {
        structuredContent: {
          receiptId: firstReceiptId,
          receipt: expect.objectContaining({
            receiptId: firstReceiptId
          })
        }
      }
    });
    expect(secondLookup).toMatchObject({
      result: {
        structuredContent: {
          receiptId: secondReceiptId,
          receipt: expect.objectContaining({
            receiptId: secondReceiptId
          })
        }
      }
    });
  });

  it("rejects router execution without an explicit budget", async () => {
    const context = createMcpGatewayContext(
      createMcpDemoBundle({
        generatedAt: "2026-06-26T00:00:00.000Z"
      })
    );

    const response = await handleMcpGatewayLineAsync(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "execute-no-budget",
        method: "tools/call",
        params: {
          name: "split402.execute",
          arguments: {
            capability: "solana.wallet-risk",
            input: {
              wallet: "wallet-123"
            }
          }
        }
      }),
      context
    );

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: "execute-no-budget",
      error: {
        code: -32602,
        message: "budget argument is required"
      }
    });
  });

  it("defaults execute network and asset from a budget-eligible provider", async () => {
    const sample = createSampleProtocolArtifacts().artifacts.receipt;
    const providers: Split402CapabilityProvider[] = [
      {
        providerId: "expensive-provider",
        capability: "solana.wallet-risk",
        merchantOrigin: sample.merchantOrigin,
        path: "/v1/risk",
        method: "POST",
        operationId: sample.operationId,
        campaignId: sample.campaignId,
        network: "solana:expensive-devnet",
        asset: sample.asset,
        payToWallet: sample.payToWallet,
        amountAtomic: "20000",
        reliability: {
          successRateBps: 10000,
          medianLatencyMs: 10
        }
      },
      {
        providerId: "affordable-provider",
        capability: "solana.wallet-risk",
        merchantOrigin: sample.merchantOrigin,
        path: "/v1/risk",
        method: "POST",
        operationId: sample.operationId,
        campaignId: sample.campaignId,
        network: sample.network,
        asset: sample.asset,
        payToWallet: sample.payToWallet,
        amountAtomic: sample.requiredAmountAtomic,
        reliability: {
          successRateBps: 9000,
          medianLatencyMs: 20
        }
      }
    ];
    const executor: Split402RouterExecutor = {
      execute: async (input) => ({
        data: {
          providerId: input.provider.providerId
        },
        receipt: sample
      })
    };
    const context = createMcpGatewayContext(
      createMcpDemoBundle({
        generatedAt: "2026-06-26T00:00:00.000Z"
      }),
      new Split402Router({
        providers,
        executor,
        verifyReceipts: false
      })
    );

    const response = await handleMcpGatewayLineAsync(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "execute-budget-defaults",
        method: "tools/call",
        params: {
          name: "split402.execute",
          arguments: {
            capability: "solana.wallet-risk",
            input: {
              wallet: "wallet-123"
            },
            budget: {
              maxAmountAtomic: sample.requiredAmountAtomic
            }
          }
        }
      }),
      context
    );

    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: "execute-budget-defaults",
      result: {
        structuredContent: {
          status: "executed",
          providerId: "affordable-provider",
          amountPaidAtomic: sample.requiredAmountAtomic,
          data: {
            providerId: "affordable-provider"
          }
        },
        isError: false
      }
    });
  });

  it("rejects router execution when an optional budget asset override is unsupported", async () => {
    const context = createMcpGatewayContext(
      createMcpDemoBundle({
        generatedAt: "2026-06-26T00:00:00.000Z"
      })
    );

    const response = await handleMcpGatewayLineAsync(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "execute-wrong-asset",
        method: "tools/call",
        params: {
          name: "split402.execute",
          arguments: {
            capability: "solana.wallet-risk",
            input: {
              wallet: "wallet-123"
            },
            budget: {
              asset: "wrong-asset",
              maxAmountAtomic: "10000"
            }
          }
        }
      }),
      context
    );

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: "execute-wrong-asset",
      error: {
        code: -32602,
        message: "no providers match capability and budget: solana.wallet-risk"
      }
    });
  });

  it("rejects router execution when no provider fits the max budget", async () => {
    const context = createMcpGatewayContext(
      createMcpDemoBundle({
        generatedAt: "2026-06-26T00:00:00.000Z"
      })
    );

    const response = await handleMcpGatewayLineAsync(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "execute-budget-too-low",
        method: "tools/call",
        params: {
          name: "split402.execute",
          arguments: {
            capability: "solana.wallet-risk",
            input: {
              wallet: "wallet-123"
            },
            budget: {
              maxAmountAtomic: "9999"
            }
          }
        }
      }),
      context
    );

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: "execute-budget-too-low",
      error: {
        code: -32602,
        message: "no providers match capability and budget: solana.wallet-risk"
      }
    });
  });

  it("rejects malformed router execution budgets before provider lookup", async () => {
    const context = createMcpGatewayContext(
      createMcpDemoBundle({
        generatedAt: "2026-06-26T00:00:00.000Z"
      })
    );

    const response = await handleMcpGatewayLineAsync(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "execute-bad-budget",
        method: "tools/call",
        params: {
          name: "split402.execute",
          arguments: {
            capability: "solana.wallet-risk",
            input: {
              wallet: "wallet-123"
            },
            budget: {
              maxAmountAtomic: "01"
            }
          }
        }
      }),
      context
    );

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: "execute-bad-budget",
      error: {
        code: -32602,
        message: "budget.maxAmountAtomic must be a non-negative atomic amount string"
      }
    });
  });

  it("rejects non-positive router execution maxAttempts before execution", async () => {
    const context = createMcpGatewayContext(
      createMcpDemoBundle({
        generatedAt: "2026-06-26T00:00:00.000Z"
      })
    );

    const response = await handleMcpGatewayLineAsync(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "execute-bad-max-attempts",
        method: "tools/call",
        params: {
          name: "split402.execute",
          arguments: {
            capability: "solana.wallet-risk",
            input: {
              wallet: "wallet-123"
            },
            budget: {
              maxAmountAtomic: "10000"
            },
            maxAttempts: 0
          }
        }
      }),
      context
    );

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: "execute-bad-max-attempts",
      error: {
        code: -32602,
        message: "maxAttempts must be a positive integer"
      }
    });
  });

  it("rejects fractional router execution maxAttempts before execution", async () => {
    const context = createMcpGatewayContext(
      createMcpDemoBundle({
        generatedAt: "2026-06-26T00:00:00.000Z"
      })
    );

    const response = await handleMcpGatewayLineAsync(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "execute-fractional-max-attempts",
        method: "tools/call",
        params: {
          name: "split402.execute",
          arguments: {
            capability: "solana.wallet-risk",
            input: {
              wallet: "wallet-123"
            },
            budget: {
              maxAmountAtomic: "10000"
            },
            maxAttempts: 1.5
          }
        }
      }),
      context
    );

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: "execute-fractional-max-attempts",
      error: {
        code: -32602,
        message: "maxAttempts must be a positive integer"
      }
    });
  });

  it("passes referral claims from split402.execute into the router", async () => {
    const context = createMcpGatewayContext(
      createMcpDemoBundle({
        generatedAt: "2026-06-26T00:00:00.000Z"
      })
    );
    const referralClaim = createSampleProtocolArtifacts().artifacts.referralClaim;

    const response = await handleMcpGatewayLineAsync(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "execute-with-referral",
        method: "tools/call",
        params: {
          name: "split402.execute",
          arguments: {
            capability: "solana.wallet-risk",
            input: {
              wallet: "wallet-123"
            },
            budget: {
              maxAmountAtomic: "10000"
            },
            referralClaim
          }
        }
      }),
      context
    );

    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: "execute-with-referral",
      result: {
        structuredContent: {
          status: "executed",
          data: {
            referralClaimHash: hashProtocolObject(referralClaim)
          }
        },
        isError: false
      }
    });
  });

  it("rejects malformed referral claims before router execution", async () => {
    const context = createMcpGatewayContext(
      createMcpDemoBundle({
        generatedAt: "2026-06-26T00:00:00.000Z"
      })
    );

    const response = await handleMcpGatewayLineAsync(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "execute-bad-referral",
        method: "tools/call",
        params: {
          name: "split402.execute",
          arguments: {
            capability: "solana.wallet-risk",
            input: {
              wallet: "wallet-123"
            },
            budget: {
              maxAmountAtomic: "10000"
            },
            referralClaim: {
              routeId: "not-a-valid-claim"
            }
          }
        }
      }),
      context
    );

    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: "execute-bad-referral",
      error: {
        code: -32602
      }
    });
    expect(response?.error?.message).toContain("referralClaim is invalid");
  });

  it("runs the local MCP gateway smoke proof", async () => {
    await expect(runMcpGatewaySmoke()).resolves.toMatchObject({
      status: "ok",
      serverName: "split402-demo",
      tools: [
        "split402.walletRiskScore",
        "split402.searchCapabilities",
        "split402.execute",
        "split402.discoverExternalX402",
        "split402.validateExternalX402Artifacts",
        "split402.getReceipt"
      ],
      providerId: "split402-demo-merchant",
      network: expect.any(String),
      asset: expect.any(String),
      payToWallet: expect.any(String),
      maxAmountAtomic: "50000",
      providerAmountAtomic: "10000",
      executionMode: "router-demo-mock",
      amountPaidAtomic: "10000",
      receiptVerificationStatus: "verified",
      referrerCreditAtomic: "1800",
      receiptRequiredAmountAtomic: "10000",
      receiptReferrerCreditAtomic: "1800"
    });
  });

  it("builds a wallet risk tool result from the bundle", () => {
    expect(
      createWalletRiskToolResult(
        "wallet-123",
        createMcpDemoBundle({
          merchantOrigin: "https://merchant.staging.example",
          commissionBps: 1000,
          protocolFeeBpsOfCommission: 0,
          requiredAmountAtomic: "5000",
          generatedAt: "2026-06-26T00:00:00.000Z"
        })
      )
    ).toMatchObject({
      status: "payment_required",
      wallet: "wallet-123",
      paidHttpCall: {
        url: "https://merchant.staging.example/v1/risk",
        bodyTemplate: {
          wallet: "wallet-123"
        }
      },
      expectedEconomics: {
        referrerCreditAtomic: "500",
        protocolFeeAtomic: "0",
        merchantRetainsAtomic: "4500"
      }
    });
  });
});

function mcpControlPlaneFetch(
  calls: string[],
  bundle: ReturnType<typeof createMcpDemoBundle>
): Split402DiscoveryFetch {
  return async (url, init) => {
    expect(init?.headers?.authorization).toBe("Bearer control-token");
    calls.push(url);
    const parsed = new URL(url);
    if (parsed.pathname === "/v1/routes/search") {
      return mcpJsonResponse({
        routes: [{ id: "rte_discovered", campaignId: bundle.mcp.tools[0].split402.campaignId }]
      });
    }
    if (parsed.pathname === "/v1/routes/rte_discovered/bazaar-resources") {
      return mcpJsonResponse({
        resources: [
          {
            schema: "split402.bazaar_resource.v1",
            resource: `${bundle.merchant.origin}/v1/risk`,
            type: "http",
            x402Version: 2,
            accepts: [
              {
                scheme: "exact",
                network: bundle.mcp.tools[0].x402.network,
                amount: bundle.mcp.tools[0].x402.amountAtomic,
                asset: bundle.mcp.tools[0].x402.asset,
                payTo: bundle.mcp.tools[0].x402.payToWallet
              }
            ],
            metadata: {
              method: "POST",
              operationId: bundle.mcp.tools[0].split402.operationId,
              split402: {
                routeId: "rte_discovered",
                campaignId: bundle.mcp.tools[0].split402.campaignId,
                referrerWallet: "referrer-wallet",
                payoutWallet: "payout-wallet"
              }
            }
          }
        ]
      });
    }
    if (parsed.pathname === `/v1/campaigns/${bundle.mcp.tools[0].split402.campaignId}`) {
      return mcpJsonResponse({
        campaign: {
          merchantId: bundle.merchant.merchantId,
          current: { merchantKid: "kid_mcp_demo_1" }
        }
      });
    }
    if (parsed.pathname === `/v1/merchants/${bundle.merchant.merchantId}`) {
      return mcpJsonResponse({
        merchant: {
          keys: [
            {
              kid: "kid_mcp_demo_1",
              publicKey: bundle.merchant.servicePublicKey,
              purpose: "offer_receipt",
              validFrom: "2026-06-24T00:00:00.000Z"
            }
          ]
        }
      });
    }
    return mcpJsonResponse({}, 404);
  };
}

const EXTERNAL_X402_NETWORK = "eip155:8453";
const EXTERNAL_X402_ASSET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const EXTERNAL_X402_AMOUNT_ATOMIC = "20000";
const EXTERNAL_X402_PAY_TO_WALLET =
  "0x68614873C5d624c07DCAA3aFF5243DD5027c3910";
const EXTERNAL_MERCHANT_SEED = hexToBytes(
  "a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf"
);

function mcpExternalX402Fetch(options: {
  split402Offer?: Split402OfferV1;
} = {}): Split402ExternalX402DiscoveryFetch {
  return async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/.well-known/x402") {
      return mcpJsonResponse({
        version: 1,
        paid_routes: [
          {
            method: "GET",
            path: "/price/{coin}",
            price: "$0.02",
            description: "Specific coin USD price.",
            example_unpaid_curl: "curl -i https://x402.example/price/btc"
          }
        ]
      });
    }
    if (parsed.pathname === "/openapi.json") {
      return mcpJsonResponse({
        openapi: "3.0.3",
        paths: {
          "/price/{coin}": {
            get: {
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
      return mcpTextResponse("", {
        status: 402,
        headers: {
          "Payment-Required": encodePaymentRequiredHeader(
            externalX402PaymentRequired(options.split402Offer)
          )
        }
      });
    }
    return mcpJsonResponse({}, 404);
  };
}

function createExternalSplit402Offer(): {
  offer: Split402OfferV1;
  merchantPublicKey: string;
  campaignTerms: Record<string, unknown>;
} {
  const merchantPublicKey = deriveEd25519PublicKey(EXTERNAL_MERCHANT_SEED);
  const campaignTerms = {
    protocolVersion: "0.1",
    campaignId: "cmp_10000000000000000000000000000001",
    campaignVersion: 1,
    merchantId: "mrc_10000000000000000000000000000001",
    resourceOrigin: "https://x402.example",
    operationIds: ["get.price.coin"],
    network: EXTERNAL_X402_NETWORK,
    asset: EXTERNAL_X402_ASSET,
    requiredAmountAtomic: EXTERNAL_X402_AMOUNT_ATOMIC,
    payToWallet: EXTERNAL_X402_PAY_TO_WALLET,
    commissionBps: 2000,
    protocolFeeBpsOfCommission: 1000,
    commissionBase: "required_amount",
    settlementMode: "accrual",
    attributionRequired: true,
    allowSelfReferral: false
  };
  const unsignedOffer = {
    protocolVersion: "0.1",
    campaignId: campaignTerms.campaignId,
    campaignVersion: campaignTerms.campaignVersion,
    campaignTermsHash: hashProtocolObject(campaignTerms),
    merchantId: campaignTerms.merchantId,
    resourceOrigin: campaignTerms.resourceOrigin,
    operationId: "get.price.coin",
    network: campaignTerms.network,
    asset: campaignTerms.asset,
    requiredAmountAtomic: campaignTerms.requiredAmountAtomic,
    payToWallet: campaignTerms.payToWallet,
    commissionBps: campaignTerms.commissionBps,
    protocolFeeBpsOfCommission: campaignTerms.protocolFeeBpsOfCommission,
    commissionBase: "required_amount",
    settlementMode: "accrual",
    attributionRequired: true,
    allowSelfReferral: false,
    offerNonce: "ofn_10000000000000000000000000000001",
    issuedAt: "2026-07-01T00:00:00.000Z",
    validUntil: "2026-07-02T00:00:00.000Z",
    kid: "kid_external_1"
  } satisfies Omit<Split402OfferV1, "signature">;
  const signature = signEd25519Message(
    buildOfferSigningBytes(unsignedOffer),
    EXTERNAL_MERCHANT_SEED
  ).signature;
  return {
    merchantPublicKey,
    campaignTerms,
    offer: {
      ...unsignedOffer,
      signature
    }
  };
}

function createUnsignedExternalOffer(
  offer: Split402OfferV1
): Omit<Split402OfferV1, "signature"> {
  const copy: Partial<Split402OfferV1> = { ...offer };
  delete copy.signature;
  return copy as Omit<Split402OfferV1, "signature">;
}

function createUnsignedExternalReceipt(
  receipt: Split402ReceiptV1
): Omit<Split402ReceiptV1, "signature"> {
  const copy: Partial<Split402ReceiptV1> = { ...receipt };
  delete copy.signature;
  return copy as Omit<Split402ReceiptV1, "signature">;
}

function createExternalSplit402Receipt(
  offer: Split402OfferV1
): Split402ReceiptV1 {
  const sample = createSampleProtocolArtifacts();
  const economics = calculateCommission(
    BigInt(offer.requiredAmountAtomic),
    BigInt(offer.commissionBps),
    BigInt(offer.protocolFeeBpsOfCommission)
  );
  const unsignedReceipt = {
    protocolVersion: "0.1",
    receiptId: "rcp_10000000000000000000000000000001",
    merchantId: offer.merchantId,
    merchantOrigin: offer.resourceOrigin,
    operationId: offer.operationId,
    requestDigest:
      "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    campaignId: offer.campaignId,
    campaignVersion: offer.campaignVersion,
    campaignTermsHash: offer.campaignTermsHash,
    routeId: "rte_10000000000000000000000000000001",
    referralClaimHash:
      "sha256:2222222222222222222222222222222222222222222222222222222222222222",
    referrerWallet: sample.keys.referrerPublicKey,
    payoutWallet: sample.keys.payoutWallet,
    paymentId: "pay_10000000000000000000000000000001",
    network: offer.network,
    asset: offer.asset,
    payerWallet: "0x1111111111111111111111111111111111111111",
    payToWallet: offer.payToWallet,
    requiredAmountAtomic: offer.requiredAmountAtomic,
    settledAmountAtomic: offer.requiredAmountAtomic,
    settlementTxSignature: "0xsettled",
    commissionBps: offer.commissionBps,
    protocolFeeBpsOfCommission: offer.protocolFeeBpsOfCommission,
    commissionBaseAtomic: offer.requiredAmountAtomic,
    commissionAmountAtomic: economics.commission.toString(),
    protocolFeeAtomic: economics.protocolFee.toString(),
    referrerCreditAtomic: economics.referrerCredit.toString(),
    settlementMode: "accrual",
    offerNonce: offer.offerNonce,
    settledAt: "2026-07-01T00:01:00.000Z",
    issuedAt: "2026-07-01T00:01:01.000Z",
    recordingStatus: "accepted",
    eventId: "evt_10000000000000000000000000000001",
    kid: offer.kid
  } satisfies Omit<Split402ReceiptV1, "signature">;
  const signature = signEd25519Message(
    buildReceiptSigningBytes(unsignedReceipt),
    EXTERNAL_MERCHANT_SEED
  ).signature;
  return {
    ...unsignedReceipt,
    signature
  };
}

function externalX402PaymentRequired(
  split402Offer?: Split402OfferV1
): PaymentRequired {
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
        network: EXTERNAL_X402_NETWORK,
        asset: EXTERNAL_X402_ASSET,
        amount: EXTERNAL_X402_AMOUNT_ATOMIC,
        payTo: EXTERNAL_X402_PAY_TO_WALLET,
        maxTimeoutSeconds: 300,
        extra: {}
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
      },
      ...(split402Offer === undefined
        ? {}
        : {
            split402: {
              info: split402Offer
            }
          })
    }
  };
}

function mcpJsonResponse(
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

function mcpTextResponse(
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
