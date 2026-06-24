import { createSampleProtocolArtifacts } from "@split402/protocol";
import { describe, expect, it } from "vitest";

import {
  SolanaRpcReceiptVerifier,
  type SolanaRpcFetch
} from "../src/index.js";

describe("SolanaRpcReceiptVerifier", () => {
  it("confirms receipts when the settlement signature is confirmed", async () => {
    const receipt = createSampleProtocolArtifacts().artifacts.receipt;
    const requests: unknown[] = [];
    const verifier = new SolanaRpcReceiptVerifier({
      rpcUrl: "https://api.devnet.solana.com",
      network: receipt.network,
      fetch: createFetch(
        signatureStatusesBody({
          err: null,
          confirmationStatus: "confirmed",
          confirmations: 1
        }),
        requests
      )
    });

    const result = await verifier.verify(receipt);

    expect(result).toEqual({ status: "confirmed" });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual(
      expect.objectContaining({
        method: "getSignatureStatuses",
        params: [[receipt.settlementTxSignature], { searchTransactionHistory: true }]
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
      fetch: createFetch(
        signatureStatusesBody({
          err: null,
          confirmationStatus: "finalized",
          confirmations: null
        })
      )
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
  return async (_input, init) => {
    requests.push(JSON.parse(init.body));
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
