import { createSampleProtocolArtifacts } from "@split402/protocol";
import { describe, expect, it } from "vitest";

import {
  createSolanaPayoutTransactionPlan,
  hashSolanaPayoutDestinationAmountList,
  SOLANA_TOKEN_PROGRAM_ID,
  SOLANA_TOKEN_2022_PROGRAM_ID,
  SolanaPolicyEnforcedPayoutSigner,
  SolanaRpcPayoutTransactionBroadcaster,
  SolanaRpcPayoutTransactionSimulator,
  SolanaRpcReceiptVerifier,
  type SolanaRpcFetch
} from "../src/index.js";
import type {
  PayoutBatchRecord,
  PayoutTransactionRecord,
  SolanaPayoutSignerPolicy,
  SolanaPayoutSimulationReport,
  SolanaPayoutTransactionPlan
} from "../src/index.js";

describe("createSolanaPayoutTransactionPlan", () => {
  it("derives token accounts and plans idempotent ATA creation plus transfer instructions", async () => {
    const receipt = createSampleProtocolArtifacts().artifacts.receipt;
    const batch = payoutBatch(receipt);

    const plan = await createSolanaPayoutTransactionPlan({
      batch,
      fundingWallet: receipt.payToWallet,
      tokenDecimals: 6,
      maxItemsPerTransaction: 1
    });

    expect(plan).toEqual(
      expect.objectContaining({
        batchId: batch.id,
        network: receipt.network,
        asset: receipt.asset,
        tokenProgramId: SOLANA_TOKEN_PROGRAM_ID,
        tokenDecimals: 6,
        fundingWallet: receipt.payToWallet,
        totalAmountAtomic: "3000",
        itemCount: 2,
        transactionCount: 2
      })
    );
    expect(plan.sourceTokenAccount).not.toBe(receipt.payToWallet);
    expect(plan.transactions).toHaveLength(2);
    expect(plan.transactions[0]?.instructions).toEqual([
      expect.objectContaining({
        kind: "createAssociatedTokenIdempotent",
        payer: receipt.payToWallet,
        owner: receipt.payoutWallet,
        mint: receipt.asset,
        tokenProgramId: SOLANA_TOKEN_PROGRAM_ID
      }),
      expect.objectContaining({
        kind: "transferChecked",
        source: plan.sourceTokenAccount,
        mint: receipt.asset,
        authority: receipt.payToWallet,
        amountAtomic: "1000",
        decimals: 6,
        payoutItemId: "pit_11111111111111111111111111111111"
      })
    ]);
    expect(plan.transactions[1]?.items[0]).toEqual(
      expect.objectContaining({
        destinationWallet: receipt.referrerWallet,
        amountAtomic: "2000",
        createAssociatedTokenAccount: true
      })
    );
  });

  it("uses explicit destination token accounts without creating an ATA", async () => {
    const receipt = createSampleProtocolArtifacts().artifacts.receipt;
    const batch = payoutBatch(receipt, {
      destinationTokenAccount: receipt.payerWallet
    });

    const plan = await createSolanaPayoutTransactionPlan({
      batch,
      fundingWallet: receipt.payToWallet,
      sourceTokenAccount: receipt.payerWallet,
      tokenDecimals: 6
    });

    expect(plan.transactions).toHaveLength(1);
    expect(plan.transactions[0]?.instructions).toHaveLength(2);
    expect(plan.transactions[0]?.instructions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "transferChecked",
          source: receipt.payerWallet,
          destination: receipt.payerWallet,
          amountAtomic: "1000"
        }),
        expect.objectContaining({
          kind: "transferChecked",
          source: receipt.payerWallet,
          destination: receipt.payerWallet,
          amountAtomic: "2000"
        })
      ])
    );
    expect(plan.transactions[0]?.items[0]?.createAssociatedTokenAccount).toBe(
      false
    );
  });

  it("rejects invalid payout batches before planning transactions", async () => {
    const receipt = createSampleProtocolArtifacts().artifacts.receipt;

    await expect(
      createSolanaPayoutTransactionPlan({
        batch: { ...payoutBatch(receipt), status: "submitted" },
        fundingWallet: receipt.payToWallet,
        tokenDecimals: 6
      })
    ).rejects.toThrow("payout batch must be planned");
    await expect(
      createSolanaPayoutTransactionPlan({
        batch: payoutBatch(receipt),
        fundingWallet: receipt.payToWallet,
        tokenDecimals: 300
      })
    ).rejects.toThrow("tokenDecimals must be an integer between 0 and 255");
  });
});

