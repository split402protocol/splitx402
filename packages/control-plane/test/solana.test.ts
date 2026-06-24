import { createSampleProtocolArtifacts } from "@split402/protocol";
import { describe, expect, it } from "vitest";

import {
  SolanaRpcReceiptVerifier,
  type SolanaRpcFetch
} from "../src/index.js";

describe("SolanaRpcReceiptVerifier", () => {
  it("confirms receipts when the settlement signature and token transfer match", async () => {
    const receipt = createSampleProtocolArtifacts().artifacts.receipt;
    const requests: unknown[] = [];
    const verifier = new SolanaRpcReceiptVerifier({
      rpcUrl: "https://api.devnet.solana.com",
      network: receipt.network,
      fetch: createFetchSequence([
        signatureStatusesBody({
          err: null,
          confirmationStatus: "confirmed",
          confirmations: 1
        }),
        transactionBody(receipt)
      ], requests)
    });

    const result = await verifier.verify(receipt);

    expect(result).toEqual({ status: "confirmed" });
    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual(
      expect.objectContaining({
        method: "getSignatureStatuses",
        params: [[receipt.settlementTxSignature], { searchTransactionHistory: true }]
      })
    );
    expect(requests[1]).toEqual(
      expect.objectContaining({
        method: "getTransaction",
        params: [
          receipt.settlementTxSignature,
          {
            commitment: "confirmed",
            encoding: "jsonParsed",
            maxSupportedTransactionVersion: 0
          }
        ]
      })
    );
  });

  it("waits until finalized when finalized commitment is required", async () => {
    const receipt = createSampleProtocolArtifacts().artifacts.receipt;
    const confirmedVerifier = new SolanaRpcReceiptVerifier({
      rpcUrl: "https://api.devnet.solana.com",
      network: receipt.network,
      commitment: "finalized",
      fetch: createFetch(
        signatureStatusesBody({
          err: null,
          confirmationStatus: "confirmed",
          confirmations: 1
        })
      )
    });
    const finalizedVerifier = new SolanaRpcReceiptVerifier({
      rpcUrl: "https://api.devnet.solana.com",
      network: receipt.network,
      commitment: "finalized",
      fetch: createFetchSequence([
        signatureStatusesBody({
          err: null,
          confirmationStatus: "finalized",
          confirmations: null
        }),
        transactionBody(receipt)
      ])
    });

    await expect(confirmedVerifier.verify(receipt)).resolves.toEqual(
      expect.objectContaining({
        status: "retry",
        error: "settlement transaction has not reached finalized commitment"
      })
    );
    await expect(finalizedVerifier.verify(receipt)).resolves.toEqual({
      status: "confirmed"
    });
  });

  it("retries missing or unavailable signature status reads", async () => {
    const receipt = createSampleProtocolArtifacts().artifacts.receipt;
    const missingVerifier = new SolanaRpcReceiptVerifier({
      rpcUrl: "https://api.devnet.solana.com",
      network: receipt.network,
      fetch: createFetch(signatureStatusesBody(null))
    });
    const rpcErrorVerifier = new SolanaRpcReceiptVerifier({
      rpcUrl: "https://api.devnet.solana.com",
      network: receipt.network,
      fetch: createFetch({
        jsonrpc: "2.0",
        id: "split402-chain-verification",
        error: { code: -32005, message: "node unhealthy" }
      })
    });
    const malformedVerifier = new SolanaRpcReceiptVerifier({
      rpcUrl: "https://api.devnet.solana.com",
      network: receipt.network,
      fetch: createFetch({ result: { value: "not-an-array" } })
    });

    await expect(missingVerifier.verify(receipt)).resolves.toEqual(
      expect.objectContaining({
        status: "retry",
        error: `settlement transaction not found: ${receipt.settlementTxSignature}`
      })
    );
    await expect(rpcErrorVerifier.verify(receipt)).resolves.toEqual(
      expect.objectContaining({
        status: "retry",
        error: expect.stringContaining("node unhealthy")
      })
    );
    await expect(malformedVerifier.verify(receipt)).resolves.toEqual(
      expect.objectContaining({
        status: "retry",
        error: expect.stringContaining("Solana RPC response was invalid")
      })
    );
  });

  it("retries missing or malformed transaction detail reads", async () => {
    const receipt = createSampleProtocolArtifacts().artifacts.receipt;
    const missingTransactionVerifier = new SolanaRpcReceiptVerifier({
      rpcUrl: "https://api.devnet.solana.com",
      network: receipt.network,
      fetch: createFetchSequence([
        signatureStatusesBody({
          err: null,
          confirmationStatus: "confirmed",
          confirmations: 1
        }),
        { jsonrpc: "2.0", id: "split402-chain-verification", result: null }
      ])
    });
    const malformedTransactionVerifier = new SolanaRpcReceiptVerifier({
      rpcUrl: "https://api.devnet.solana.com",
      network: receipt.network,
      fetch: createFetchSequence([
        signatureStatusesBody({
          err: null,
          confirmationStatus: "confirmed",
          confirmations: 1
        }),
        { jsonrpc: "2.0", id: "split402-chain-verification", result: { meta: null } }
      ])
    });

    await expect(missingTransactionVerifier.verify(receipt)).resolves.toEqual(
      expect.objectContaining({
        status: "retry",
        error: `settlement transaction details not found: ${receipt.settlementTxSignature}`
      })
    );
    await expect(malformedTransactionVerifier.verify(receipt)).resolves.toEqual(
      expect.objectContaining({
        status: "retry",
        error: expect.stringContaining("Solana RPC response was invalid")
      })
    );
  });

  it("rejects failed settlement signatures and wrong networks", async () => {
    const receipt = createSampleProtocolArtifacts().artifacts.receipt;
    let called = false;
    const failedVerifier = new SolanaRpcReceiptVerifier({
      rpcUrl: "https://api.devnet.solana.com",
      network: receipt.network,
      fetch: createFetch(
        signatureStatusesBody({
          err: { InstructionError: [0, "InsufficientFunds"] },
          confirmationStatus: "finalized",
          confirmations: null
        })
      )
    });
    const wrongNetworkVerifier = new SolanaRpcReceiptVerifier({
      rpcUrl: "https://api.devnet.solana.com",
      network: "solana:mainnet",
      fetch: async () => {
        called = true;
        return createResponse(signatureStatusesBody(null));
      }
    });

    await expect(failedVerifier.verify(receipt)).resolves.toEqual(
      expect.objectContaining({
        status: "rejected",
        error: expect.stringContaining("settlement transaction failed")
      })
    );
    await expect(wrongNetworkVerifier.verify(receipt)).resolves.toEqual(
      expect.objectContaining({
        status: "rejected",
        error: expect.stringContaining("does not match verifier network")
      })
    );
    expect(called).toBe(false);
  });

  it("rejects confirmed transactions whose transfer does not match the receipt", async () => {
    const receipt = createSampleProtocolArtifacts().artifacts.receipt;

    await expectTransactionRejection(
      receipt,
      transactionBody(receipt, { mint: receipt.payToWallet }),
      "does not contain a matching token transfer"
    );
    await expectTransactionRejection(
      receipt,
      transactionBody(receipt, { destinationOwner: receipt.payerWallet }),
      "does not contain a matching token transfer"
    );
    await expectTransactionRejection(
      receipt,
      transactionBody(receipt, { authority: receipt.payToWallet }),
      "does not contain a matching token transfer"
    );
    await expectTransactionRejection(
      receipt,
      transactionBody(receipt, { amount: "1" }),
      "does not contain a matching token transfer"
    );
    await expectTransactionRejection(
      receipt,
      transactionBody(receipt, {
        metaErr: { InstructionError: [0, "InsufficientFunds"] }
      }),
      "settlement transaction failed"
    );
  });
});

