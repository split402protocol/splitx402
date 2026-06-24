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

interface SolanaConfirmedTransaction {
  signatures: string[];
  metaErr: unknown;
  tokenAccounts: Map<string, SolanaTokenAccountEvidence>;
  transfers: SolanaTokenTransfer[];
}

interface SolanaTokenAccountEvidence {
  mint: string;
  owner?: string;
  programId?: string;
}

interface SolanaTokenTransfer {
  programId?: string;
  source?: string;
  mint: string;
  destination: string;
  authority: string;
  amount: string;
}

const TOKEN_PROGRAM_IDS = new Set([
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
]);

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

    const transactionResponse = await this.requestConfirmedTransaction(
      receipt.settlementTxSignature
    );
    if (transactionResponse.status === "retry") {
      return transactionResponse;
    }

    const transaction = transactionResponse.transaction;
    if (transaction === null) {
      return {
        status: "retry",
        error: `settlement transaction details not found: ${receipt.settlementTxSignature}`
      };
    }

    const transactionVerification = verifyReceiptTransaction(receipt, transaction);
    if (transactionVerification !== undefined) {
      return transactionVerification;
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

  private async requestConfirmedTransaction(
    signature: string
  ): Promise<
    | {
        status: "ok";
        transaction: SolanaConfirmedTransaction | null;
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
          method: "getTransaction",
          params: [
            signature,
            {
              commitment: this.commitment(),
              encoding: "jsonParsed",
              maxSupportedTransactionVersion: 0
            }
          ]
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
        transaction: readConfirmedTransaction(body)
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

function readConfirmedTransaction(body: unknown): SolanaConfirmedTransaction | null {
  const result = readRecord(body).result;
  if (result === null) {
    return null;
  }
  const transactionResult = readRecord(result);
  const meta = readRecord(transactionResult.meta);
  const transaction = readRecord(transactionResult.transaction);
  const message = readRecord(transaction.message);
  const accountKeys = readAccountKeys(message.accountKeys);
  const topLevelInstructions = readArray(message.instructions, "transaction.message.instructions");
  const innerInstructionGroups =
    transactionResult.meta === null
      ? []
      : readOptionalArray(meta.innerInstructions, "transaction.meta.innerInstructions");

  return {
    signatures: readStringArray(transaction.signatures, "transaction.signatures"),
    metaErr: meta.err,
    tokenAccounts: readTokenAccountEvidence(meta, accountKeys),
    transfers: [
      ...readTransfers(topLevelInstructions),
      ...readInnerTransfers(innerInstructionGroups)
    ]
  };
}

function verifyReceiptTransaction(
  receipt: Split402ReceiptV1,
  transaction: SolanaConfirmedTransaction
): ReceiptChainVerificationResult | undefined {
  if (!transaction.signatures.includes(receipt.settlementTxSignature)) {
    return {
      status: "rejected",
      error: "settlement transaction signatures do not include receipt signature"
    };
  }
  if (transaction.metaErr !== null) {
    return {
      status: "rejected",
      error: `settlement transaction failed: ${JSON.stringify(transaction.metaErr)}`
    };
  }

  const requiredAmount = maxAtomicAmount(
    receipt.requiredAmountAtomic,
    receipt.settledAmountAtomic
  );
  const matchingTransfers = transaction.transfers.filter((transfer) =>
    transferSatisfiesReceipt(transfer, receipt, requiredAmount, transaction.tokenAccounts)
  );

  if (matchingTransfers.length === 0) {
    return {
      status: "rejected",
      error:
        "settlement transaction does not contain a matching token transfer for receipt asset, payTo wallet, payer wallet, and amount"
    };
  }
  return undefined;
}

function transferSatisfiesReceipt(
  transfer: SolanaTokenTransfer,
  receipt: Split402ReceiptV1,
  requiredAmount: string,
  tokenAccounts: Map<string, SolanaTokenAccountEvidence>
): boolean {
  if (transfer.programId !== undefined && !TOKEN_PROGRAM_IDS.has(transfer.programId)) {
    return false;
  }
  if (transfer.mint !== receipt.asset) {
    return false;
  }
  if (transfer.authority !== receipt.payerWallet) {
    return false;
  }
  if (BigInt(transfer.amount) < BigInt(requiredAmount)) {
    return false;
  }

  const destination = tokenAccounts.get(transfer.destination);
  return (
    destination !== undefined &&
    destination.mint === receipt.asset &&
    destination.owner === receipt.payToWallet &&
    (destination.programId === undefined || TOKEN_PROGRAM_IDS.has(destination.programId))
  );
}

function readTokenAccountEvidence(
  meta: Record<string, unknown>,
  accountKeys: string[]
): Map<string, SolanaTokenAccountEvidence> {
  const accounts = new Map<string, SolanaTokenAccountEvidence>();
  for (const balance of [
    ...readOptionalArray(meta.preTokenBalances, "transaction.meta.preTokenBalances"),
    ...readOptionalArray(meta.postTokenBalances, "transaction.meta.postTokenBalances")
  ]) {
    const record = readRecord(balance);
    const accountIndex = readInteger(record.accountIndex, "tokenBalance.accountIndex");
    const account = accountKeys[accountIndex];
    const mint = readOptionalString(record.mint);
    if (account === undefined || mint === undefined) {
      continue;
    }
    const existing = accounts.get(account);
    const evidence: SolanaTokenAccountEvidence = { mint };
    const owner = readOptionalString(record.owner) ?? existing?.owner;
    const programId = readOptionalString(record.programId) ?? existing?.programId;
    if (owner !== undefined) {
      evidence.owner = owner;
    }
    if (programId !== undefined) {
      evidence.programId = programId;
    }
    accounts.set(account, evidence);
  }
  return accounts;
}

function readTransfers(instructions: unknown[]): SolanaTokenTransfer[] {
  const transfers: SolanaTokenTransfer[] = [];
  for (const instruction of instructions) {
    const transfer = readTransfer(instruction);
    if (transfer !== undefined) {
      transfers.push(transfer);
    }
  }
  return transfers;
}

function readInnerTransfers(groups: unknown[]): SolanaTokenTransfer[] {
  const transfers: SolanaTokenTransfer[] = [];
  for (const group of groups) {
    const record = readRecord(group);
    const instructions = readOptionalArray(record.instructions, "innerInstructions.instructions");
    transfers.push(...readTransfers(instructions));
  }
  return transfers;
}

function readTransfer(instruction: unknown): SolanaTokenTransfer | undefined {
  const record = readOptionalRecord(instruction);
  if (record === undefined) {
    return undefined;
  }
  const parsed = readOptionalRecord(record.parsed);
  if (parsed === undefined || parsed.type !== "transferChecked") {
    return undefined;
  }
  const info = readOptionalRecord(parsed.info);
  if (info === undefined) {
    return undefined;
  }
  const tokenAmount = readOptionalRecord(info.tokenAmount);
  const amount = readOptionalString(tokenAmount?.amount) ?? readOptionalString(info.amount);
  const mint = readOptionalString(info.mint);
  const destination = readOptionalString(info.destination);
  const authority =
    readOptionalString(info.authority) ?? readOptionalString(info.owner);
  const programId = readOptionalString(record.programId);
  if (
    amount === undefined ||
    !isAtomicAmount(amount) ||
    programId === undefined ||
    !TOKEN_PROGRAM_IDS.has(programId) ||
    mint === undefined ||
    destination === undefined ||
    authority === undefined
  ) {
    return undefined;
  }
  const transfer: SolanaTokenTransfer = {
    mint,
    destination,
    authority,
    amount
  };
  const source = readOptionalString(info.source);
  transfer.programId = programId;
  if (source !== undefined) {
    transfer.source = source;
  }
  return transfer;
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

function readAccountKeys(value: unknown): string[] {
  return readArray(value, "transaction.message.accountKeys").map((item) => {
    if (typeof item === "string") {
      return item;
    }
    const record = readRecord(item);
    return readRequiredString(record.pubkey, "accountKey.pubkey");
  });
}

function readStringArray(value: unknown, label: string): string[] {
  return readArray(value, label).map((item) => readRequiredString(item, label));
}

function readArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

function readOptionalArray(value: unknown, label: string): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }
  return readArray(value, label);
}

function readRecord(value: unknown): Record<string, unknown> {
  const record = readOptionalRecord(value);
  if (record === undefined) {
    throw new Error("expected object");
  }
  return record;
}

function readOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function readInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer`);
  }
  return value as number;
}

function readRequiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function maxAtomicAmount(left: string, right: string | undefined): string {
  if (right === undefined) {
    return left;
  }
  return BigInt(left) >= BigInt(right) ? left : right;
}

function isAtomicAmount(value: string): boolean {
  return /^(0|[1-9][0-9]*)$/u.test(value);
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