describe("SolanaRpcPayoutTransactionSimulator", () => {
  it("simulates serialized payout transactions and reports successful results", async () => {
    const receipt = createSampleProtocolArtifacts().artifacts.receipt;
    const plan = await createSolanaPayoutTransactionPlan({
      batch: payoutBatch(receipt),
      fundingWallet: receipt.payToWallet,
      tokenDecimals: 6,
      maxItemsPerTransaction: 1
    });
    const requests: unknown[] = [];
    const simulator = new SolanaRpcPayoutTransactionSimulator({
      rpcUrl: "https://api.devnet.solana.com",
      network: receipt.network,
      fetch: createFetchSequence([
        simulationBody({ err: null, logs: ["ok 0"], unitsConsumed: 4 }),
        simulationBody({ err: null, logs: ["ok 1"], unitsConsumed: 5 })
      ], requests)
    });

    const report = await simulator.simulate({
      plan,
      transactions: [
        { index: 0, transactionBase64: "AQID" },
        { index: 1, transactionBase64: "BAUG" }
      ]
    });

    expect(report).toEqual({
      batchId: plan.batchId,
      network: receipt.network,
      status: "succeeded",
      transactionResults: [
        {
          index: 0,
          status: "succeeded",
          rpcUrl: "https://api.devnet.solana.com",
          logs: ["ok 0"],
          unitsConsumed: 4
        },
        {
          index: 1,
          status: "succeeded",
          rpcUrl: "https://api.devnet.solana.com",
          logs: ["ok 1"],
          unitsConsumed: 5
        }
      ]
    });
    expect(requests).toEqual([
      expect.objectContaining({
        method: "simulateTransaction",
        params: [
          "AQID",
          {
            commitment: "confirmed",
            encoding: "base64",
            replaceRecentBlockhash: true,
            sigVerify: false
          }
        ]
      }),
      expect.objectContaining({
        method: "simulateTransaction",
        params: [
          "BAUG",
          {
            commitment: "confirmed",
            encoding: "base64",
            replaceRecentBlockhash: true,
            sigVerify: false
          }
        ]
      })
    ]);
  });

  it("falls back across RPC URLs for retryable simulation failures", async () => {
    const receipt = createSampleProtocolArtifacts().artifacts.receipt;
    const plan = await createSolanaPayoutTransactionPlan({
      batch: payoutBatch(receipt, { destinationTokenAccount: receipt.payerWallet }),
      fundingWallet: receipt.payToWallet,
      sourceTokenAccount: receipt.payerWallet,
      tokenDecimals: 6
    });
    const calls: string[] = [];
    const simulator = new SolanaRpcPayoutTransactionSimulator({
      rpcUrls: ["https://primary-rpc.example", "https://secondary-rpc.example"],
      network: receipt.network,
      fetch: async (input) => {
        calls.push(input);
        if (input === "https://primary-rpc.example") {
          return {
            ok: false,
            status: 503,
            async json() {
              return {};
            }
          };
        }
        return createResponse(simulationBody({ err: null }));
      }
    });

    await expect(
      simulator.simulate({
        plan,
        transactions: [{ index: 0, transactionBase64: "AQID" }]
      })
    ).resolves.toEqual(
      expect.objectContaining({
        status: "succeeded",
        transactionResults: [
          expect.objectContaining({
            rpcUrl: "https://secondary-rpc.example",
            status: "succeeded"
          })
        ]
      })
    );
    expect(calls).toEqual([
      "https://primary-rpc.example",
      "https://secondary-rpc.example"
    ]);
  });

  it("reports failed simulations without retrying other providers", async () => {
    const receipt = createSampleProtocolArtifacts().artifacts.receipt;
    const plan = await createSolanaPayoutTransactionPlan({
      batch: payoutBatch(receipt, { destinationTokenAccount: receipt.payerWallet }),
      fundingWallet: receipt.payToWallet,
      sourceTokenAccount: receipt.payerWallet,
      tokenDecimals: 6
    });
    const simulator = new SolanaRpcPayoutTransactionSimulator({
      rpcUrls: ["https://primary-rpc.example", "https://secondary-rpc.example"],
      network: receipt.network,
      fetch: createFetch(simulationBody({
        err: { InstructionError: [0, "InsufficientFunds"] },
        logs: ["failed"]
      }))
    });

    const report = await simulator.simulate({
      plan,
      transactions: [{ index: 0, transactionBase64: "AQID" }]
    });

    expect(report.status).toBe("failed");
    expect(report.transactionResults).toEqual([
      expect.objectContaining({
        status: "failed",
        rpcUrl: "https://primary-rpc.example",
        error: expect.stringContaining("InsufficientFunds"),
        logs: ["failed"]
      })
    ]);
  });

  it("rejects serialized transaction sets that do not match the plan", async () => {
    const receipt = createSampleProtocolArtifacts().artifacts.receipt;
    const plan = await createSolanaPayoutTransactionPlan({
      batch: payoutBatch(receipt),
      fundingWallet: receipt.payToWallet,
      tokenDecimals: 6,
      maxItemsPerTransaction: 1
    });
    const simulator = new SolanaRpcPayoutTransactionSimulator({
      rpcUrl: "https://api.devnet.solana.com",
      network: receipt.network,
      fetch: createFetch(simulationBody({ err: null }))
    });

    await expect(
      simulator.simulate({
        plan,
        transactions: [{ index: 0, transactionBase64: "AQID" }]
      })
    ).rejects.toThrow("serialized transactions must cover every planned transaction");
    await expect(
      simulator.simulate({
        plan,
        transactions: [
          { index: 0, transactionBase64: "AQID" },
          { index: 0, transactionBase64: "BAUG" },
          { index: 1, transactionBase64: "BAUG" }
        ]
      })
    ).rejects.toThrow("duplicate serialized transaction");
  });
});