function signatureStatusesBody(
  status: Record<string, unknown> | null
): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: "split402-chain-verification",
    result: {
      context: { slot: 1 },
      value: [status]
    }
  };
}

function createFetch(
  body: unknown,
  requests: unknown[] = []
): SolanaRpcFetch {
  return createFetchSequence([body], requests);
}

function createFetchSequence(
  bodies: unknown[],
  requests: unknown[] = []
): SolanaRpcFetch {
  let index = 0;
  return async (_input, init) => {
    requests.push(JSON.parse(init.body));
    const body = bodies[index];
    index += 1;
    if (body === undefined) {
      throw new Error("unexpected Solana RPC request");
    }
    return createResponse(body);
  };
}

function createResponse(body: unknown): Awaited<ReturnType<SolanaRpcFetch>> {
  return {
    ok: true,
    status: 200,
    async json() {
      return body;
    }
  };
}

interface TransactionBodyOverrides {
  amount?: string;
  authority?: string;
  destinationOwner?: string;
  metaErr?: unknown;
  mint?: string;
}

const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

function transactionBody(
  receipt: ReturnType<typeof createSampleProtocolArtifacts>["artifacts"]["receipt"],
  overrides: TransactionBodyOverrides = {}
): Record<string, unknown> {
  const mint = overrides.mint ?? receipt.asset;
  const destination = "merchantTokenAccount111111111111111111111111111111";
  const amount =
    overrides.amount ?? receipt.settledAmountAtomic ?? receipt.requiredAmountAtomic;
  return {
    jsonrpc: "2.0",
    id: "split402-chain-verification",
    result: {
      slot: 1,
      blockTime: 1,
      version: 0,
      meta: {
        err: overrides.metaErr ?? null,
        preTokenBalances: [],
        postTokenBalances: [
          {
            accountIndex: 1,
            mint,
            owner: overrides.destinationOwner ?? receipt.payToWallet,
            programId: TOKEN_PROGRAM_ID,
            uiTokenAmount: {
              amount,
              decimals: 6,
              uiAmount: null,
              uiAmountString: "0"
            }
          }
        ],
        innerInstructions: []
      },
      transaction: {
        signatures: [receipt.settlementTxSignature],
        message: {
          accountKeys: [
            receipt.payerWallet,
            destination,
            receipt.payToWallet,
            receipt.asset
          ],
          instructions: [
            {
              programId: TOKEN_PROGRAM_ID,
              parsed: {
                type: "transferChecked",
                info: {
                  source: "payerTokenAccount1111111111111111111111111111111",
                  mint,
                  destination,
                  authority: overrides.authority ?? receipt.payerWallet,
                  tokenAmount: {
                    amount,
                    decimals: 6,
                    uiAmount: null,
                    uiAmountString: "0"
                  }
                }
              }
            }
          ]
        }
      }
    }
  };
}

async function expectTransactionRejection(
  receipt: ReturnType<typeof createSampleProtocolArtifacts>["artifacts"]["receipt"],
  transaction: Record<string, unknown>,
  expectedError: string
): Promise<void> {
  const verifier = new SolanaRpcReceiptVerifier({
    rpcUrl: "https://api.devnet.solana.com",
    network: receipt.network,
    fetch: createFetchSequence([
      signatureStatusesBody({
        err: null,
        confirmationStatus: "confirmed",
        confirmations: 1
      }),
      transaction
    ])
  });

  await expect(verifier.verify(receipt)).resolves.toEqual(
    expect.objectContaining({
      status: "rejected",
      error: expect.stringContaining(expectedError)
    })
  );
}
