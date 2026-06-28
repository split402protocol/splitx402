import { deriveEd25519PublicKey, hexToBytes } from "@split402/protocol";

export const MCP_DEMO_SOLANA_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
export const MCP_DEMO_DEFAULT_DEVNET_USDC =
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const MCP_DEMO_DEFAULT_SERVICE_SEED_HEX =
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
export const MCP_DEMO_MERCHANT_ID = "mrc_00000000000000000000000000000001";
export const MCP_DEMO_CAMPAIGN_ID = "cmp_00000000000000000000000000000002";
export const MCP_DEMO_OPERATION_ID = "wallet-risk-score";

export interface McpDemoBundleInput {
  merchantOrigin?: string;
  merchantPublicKey?: string;
  payToWallet?: string;
  asset?: string;
  requiredAmountAtomic?: string;
  commissionBps?: number;
  protocolFeeBpsOfCommission?: number;
  generatedAt?: string;
}

export interface McpDemoBundle {
  schemaVersion: "split402.mcp-demo-bundle.v1";
  project: "Split402";
  generatedAt: string;
  merchant: {
    merchantId: string;
    origin: string;
    discoveryUrl: string;
    servicePublicKey: string;
  };
  mcp: {
    serverName: "split402-demo";
    transport: "stdio";
    tools: [
      {
        name: "split402.walletRiskScore";
        description: string;
        inputSchema: {
          type: "object";
          properties: {
            wallet: {
              type: "string";
              description: string;
            };
          };
          required: ["wallet"];
          additionalProperties: false;
        };
        paidHttpCall: {
          method: "POST";
          url: string;
          bodyTemplate: {
            wallet: "{{wallet}}";
          };
        };
        x402: {
          scheme: "exact";
          network: typeof MCP_DEMO_SOLANA_DEVNET;
          asset: string;
          payToWallet: string;
          amountAtomic: string;
        };
        split402: {
          campaignId: string;
          operationId: string;
          commissionBps: number;
          protocolFeeBpsOfCommission: number;
          referralClaimSources: ["mcp-config", "tool-argument", "http-header"];
          receiptVerification: {
            package: "@split402/agent-sdk";
            method: "Split402AgentClient.verifyReceipt";
          };
        };
      }
    ];
  };
  expectedEconomics: {
    paymentAmountAtomic: string;
    referrerCommissionBps: number;
    protocolFeeBpsOfCommission: number;
    commissionAmountAtomic: string;
    protocolFeeAtomic: string;
    referrerCreditAtomic: string;
    merchantRetainsAtomic: string;
  };
  runbook: {
    setup: string[];
    inspect: string[];
    paidProof: string[];
  };
}

export function createMcpDemoBundle(
  input: McpDemoBundleInput = {}
): McpDemoBundle {
  const merchantOrigin = normalizeOrigin(
    input.merchantOrigin ?? process.env.SPLIT402_MERCHANT_ORIGIN ?? "http://localhost:4021"
  );
  const requiredAmountAtomic =
    input.requiredAmountAtomic ??
    process.env.SPLIT402_REQUIRED_AMOUNT_ATOMIC ??
    "10000";
  const commissionBps =
    input.commissionBps ??
    readCommissionBps(process.env.SPLIT402_COMMISSION_BPS ?? "2000");
  const protocolFeeBpsOfCommission =
    input.protocolFeeBpsOfCommission ??
    readCommissionBps(process.env.SPLIT402_PROTOCOL_FEE_BPS_OF_COMMISSION ?? "1000");
  const paymentAmount = readAtomicAmount(requiredAmountAtomic);
  const commissionAmount = (paymentAmount * BigInt(commissionBps)) / 10_000n;
  const protocolFee =
    (commissionAmount * BigInt(protocolFeeBpsOfCommission)) / 10_000n;
  const referrerCredit = commissionAmount - protocolFee;
  const merchantRetains = paymentAmount - commissionAmount;
  const asset =
    input.asset ?? process.env.SPLIT402_ASSET ?? MCP_DEMO_DEFAULT_DEVNET_USDC;
  const servicePublicKey =
    input.merchantPublicKey ??
    deriveEd25519PublicKey(
      hexToBytes(MCP_DEMO_DEFAULT_SERVICE_SEED_HEX)
    );
  const payToWallet =
    input.payToWallet ?? process.env.SPLIT402_PAY_TO_WALLET ?? servicePublicKey;

  return {
    schemaVersion: "split402.mcp-demo-bundle.v1",
    project: "Split402",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    merchant: {
      merchantId: MCP_DEMO_MERCHANT_ID,
      origin: merchantOrigin,
      discoveryUrl: `${merchantOrigin}/.well-known/split402.json`,
      servicePublicKey
    },
    mcp: {
      serverName: "split402-demo",
      transport: "stdio",
      tools: [
        {
          name: "split402.walletRiskScore",
          description:
            "Calls the Split402 demo merchant's x402-paid wallet risk-score API and verifies the merchant-signed referral receipt.",
          inputSchema: {
            type: "object",
            properties: {
              wallet: {
                type: "string",
                description: "Wallet address to score through the paid demo API."
              }
            },
            required: ["wallet"],
            additionalProperties: false
          },
          paidHttpCall: {
            method: "POST",
            url: `${merchantOrigin}/v1/risk`,
            bodyTemplate: {
              wallet: "{{wallet}}"
            }
          },
          x402: {
            scheme: "exact",
            network: MCP_DEMO_SOLANA_DEVNET,
            asset,
            payToWallet,
            amountAtomic: requiredAmountAtomic
          },
          split402: {
            campaignId: MCP_DEMO_CAMPAIGN_ID,
            operationId: MCP_DEMO_OPERATION_ID,
            commissionBps,
            protocolFeeBpsOfCommission,
            referralClaimSources: ["mcp-config", "tool-argument", "http-header"],
            receiptVerification: {
              package: "@split402/agent-sdk",
              method: "Split402AgentClient.verifyReceipt"
            }
          }
        }
      ]
    },
    expectedEconomics: {
      paymentAmountAtomic: paymentAmount.toString(),
      referrerCommissionBps: commissionBps,
      protocolFeeBpsOfCommission,
      commissionAmountAtomic: commissionAmount.toString(),
      protocolFeeAtomic: protocolFee.toString(),
      referrerCreditAtomic: referrerCredit.toString(),
      merchantRetainsAtomic: merchantRetains.toString()
    },
    runbook: {
      setup: [
        "corepack pnpm demo:setup-buyer",
        "corepack pnpm demo:setup-existing-token"
      ],
      inspect: [
        "corepack pnpm demo:merchant",
        "corepack pnpm demo:inspect-offer",
        "corepack pnpm demo:mcp-bundle"
      ],
      paidProof: ["corepack pnpm demo:paid-suite"]
    }
  };
}

function normalizeOrigin(value: string): string {
  return value.replace(/\/+$/u, "");
}

function readAtomicAmount(value: string): bigint {
  if (!/^[0-9]+$/u.test(value)) {
    throw new Error("requiredAmountAtomic must be an unsigned integer string");
  }
  return BigInt(value);
}

function readCommissionBps(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10_000) {
    throw new Error("commissionBps must be an integer from 0 to 10000");
  }
  return parsed;
}