describe("SolanaPolicyEnforcedPayoutSigner", () => {
  it("signs serialized transactions after policy and simulation checks pass", async () => {
    const receipt = createSampleProtocolArtifacts().artifacts.receipt;
    const plan = await createSolanaPayoutTransactionPlan({
      batch: payoutBatch(receipt),
      fundingWallet: receipt.payToWallet,
      tokenDecimals: 6,
      maxItemsPerTransaction: 1
    });
    const requests: unknown[] = [];
    const signer = new SolanaPolicyEnforcedPayoutSigner({
      policy: signingPolicy(plan, {
        maxTransactionAmountAtomic: "2500",
        maxBatchAmountAtomic: "5000"
      }),
      signTransaction: (input) => {
        requests.push(input);
        return {
          signedTransactionBase64:
            input.plannedTransaction.index === 0 ? "CQkJ" : "CAgI",
          expectedSignature: `sig_${input.plannedTransaction.index}`
        };
      }
    });

    const report = await signer.sign({
      plan,
      simulationReport: successfulSimulationReport(plan),
      transactions: [
        { index: 0, transactionBase64: "AQID" },
        { index: 1, transactionBase64: "BAUG" }
      ]
    });

    expect(report).toEqual({
      batchId: plan.batchId,
      network: plan.network,
      signerReference: "local-dev:payout-signer",
      destinationAmountListHash: hashSolanaPayoutDestinationAmountList(plan),
      signedTransactions: [
        {
          index: 0,
          signedTransactionBase64: "CQkJ",
          expectedSignature: "sig_0"
        },
        {
          index: 1,
          signedTransactionBase64: "CAgI",
          expectedSignature: "sig_1"
        }
      ]
    });
    expect(requests).toEqual([
      expect.objectContaining({
        batchId: plan.batchId,
        network: plan.network,
        signerReference: "local-dev:payout-signer",
        destinationAmountListHash: hashSolanaPayoutDestinationAmountList(plan),
        transactionBase64: "AQID",
        amountAtomic: "1000"
      }),
      expect.objectContaining({
        transactionBase64: "BAUG",
        amountAtomic: "2000"
      })
    ]);
  });

  it("rejects signing without a successful simulation report", async () => {
    const receipt = createSampleProtocolArtifacts().artifacts.receipt;
    const plan = await createSolanaPayoutTransactionPlan({
      batch: payoutBatch(receipt, { destinationTokenAccount: receipt.payerWallet }),
      fundingWallet: receipt.payToWallet,
      sourceTokenAccount: receipt.payerWallet,
      tokenDecimals: 6
    });
    let called = false;
    const signer = new SolanaPolicyEnforcedPayoutSigner({
      policy: signingPolicy(plan),
      signTransaction: () => {
        called = true;
        return { signedTransactionBase64: "CQkJ" };
      }
    });

    await expect(
      signer.sign({
        plan,
        transactions: [{ index: 0, transactionBase64: "AQID" }]
      })
    ).rejects.toThrow("successful payout simulation is required before signing");
    await expect(
      signer.sign({
        plan,
        simulationReport: {
          ...successfulSimulationReport(plan),
          status: "failed",
          transactionResults: [
            {
              index: 0,
              status: "failed",
              error: "insufficient funds"
            }
          ]
        },
        transactions: [{ index: 0, transactionBase64: "AQID" }]
      })
    ).rejects.toThrow("successful payout simulation is required before signing");
    expect(called).toBe(false);
  });

  it("rejects signer policy mismatches and capped transaction amounts", async () => {
    const receipt = createSampleProtocolArtifacts().artifacts.receipt;
    const plan = await createSolanaPayoutTransactionPlan({
      batch: payoutBatch(receipt),
      fundingWallet: receipt.payToWallet,
      tokenDecimals: 6,
      maxItemsPerTransaction: 1
    });
    const sign = async (policy: SolanaPayoutSignerPolicy) =>
      new SolanaPolicyEnforcedPayoutSigner({
        policy,
        signTransaction: () => ({ signedTransactionBase64: "CQkJ" })
      }).sign({
        plan,
        simulationReport: successfulSimulationReport(plan),
        transactions: [
          { index: 0, transactionBase64: "AQID" },
          { index: 1, transactionBase64: "BAUG" }
        ]
      });

    await expect(
      sign(signingPolicy(plan, { network: "solana:mainnet" }))
    ).rejects.toThrow("does not match signer policy network");
    await expect(
      sign(signingPolicy(plan, { allowedTokenProgramIds: [SOLANA_TOKEN_2022_PROGRAM_ID] }))
    ).rejects.toThrow("does not allow plan token program");
    await expect(
      sign(signingPolicy(plan, { maxTransactionAmountAtomic: "1500" }))
    ).rejects.toThrow(
      "payout transaction 1 amount exceeds signer maxTransactionAmountAtomic"
    );
    await expect(
      sign(signingPolicy(plan, {
        expectedDestinationAmountListHash: `sha256:${"f".repeat(64)}`
      }))
    ).rejects.toThrow("destination amount list hash mismatch");
  });
});

