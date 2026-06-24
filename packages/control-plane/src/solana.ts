import type { Split402ReceiptV1 } from "@split402/protocol";

import type {
  ReceiptChainVerificationResult,
  ReceiptChainVerifier
} from "./workers.js";

export type SolanaRpcCommitment = "confirmed" | "finalized";

export interface SolanaRpcReceiptVerifierOptions {
  rpcUrl: string;
  network: string;
  commitment?: SolanaRpcCommitment;
  fetch?: SolanaRpcFetch;
}

export type SolanaRpcFetch = (
  input: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
  }
) => Promise<SolanaRpcHttpResponse>;

export interface SolanaRpcHttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

type SolanaSignatureConfirmationStatus =
  | "processed"
  | "confirmed"
  | "finalized";

interface SolanaSignatureStatus {
  err: unknown;
  confirmationStatus?: SolanaSignatureConfirmationStatus;
  confirmations?: number | null;
}

export class SolanaRpcReceiptVerifier implements ReceiptChainVerifier {
  constructor(private readonly options: SolanaRpcReceiptVerifierOptions) {}

  async verify(
    receipt: Split402ReceiptV1
  ): Promise<ReceiptChainVerificationResult> {
    if (receipt.network !== this.options.network) {
      return {
        status: "rejected",
        error: `receipt network ${receipt.network} does not match verifier network ${this.options.network}`
      };
    }

    const rpcResponse = await this.requestSignatureStatus(
      receipt.settlementTxSignature
    );
    if (rpcResponse.status === "retry") {
      return rpcResponse;
    }

    const signatureStatus = rpcResponse.signatureStatus;
    if (signatureStatus === null) {
      return {
        status: "retry",
        error: `settlement transaction not found: ${receipt.settlementTxSignature}`
      };
    }
    if (signatureStatus.err !== null) {
      return {
        status: "rejected",
        error: `settlement transaction failed: ${JSON.stringify(signatureStatus.err)}`
      };
    }
    if (!hasRequiredCommitment(signatureStatus, this.commitment())) {
      return {
        status: "retry",
        error: `settlement transaction has not reached ${this.commitment()} commitment`
      };
    }

    return { status: "confirmed" };
  }

  private async requestSignatureStatus(
    signature: string
  ): Promise<
    | {
        status: "ok";
        signatureStatus: SolanaSignatureStatus | null;
      }
    | Extract<ReceiptChainVerificationResult, { status: "retry" }>
  > {
    let response: SolanaRpcHttpResponse;
    try {
      response = await this.fetch()(this.options.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "split402-chain-verification",
          method: "getSignatureStatuses",
          params: [[signature], { searchTransactionHistory: true }]
        })
      });
    } catch (error) {
      return {
        status: "retry",
        error: `Solana RPC request failed: ${readErrorMessage(error)}`
      };
    }

    if (!response.ok) {
      return {
        status: "retry",
        error: `Solana RPC returned HTTP ${response.status}`
      };
    }

    try {
      const body = await response.json();
      const rpcError = readRpcError(body);
      if (rpcError !== undefined) {
        return {
          status: "retry",
          error: `Solana RPC returned error: ${rpcError}`
        };
      }

      return {
        status: "ok",
        signatureStatus: readSignatureStatus(body)
      };
    } catch (error) {
      return {
        status: "retry",
        error: `Solana RPC response was invalid: ${readErrorMessage(error)}`
      };
    }
  }

  private commitment(): SolanaRpcCommitment {
    return this.options.commitment ?? "confirmed";
  }

  private fetch(): SolanaRpcFetch {
    return this.options.fetch ?? fetch;
  }
}

function hasRequiredCommitment(
  status: SolanaSignatureStatus,
  required: SolanaRpcCommitment
): boolean {
  if (status.confirmationStatus === "finalized") {
    return true;
  }
  return required === "confirmed" && status.confirmationStatus === "confirmed";
}

function readSignatureStatus(body: unknown): SolanaSignatureStatus | null {
  const result = readRecord(readRecord(body).result);
  const value = result.value;
  if (!Array.isArray(value)) {
    throw new Error("Solana RPC getSignatureStatuses result.value must be an array");
  }
  const first = value[0];
  if (first === null) {
    return null;
  }
  const status = readRecord(first);
  return {
    err: status.err,
    ...(typeof status.confirmationStatus === "string"
      ? {
          confirmationStatus: readConfirmationStatus(status.confirmationStatus)
        }
      : {}),
    ...(typeof status.confirmations === "number" || status.confirmations === null
      ? { confirmations: status.confirmations }
      : {})
  };
}

function readConfirmationStatus(value: string): SolanaSignatureConfirmationStatus {
  if (value === "processed" || value === "confirmed" || value === "finalized") {
    return value;
  }
  throw new Error(`unsupported Solana confirmation status: ${value}`);
}

function readRpcError(body: unknown): string | undefined {
  const record = readRecord(body);
  if (record.error === undefined) {
    return undefined;
  }
  return JSON.stringify(record.error);
}

function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("expected object");
  }
  return value as Record<string, unknown>;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
