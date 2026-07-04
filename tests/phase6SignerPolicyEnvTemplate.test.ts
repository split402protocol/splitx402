import { describe, expect, it } from "vitest";

import {
  createPhase6SignerPolicyEnvTemplate,
  derivePhase6SignerPolicyValues,
  resolveSolanaSourceTokenAccount,
} from "../src/phase6SignerPolicyEnvTemplate.js";

const PROOF = `paid_request_evidence: attached: paid-suite.log
payout_obligation_evidence: attached: payout-obligations.json
`;

const PAID_SUITE = `noise before json
{
  "network": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  "merchant": {
    "body": {
      "merchantPayTo": "merchant-wallet",
      "paymentAsset": "devnet-usdc",
      "requiredAmountAtomic": "1"
    }
  },
  "x402": {
    "accepts": [
      {
        "network": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
        "asset": "devnet-usdc",
        "amount": "1",
        "payTo": "merchant-wallet"
      }
    ]
  }
}
`;

const PAYOUT_OBLIGATIONS = JSON.stringify({
  summary: {
    assets: [
      {
        asset: "devnet-usdc",
        outstandingAmountAtomic: "31",
        totalAccruedAmountAtomic: "31",
      },
    ],
  },
});

describe("Phase 6 signer policy env template", () => {
  it("derives non-custody policy values from Phase 7 artifacts", () => {
    expect(
      derivePhase6SignerPolicyValues({
        phase7ProofPath: "evidence/phase7-staging-proof.txt",
        phase7ProofText: PROOF,
        exists: (path) =>
          path === "paid-suite.log" || path === "payout-obligations.json",
        readFile: (path) =>
          path === "paid-suite.log" ? PAID_SUITE : PAYOUT_OBLIGATIONS,
      }),
    ).toEqual({
      network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
      fundingWallet: "merchant-wallet",
      mint: "devnet-usdc",
      maxTransactionAmountAtomic: "31",
      maxBatchAmountAtomic: "31",
    });
  });

  it("leaves custody-specific values blank in the generated env template", () => {
    const template = createPhase6SignerPolicyEnvTemplate({
      phase7ProofText: PROOF,
      now: new Date("2026-07-04T12:00:00.000Z"),
      exists: (path) =>
        path === "paid-suite.log" || path === "payout-obligations.json",
      readFile: (path) =>
        path === "paid-suite.log" ? PAID_SUITE : PAYOUT_OBLIGATIONS,
    });

    expect(template).toContain(
      "SPLIT402_PHASE6_SIGNER_POLICY_REVIEW_ID=phase6-signer-policy-2026-07-04",
    );
    expect(template).toContain("SPLIT402_SIGNER_POLICY_FUNDING_WALLET=merchant-wallet");
    expect(template).toContain("SPLIT402_SIGNER_POLICY_MINT=devnet-usdc");
    expect(template).toContain("SPLIT402_SIGNER_POLICY_SOURCE_TOKEN_ACCOUNT=\n");
    expect(template).toContain(
      "SPLIT402_SIGNER_POLICY_EXPECTED_DESTINATION_AMOUNT_LIST_HASH=\n",
    );
    expect(template).toContain("SPLIT402_SIGNER_POLICY_SIGNER_REFERENCE=\n");
    expect(template).toContain(
      "SPLIT402_PHASE6_SIGNER_POLICY_REVIEW_DECISION=no-go",
    );
  });

  it("can render a source token account resolved from Solana RPC", () => {
    const template = createPhase6SignerPolicyEnvTemplate({
      phase7ProofText: PROOF,
      sourceTokenAccount: "funding-source-token-account",
      now: new Date("2026-07-04T12:00:00.000Z"),
      exists: (path) =>
        path === "paid-suite.log" || path === "payout-obligations.json",
      readFile: (path) =>
        path === "paid-suite.log" ? PAID_SUITE : PAYOUT_OBLIGATIONS,
    });

    expect(template).toContain(
      "SPLIT402_SIGNER_POLICY_SOURCE_TOKEN_ACCOUNT=funding-source-token-account",
    );
    expect(template).toContain(
      "Resolved from Solana RPC; review that this token account is controlled by the deployed signer.",
    );
  });

  it("resolves exactly one initialized SPL source token account", async () => {
    await expect(
      resolveSolanaSourceTokenAccount({
        rpcUrl: "https://rpc.example",
        fundingWallet: "merchant-wallet",
        mint: "devnet-usdc",
        fetch: async () => ({
          async json() {
            return {
              result: {
                value: [
                  tokenAccountRecord("source-token-account", {
                    owner: "merchant-wallet",
                    mint: "devnet-usdc",
                    state: "initialized",
                  }),
                ],
              },
            };
          },
        }),
      }),
    ).resolves.toEqual({
      ok: true,
      sourceTokenAccount: "source-token-account",
      errors: [],
    });
  });

  it("fails closed when source token account resolution is ambiguous", async () => {
    const result = await resolveSolanaSourceTokenAccount({
      rpcUrl: "https://rpc.example",
      fundingWallet: "merchant-wallet",
      mint: "devnet-usdc",
      fetch: async () => ({
        async json() {
          return {
            result: {
              value: [
                tokenAccountRecord("source-token-account-1", {
                  owner: "merchant-wallet",
                  mint: "devnet-usdc",
                  state: "initialized",
                }),
                tokenAccountRecord("source-token-account-2", {
                  owner: "merchant-wallet",
                  mint: "devnet-usdc",
                  state: "initialized",
                }),
              ],
            },
          };
        },
      }),
    });

    expect(result).toEqual({
      ok: false,
      errors: ["Expected exactly one funding token account, found 2"],
    });
  });
});

function tokenAccountRecord(
  pubkey: string,
  input: {
    owner: string;
    mint: string;
    state: string;
  },
) {
  return {
    pubkey,
    account: {
      owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      data: {
        parsed: {
          info: input,
        },
      },
    },
  };
}