describe("SolanaRpcPayoutTransactionBroadcaster", () => {
  it("submits persisted signed transaction bytes with sendTransaction", async () => {
    const requests: unknown[] = [];
    const broadcaster = new SolanaRpcPayoutTransactionBroadcaster({
      rpcUrl: "https://api.devnet.solana.com",
      network: "solana:devnet",
      skipPreflight: true,
      maxRetries: 0,
      fetch: createFetch(
        { jsonrpc: "2.0", id: "split402-payout-broadcast", result: "sig_0" },
        requests
      )
    });

    const result = await broadcaster.broadcast({
      transaction: payoutTransaction({ expectedSignature: "sig_0" })
    });

    expect(result).toEqual({
      transactionId: "ptx_ffffffffffffffffffffffffffffffff",
      status: "submitted",
      rpcUrl: "https://api.devnet.solana.com",
      signature: "sig_0"
    });
    expect(requests).toEqual([
      expect.objectContaining({
        method: "sendTransaction",
        params: [
          "AQID",
          {
            encoding: "base64",
            skipPreflight: true,
            preflightCommitment: "confirmed",
            maxRetries: 0
          }
        ]
      })
    ]);
  });

  it("resends identical signed bytes across RPC URLs for retryable failures", async () => {
    const calls: string[] = [];
    const requests: unknown[] = [];
    const broadcaster = new SolanaRpcPayoutTransactionBroadcaster({
      rpcUrls: ["https://primary-rpc.example", "https://secondary-rpc.example"],
      network: "solana:devnet",
      fetch: async (input, init) => {
        calls.push(input);
        requests.push(JSON.parse(init.body));
        if (input === "https://primary-rpc.example") {
          return {
            ok: false,
            status: 503,
            async json() {
              return {};
            }
          };
        }
        return createResponse({
          jsonrpc: "2.0",
          id: "split402-payout-broadcast",
          result: "sig_0"
        });
      }
    });

    await expect(
      broadcaster.broadcast({ transaction: payoutTransaction() })
    ).resolves.toEqual(
      expect.objectContaining({
        status: "submitted",
        rpcUrl: "https://secondary-rpc.example",
        signature: "sig_0"
      })
    );
    expect(calls).toEqual([
      "https://primary-rpc.example",
      "https://secondary-rpc.example"
    ]);
    expect(
      requests.map((request) =>
        (request as { params: [string, Record<string, unknown>] }).params[0]
      )
    ).toEqual(["AQID", "AQID"]);
  });

  it("rejects transactions that do not have signed bytes ready", async () => {
    const broadcaster = new SolanaRpcPayoutTransactionBroadcaster({
      rpcUrl: "https://api.devnet.solana.com",
      network: "solana:devnet",
      fetch: createFetch({ result: "sig_0" })
    });
    const unsigned: PayoutTransactionRecord = {
      id: "ptx_ffffffffffffffffffffffffffffffff",
      payoutBatchId: "pbt_ffffffffffffffffffffffffffffffff",
      sequence: 0,
      attempt: 1,
      status: "planned",
      createdAt: "2026-06-24T00:00:00.000Z"
    };

    await expect(
      broadcaster.broadcast({
        transaction: unsigned
      })
    ).rejects.toThrow("must be signed before broadcast");
  });
});

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

  it("confirms receipts when the destination is the pay-to associated token account", async () => {
    const receipt = createSampleProtocolArtifacts().artifacts.receipt;
    const verifier = new SolanaRpcReceiptVerifier({
      rpcUrl: "https://api.devnet.solana.com",
      network: receipt.network,
      fetch: createFetchSequence([
        signatureStatusesBody({
          err: null,
          confirmationStatus: "confirmed",
          confirmations: 1
        }),
        transactionBody(receipt, {
          destination: SAMPLE_PAY_TO_ASSOCIATED_TOKEN_ACCOUNT,
          omitDestinationOwner: true
        })
      ])
    });

    await expect(verifier.verify(receipt)).resolves.toEqual({
      status: "confirmed"
    });
  });

  it("falls back across configured RPC URLs before retrying", async () => {
    const receipt = createSampleProtocolArtifacts().artifacts.receipt;
    const calls: string[] = [];
    const verifier = new SolanaRpcReceiptVerifier({
      rpcUrls: ["https://primary-rpc.example", "https://secondary-rpc.example"],
      network: receipt.network,
      fetch: async (input, init) => {
        calls.push(input);
        if (input === "https://primary-rpc.example") {
          return {
            ok: false,
            status: 503,
            async json() {
              return {};
            }
          };
        }
        const request = JSON.parse(init.body) as { method: string };
        return createResponse(
          request.method === "getSignatureStatuses"
            ? signatureStatusesBody({
                err: null,
                confirmationStatus: "confirmed",
                confirmations: 1
              })
            : transactionBody(receipt)
        );
      }
    });

    await expect(verifier.verify(receipt)).resolves.toEqual({
      status: "confirmed"
    });
    expect(calls).toEqual([
      "https://primary-rpc.example",
      "https://secondary-rpc.example",
      "https://secondary-rpc.example"
    ]);
  });

  it("prefers a later provider confirmation over a primary parsed-transfer mismatch", async () => {
    const receipt = createSampleProtocolArtifacts().artifacts.receipt;
    const verifier = new SolanaRpcReceiptVerifier({
      rpcUrls: ["https://primary-rpc.example", "https://secondary-rpc.example"],
      network: receipt.network,
      fetch: async (input, init) => {
        const request = JSON.parse(init.body) as { method: string };
        if (request.method === "getSignatureStatuses") {
          return createResponse(
            signatureStatusesBody({
              err: null,
              confirmationStatus: "confirmed",
              confirmations: 1
            })
          );
        }
        return createResponse(
          input === "https://primary-rpc.example"
            ? transactionBody(receipt, { amount: "1" })
            : transactionBody(receipt)
        );
      }
    });

    await expect(verifier.verify(receipt)).resolves.toEqual({
      status: "confirmed"
    });
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

function payoutBatch(
  receipt: ReturnType<typeof createSampleProtocolArtifacts>["artifacts"]["receipt"],
  options: { destinationTokenAccount?: string } = {}
): PayoutBatchRecord {
  if (receipt.payoutWallet === undefined || receipt.referrerWallet === undefined) {
    throw new Error("sample receipt must include payout and referrer wallets");
  }
  return {
    id: "pbt_ffffffffffffffffffffffffffffffff",
    merchantId: receipt.merchantId,
    payoutWalletId: "mpw_ffffffffffffffffffffffffffffffff",
    network: receipt.network,
    asset: receipt.asset,
    status: "planned",
    totalAmountAtomic: "3000",
    itemCount: 2,
    accrualCount: 2,
    createdAt: "2026-06-24T00:05:00.000Z",
    updatedAt: "2026-06-24T00:05:00.000Z",
    items: [
      {
        id: "pit_11111111111111111111111111111111",
        payoutBatchId: "pbt_ffffffffffffffffffffffffffffffff",
        destinationWallet: receipt.payoutWallet,
        ...(options.destinationTokenAccount === undefined
          ? {}
          : { destinationTokenAccount: options.destinationTokenAccount }),
        amountAtomic: "1000",
        status: "allocated",
        createdAt: "2026-06-24T00:05:00.000Z",
        allocations: [
          {
            payoutItemId: "pit_11111111111111111111111111111111",
            accrualId: "acr_11111111111111111111111111111111",
            amountAtomic: "1000"
          }
        ]
      },
      {
        id: "pit_22222222222222222222222222222222",
        payoutBatchId: "pbt_ffffffffffffffffffffffffffffffff",
        destinationWallet: receipt.referrerWallet,
        ...(options.destinationTokenAccount === undefined
          ? {}
          : { destinationTokenAccount: options.destinationTokenAccount }),
        amountAtomic: "2000",
        status: "allocated",
        createdAt: "2026-06-24T00:05:00.000Z",
        allocations: [
          {
            payoutItemId: "pit_22222222222222222222222222222222",
            accrualId: "acr_22222222222222222222222222222222",
            amountAtomic: "2000"
          }
        ]
      }
    ]
  };
}

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

function simulationBody(input: {
  err: unknown;
  logs?: string[];
  unitsConsumed?: number;
}): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: "split402-payout-simulation",
    result: {
      context: { slot: 1 },
      value: {
        err: input.err,
        logs: input.logs ?? [],
        ...(input.unitsConsumed === undefined
          ? {}
          : { unitsConsumed: input.unitsConsumed })
      }
    }
  };
}

function successfulSimulationReport(
  plan: SolanaPayoutTransactionPlan
): SolanaPayoutSimulationReport {
  return {
    batchId: plan.batchId,
    network: plan.network,
    status: "succeeded",
    transactionResults: plan.transactions.map((transaction) => ({
      index: transaction.index,
      status: "succeeded"
    }))
  };
}

function signingPolicy(
  plan: SolanaPayoutTransactionPlan,
  overrides: Partial<SolanaPayoutSignerPolicy> = {}
): SolanaPayoutSignerPolicy {
  return {
    network: plan.network,
    signerReference: "local-dev:payout-signer",
    fundingWallet: plan.fundingWallet,
    sourceTokenAccount: plan.sourceTokenAccount,
    mint: plan.asset,
    allowedTokenProgramIds: [plan.tokenProgramId],
    expectedDestinationAmountListHash: hashSolanaPayoutDestinationAmountList(plan),
    ...overrides
  };
}

function payoutTransaction(
  overrides: Partial<PayoutTransactionRecord> = {}
): PayoutTransactionRecord {
  return {
    id: "ptx_ffffffffffffffffffffffffffffffff",
    payoutBatchId: "pbt_ffffffffffffffffffffffffffffffff",
    sequence: 0,
    attempt: 1,
    signedTransactionBase64: "AQID",
    expectedSignature: "sig_0",
    status: "signed",
    createdAt: "2026-06-24T00:00:00.000Z",
    ...overrides
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
  destination?: string;
  destinationOwner?: string;
  destinationProgramId?: string;
  metaErr?: unknown;
  mint?: string;
  omitDestinationOwner?: boolean;
}

const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SAMPLE_PAY_TO_ASSOCIATED_TOKEN_ACCOUNT =
  "Ay71VZA4NmCmqF8V8xQLDR7kCqDkVQ94TDo3878qh537";

function transactionBody(
  receipt: ReturnType<typeof createSampleProtocolArtifacts>["artifacts"]["receipt"],
  overrides: TransactionBodyOverrides = {}
): Record<string, unknown> {
  const mint = overrides.mint ?? receipt.asset;
  const destination =
    overrides.destination ?? "merchantTokenAccount111111111111111111111111111111";
  const amount =
    overrides.amount ?? receipt.settledAmountAtomic ?? receipt.requiredAmountAtomic;
  const tokenBalance: Record<string, unknown> = {
    accountIndex: 1,
    mint,
    programId: overrides.destinationProgramId ?? TOKEN_PROGRAM_ID,
    uiTokenAmount: {
      amount,
      decimals: 6,
      uiAmount: null,
      uiAmountString: "0"
    }
  };
  if (overrides.omitDestinationOwner !== true) {
    tokenBalance.owner = overrides.destinationOwner ?? receipt.payToWallet;
  }
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
          tokenBalance
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
