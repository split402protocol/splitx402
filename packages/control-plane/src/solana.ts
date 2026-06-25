import { address } from "@solana/kit";
import { findAssociatedTokenPda } from "@solana-program/token";
import { hashProtocolObject, type Split402ReceiptV1 } from "@split402/protocol";

import type {
  ReceiptChainVerificationResult,
  ReceiptChainVerifier
} from "./workers.js";
import type { PayoutBatchRecord, PayoutItemRecord } from "./payouts.js";

export type SolanaRpcCommitment = "confirmed" | "finalized";
export const SOLANA_TOKEN_PROGRAM_ID =
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const SOLANA_TOKEN_2022_PROGRAM_ID =
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export interface SolanaRpcReceiptVerifierOptions {
  rpcUrl?: string;
  rpcUrls?: string[];
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

export interface CreateSolanaPayoutTransactionPlanInput {
  batch: PayoutBatchRecord;
  fundingWallet: string;
  tokenDecimals: number;
  tokenProgramId?: string;
  sourceTokenAccount?: string;
  maxItemsPerTransaction?: number;
}

export interface SolanaPayoutTransactionPlan {
  batchId: string;
  network: string;
  asset: string;
  tokenProgramId: string;
  tokenDecimals: number;
  fundingWallet: string;
  sourceTokenAccount: string;
  totalAmountAtomic: string;
  itemCount: number;
  transactionCount: number;
  transactions: SolanaPayoutPlannedTransaction[];
}

export interface SolanaPayoutPlannedTransaction {
  index: number;
  items: SolanaPayoutPlannedItem[];
  instructions: SolanaPayoutInstructionPlan[];
}

export interface SolanaPayoutPlannedItem {
  payoutItemId: string;
  destinationWallet: string;
  destinationTokenAccount: string;
  amountAtomic: string;
  createAssociatedTokenAccount: boolean;
}

export type SolanaPayoutInstructionPlan =
  | SolanaCreateAssociatedTokenInstructionPlan
  | SolanaTransferCheckedInstructionPlan;

export interface SolanaCreateAssociatedTokenInstructionPlan {
  kind: "createAssociatedTokenIdempotent";
  programId: string;
  payer: string;
  associatedTokenAccount: string;
  owner: string;
  mint: string;
  tokenProgramId: string;
}

export interface SolanaTransferCheckedInstructionPlan {
  kind: "transferChecked";
  programId: string;
  source: string;
  mint: string;
  destination: string;
  authority: string;
  amountAtomic: string;
  decimals: number;
  payoutItemId: string;
}

export interface SolanaRpcPayoutTransactionSimulatorOptions {
  rpcUrl?: string;
  rpcUrls?: string[];
  network: string;
  commitment?: SolanaRpcCommitment;
  fetch?: SolanaRpcFetch;
  sigVerify?: boolean;
  replaceRecentBlockhash?: boolean;
}

export interface SimulateSolanaPayoutTransactionPlanInput {
  plan: SolanaPayoutTransactionPlan;
  transactions: readonly SolanaSerializedPayoutTransaction[];
}

export interface SolanaSerializedPayoutTransaction {
  index: number;
  transactionBase64: string;
}

export type SolanaPayoutSimulationStatus = "succeeded" | "failed" | "retry";

export interface SolanaPayoutSimulationReport {
  batchId: string;
  network: string;
  status: SolanaPayoutSimulationStatus;
  transactionResults: SolanaPayoutSimulationTransactionResult[];
}

export interface SolanaPayoutSimulationTransactionResult {
  index: number;
  status: SolanaPayoutSimulationStatus;
  rpcUrl?: string;
  error?: string;
  logs?: string[];
  unitsConsumed?: number;
}

export interface SolanaPayoutSignerPolicy {
  network: string;
  signerReference: string;
  fundingWallet: string;
  sourceTokenAccount: string;
  mint: string;
  allowedTokenProgramIds?: readonly string[];
  maxTransactionAmountAtomic?: string;
  maxBatchAmountAtomic?: string;
  requireSuccessfulSimulation?: boolean;
  expectedDestinationAmountListHash?: `sha256:${string}`;
}

export interface SignSolanaPayoutTransactionsInput {
  plan: SolanaPayoutTransactionPlan;
  transactions: readonly SolanaSerializedPayoutTransaction[];
  simulationReport?: SolanaPayoutSimulationReport;
}

export interface SolanaPayoutTransactionSigner {
  sign(
    input: SignSolanaPayoutTransactionsInput
  ): Promise<SolanaPayoutSigningReport> | SolanaPayoutSigningReport;
}

export interface SolanaPayoutSigningReport {
  batchId: string;
  network: string;
  signerReference: string;
  destinationAmountListHash: `sha256:${string}`;
  signedTransactions: SolanaSignedPayoutTransaction[];
}

export interface SolanaSignedPayoutTransaction {
  index: number;
  signedTransactionBase64: string;
  expectedSignature?: string;
}

export type SolanaPayoutTransactionSigningDelegate = (
  input: SolanaPayoutTransactionSigningDelegateInput
) =>
  | Promise<SolanaPayoutTransactionSigningDelegateResult>
  | SolanaPayoutTransactionSigningDelegateResult;

export interface SolanaPayoutTransactionSigningDelegateInput {
  batchId: string;
  network: string;
  signerReference: string;
  destinationAmountListHash: `sha256:${string}`;
  plannedTransaction: SolanaPayoutPlannedTransaction;
  transactionBase64: string;
  amountAtomic: string;
}

export interface SolanaPayoutTransactionSigningDelegateResult {
  signedTransactionBase64: string;
  expectedSignature?: string;
}

export interface SolanaPolicyEnforcedPayoutSignerOptions {
  policy: SolanaPayoutSignerPolicy;
  signTransaction: SolanaPayoutTransactionSigningDelegate;
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

const ASSOCIATED_TOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const TOKEN_PROGRAM_IDS = new Set([
  SOLANA_TOKEN_PROGRAM_ID,
  SOLANA_TOKEN_2022_PROGRAM_ID
]);

export async function createSolanaPayoutTransactionPlan(
  input: CreateSolanaPayoutTransactionPlanInput
): Promise<SolanaPayoutTransactionPlan> {
  const tokenProgramId = input.tokenProgramId ?? SOLANA_TOKEN_PROGRAM_ID;
  assertSupportedTokenProgramId(tokenProgramId);
  const tokenDecimals = assertTokenDecimals(input.tokenDecimals);
  const fundingWallet = assertSolanaAddress(input.fundingWallet, "fundingWallet");
  const asset = assertSolanaAddress(input.batch.asset, "batch.asset");
  if (!input.batch.network.startsWith("solana:")) {
    throw new Error("payout batch network must be a Solana network");
  }
  if (input.batch.status !== "planned") {
    throw new Error("payout batch must be planned before transaction planning");
  }

  const maxItemsPerTransaction =
    input.maxItemsPerTransaction === undefined
      ? input.batch.items.length
      : assertPositiveInteger(
          input.maxItemsPerTransaction,
          "maxItemsPerTransaction"
        );
  if (maxItemsPerTransaction <= 0) {
    throw new Error("payout batch must contain at least one item");
  }
  const sourceTokenAccount =
    input.sourceTokenAccount === undefined
      ? await deriveAssociatedTokenAccount({
          owner: fundingWallet,
          mint: asset,
          tokenProgramId
        })
      : assertSolanaAddress(input.sourceTokenAccount, "sourceTokenAccount");

  const plannedItems = await Promise.all(
    input.batch.items.map((item) =>
      planSolanaPayoutItem({
        item,
        asset,
        tokenProgramId
      })
    )
  );
  const totalAmount = plannedItems.reduce(
    (total, item) => total + BigInt(item.amountAtomic),
    0n
  );
  if (totalAmount.toString() !== input.batch.totalAmountAtomic) {
    throw new Error("payout batch total does not match planned item total");
  }

  const transactions = chunkItems(plannedItems, maxItemsPerTransaction).map(
    (items, index) => ({
      index,
      items,
      instructions: items.flatMap((item) =>
        createSolanaPayoutInstructions({
          item,
          asset,
          fundingWallet,
          sourceTokenAccount,
          tokenDecimals,
          tokenProgramId
        })
      )
    })
  );

  return {
    batchId: input.batch.id,
    network: input.batch.network,
    asset,
    tokenProgramId,
    tokenDecimals,
    fundingWallet,
    sourceTokenAccount,
    totalAmountAtomic: totalAmount.toString(),
    itemCount: plannedItems.length,
    transactionCount: transactions.length,
    transactions
  };
}

export class SolanaRpcPayoutTransactionSimulator {
  constructor(private readonly options: SolanaRpcPayoutTransactionSimulatorOptions) {}

  async simulate(
    input: SimulateSolanaPayoutTransactionPlanInput
  ): Promise<SolanaPayoutSimulationReport> {
    if (input.plan.network !== this.options.network) {
      throw new Error(
        `payout plan network ${input.plan.network} does not match simulator network ${this.options.network}`
      );
    }
    const serializedTransactions = readSerializedPayoutTransactions(input);
    const transactionResults: SolanaPayoutSimulationTransactionResult[] = [];
    for (const plannedTransaction of input.plan.transactions) {
      const transactionBase64 = serializedTransactions.get(plannedTransaction.index);
      if (transactionBase64 === undefined) {
        throw new Error(
          `missing serialized transaction for payout plan index ${plannedTransaction.index}`
        );
      }
      transactionResults.push(
        await this.simulateWithFailover(
          plannedTransaction.index,
          transactionBase64
        )
      );
    }

    return {
      batchId: input.plan.batchId,
      network: input.plan.network,
      status: summarizeSimulationStatus(transactionResults),
      transactionResults
    };
  }

  private async simulateWithFailover(
    index: number,
    transactionBase64: string
  ): Promise<SolanaPayoutSimulationTransactionResult> {
    let lastRetry: SolanaPayoutSimulationTransactionResult | undefined;
    for (const rpcUrl of this.rpcUrls()) {
      const result = await this.simulateWithRpcUrl(
        rpcUrl,
        index,
        transactionBase64
      );
      if (result.status !== "retry") {
        return result;
      }
      lastRetry = result;
    }
    return (
      lastRetry ?? {
        index,
        status: "retry",
        error: "no Solana RPC URLs configured"
      }
    );
  }

  private async simulateWithRpcUrl(
    rpcUrl: string,
    index: number,
    transactionBase64: string
  ): Promise<SolanaPayoutSimulationTransactionResult> {
    let response: SolanaRpcHttpResponse;
    try {
      response = await this.fetch()(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: `split402-payout-simulation-${index}`,
          method: "simulateTransaction",
          params: [
            transactionBase64,
            {
              commitment: this.commitment(),
              encoding: "base64",
              replaceRecentBlockhash: this.replaceRecentBlockhash(),
              sigVerify: this.sigVerify()
            }
          ]
        })
      });
    } catch (error) {
      return {
        index,
        status: "retry",
        rpcUrl,
        error: `Solana RPC request failed: ${readErrorMessage(error)}`
      };
    }

    if (!response.ok) {
      return {
        index,
        status: "retry",
        rpcUrl,
        error: `Solana RPC returned HTTP ${response.status}`
      };
    }

    try {
      const body = await response.json();
      const rpcError = readRpcError(body);
      if (rpcError !== undefined) {
        return {
          index,
          status: "retry",
          rpcUrl,
          error: `Solana RPC returned error: ${rpcError}`
        };
      }

      return readPayoutSimulationTransactionResult(index, rpcUrl, body);
    } catch (error) {
      return {
        index,
        status: "retry",
        rpcUrl,
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

  private replaceRecentBlockhash(): boolean {
    return this.options.replaceRecentBlockhash ?? true;
  }

  private sigVerify(): boolean {
    return this.options.sigVerify ?? false;
  }

  private rpcUrls(): string[] {
    const urls = [
      ...(this.options.rpcUrl === undefined ? [] : [this.options.rpcUrl]),
      ...(this.options.rpcUrls ?? [])
    ];
    return Array.from(
      new Set(urls.map((url) => url.trim()).filter((url) => url.length > 0))
    );
  }
}

export class SolanaPolicyEnforcedPayoutSigner
  implements SolanaPayoutTransactionSigner {
  constructor(private readonly options: SolanaPolicyEnforcedPayoutSignerOptions) {}

  async sign(
    input: SignSolanaPayoutTransactionsInput
  ): Promise<SolanaPayoutSigningReport> {
    const serializedTransactions = readSerializedPayoutTransactions(input);
    const destinationAmountListHash =
      hashSolanaPayoutDestinationAmountList(input.plan);
    assertPayoutSignerPolicy({
      plan: input.plan,
      policy: this.options.policy,
      destinationAmountListHash,
      simulationReport: input.simulationReport
    });

    const signedTransactions: SolanaSignedPayoutTransaction[] = [];
    for (const plannedTransaction of input.plan.transactions) {
      const transactionBase64 = serializedTransactions.get(plannedTransaction.index);
      if (transactionBase64 === undefined) {
        throw new Error(
          `missing serialized transaction for payout plan index ${plannedTransaction.index}`
        );
      }
      const signed = await this.options.signTransaction({
        batchId: input.plan.batchId,
        network: input.plan.network,
        signerReference: this.options.policy.signerReference,
        destinationAmountListHash,
        plannedTransaction,
        transactionBase64,
        amountAtomic: sumPlannedTransactionAmount(plannedTransaction).toString()
      });
      signedTransactions.push({
        index: plannedTransaction.index,
        signedTransactionBase64: assertBase64Transaction(
          signed.signedTransactionBase64,
          `signed transaction ${plannedTransaction.index}`
        ),
        ...(signed.expectedSignature === undefined
          ? {}
          : {
              expectedSignature: assertNonEmptyString(
                signed.expectedSignature,
                `signed transaction ${plannedTransaction.index} expectedSignature`
              )
            })
      });
    }

    return {
      batchId: input.plan.batchId,
      network: input.plan.network,
      signerReference: this.options.policy.signerReference,
      destinationAmountListHash,
      signedTransactions
    };
  }
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

    let lastRetry:
      | Extract<ReceiptChainVerificationResult, { status: "retry" }>
      | undefined;
    let lastRejected:
      | Extract<ReceiptChainVerificationResult, { status: "rejected" }>
      | undefined;
    for (const rpcUrl of this.rpcUrls()) {
      const result = await this.verifyWithRpcUrl(receipt, rpcUrl);
      if (result.status === "confirmed") {
        return result;
      }
      if (result.status === "rejected") {
        lastRejected = result;
      } else {
        lastRetry = result;
      }
    }

    return (
      lastRetry ??
      lastRejected ?? {
        status: "retry",
        error: "no Solana RPC URLs configured"
      }
    );
  }

  private async verifyWithRpcUrl(
    receipt: Split402ReceiptV1,
    rpcUrl: string
  ): Promise<ReceiptChainVerificationResult> {
    const rpcResponse = await this.requestSignatureStatus(
      rpcUrl,
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
      rpcUrl,
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

    const transactionVerification = await verifyReceiptTransaction(
      receipt,
      transaction
    );
    if (transactionVerification !== undefined) {
      return transactionVerification;
    }

    return { status: "confirmed" };
  }

  private async requestSignatureStatus(
    rpcUrl: string,
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
      response = await this.fetch()(rpcUrl, {
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
    rpcUrl: string,
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
      response = await this.fetch()(rpcUrl, {
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

  private rpcUrls(): string[] {
    const urls = [
      ...(this.options.rpcUrl === undefined ? [] : [this.options.rpcUrl]),
      ...(this.options.rpcUrls ?? [])
    ];
    return Array.from(
      new Set(urls.map((url) => url.trim()).filter((url) => url.length > 0))
    );
  }
}

async function planSolanaPayoutItem(input: {
  item: PayoutItemRecord;
  asset: string;
  tokenProgramId: string;
}): Promise<SolanaPayoutPlannedItem> {
  if (input.item.status !== "allocated") {
    throw new Error(`payout item ${input.item.id} must be allocated`);
  }
  const destinationWallet = assertSolanaAddress(
    input.item.destinationWallet,
    `payout item ${input.item.id} destinationWallet`
  );
  const destinationTokenAccount =
    input.item.destinationTokenAccount === undefined
      ? await deriveAssociatedTokenAccount({
          owner: destinationWallet,
          mint: input.asset,
          tokenProgramId: input.tokenProgramId
        })
      : assertSolanaAddress(
          input.item.destinationTokenAccount,
          `payout item ${input.item.id} destinationTokenAccount`
        );
  assertPositiveAtomicAmount(
    input.item.amountAtomic,
    `payout item ${input.item.id} amountAtomic`
  );
  return {
    payoutItemId: input.item.id,
    destinationWallet,
    destinationTokenAccount,
    amountAtomic: input.item.amountAtomic,
    createAssociatedTokenAccount: input.item.destinationTokenAccount === undefined
  };
}

function createSolanaPayoutInstructions(input: {
  item: SolanaPayoutPlannedItem;
  asset: string;
  fundingWallet: string;
  sourceTokenAccount: string;
  tokenDecimals: number;
  tokenProgramId: string;
}): SolanaPayoutInstructionPlan[] {
  const instructions: SolanaPayoutInstructionPlan[] = [];
  if (input.item.createAssociatedTokenAccount) {
    instructions.push({
      kind: "createAssociatedTokenIdempotent",
      programId: ASSOCIATED_TOKEN_PROGRAM_ID,
      payer: input.fundingWallet,
      associatedTokenAccount: input.item.destinationTokenAccount,
      owner: input.item.destinationWallet,
      mint: input.asset,
      tokenProgramId: input.tokenProgramId
    });
  }
  instructions.push({
    kind: "transferChecked",
    programId: input.tokenProgramId,
    source: input.sourceTokenAccount,
    mint: input.asset,
    destination: input.item.destinationTokenAccount,
    authority: input.fundingWallet,
    amountAtomic: input.item.amountAtomic,
    decimals: input.tokenDecimals,
    payoutItemId: input.item.payoutItemId
  });
  return instructions;
}

async function deriveAssociatedTokenAccount(input: {
  owner: string;
  mint: string;
  tokenProgramId: string;
}): Promise<string> {
  const [associatedTokenAccount] = await findAssociatedTokenPda({
    owner: address(input.owner),
    tokenProgram: address(input.tokenProgramId),
    mint: address(input.mint)
  });
  return associatedTokenAccount.toString();
}

function chunkItems<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function assertSupportedTokenProgramId(value: string): string {
  const tokenProgramId = assertSolanaAddress(value, "tokenProgramId");
  if (!TOKEN_PROGRAM_IDS.has(tokenProgramId)) {
    throw new Error("tokenProgramId must be a supported SPL token program");
  }
  return tokenProgramId;
}

function assertSolanaAddress(value: string, label: string): string {
  try {
    return address(value).toString();
  } catch {
    throw new Error(`${label} must be a valid Solana address`);
  }
}

function assertTokenDecimals(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error("tokenDecimals must be an integer between 0 and 255");
  }
  return value;
}

function assertPositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function assertPositiveAtomicAmount(value: string, label: string): void {
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new Error(`${label} must be a positive atomic amount`);
  }
}

export function hashSolanaPayoutDestinationAmountList(
  plan: SolanaPayoutTransactionPlan
): `sha256:${string}` {
  return hashProtocolObject({
    schema: "split402.solana.payout.destination_amount_list.v1",
    batchId: plan.batchId,
    network: plan.network,
    asset: plan.asset,
    tokenProgramId: plan.tokenProgramId,
    sourceTokenAccount: plan.sourceTokenAccount,
    transactions: plan.transactions.map((transaction) => ({
      index: transaction.index,
      items: transaction.items.map((item) => ({
        payoutItemId: item.payoutItemId,
        destinationWallet: item.destinationWallet,
        destinationTokenAccount: item.destinationTokenAccount,
        amountAtomic: item.amountAtomic
      }))
    }))
  });
}

function assertPayoutSignerPolicy(input: {
  plan: SolanaPayoutTransactionPlan;
  policy: SolanaPayoutSignerPolicy;
  destinationAmountListHash: `sha256:${string}`;
  simulationReport: SolanaPayoutSimulationReport | undefined;
}): void {
  const network = assertNonEmptyString(input.policy.network, "policy.network");
  if (input.plan.network !== network) {
    throw new Error(
      `payout plan network ${input.plan.network} does not match signer policy network ${network}`
    );
  }
  assertNonEmptyString(input.policy.signerReference, "policy.signerReference");
  const fundingWallet = assertSolanaAddress(
    input.policy.fundingWallet,
    "policy.fundingWallet"
  );
  if (input.plan.fundingWallet !== fundingWallet) {
    throw new Error("payout signer policy fundingWallet does not match plan");
  }
  const sourceTokenAccount = assertSolanaAddress(
    input.policy.sourceTokenAccount,
    "policy.sourceTokenAccount"
  );
  if (input.plan.sourceTokenAccount !== sourceTokenAccount) {
    throw new Error("payout signer policy sourceTokenAccount does not match plan");
  }
  const mint = assertSolanaAddress(input.policy.mint, "policy.mint");
  if (input.plan.asset !== mint) {
    throw new Error("payout signer policy mint does not match plan asset");
  }

  const allowedTokenProgramIds = readAllowedTokenProgramIds(
    input.policy.allowedTokenProgramIds
  );
  if (!allowedTokenProgramIds.has(input.plan.tokenProgramId)) {
    throw new Error("payout signer policy does not allow plan token program");
  }
  if (
    input.policy.expectedDestinationAmountListHash !== undefined &&
    input.policy.expectedDestinationAmountListHash !== input.destinationAmountListHash
  ) {
    throw new Error("payout signer policy destination amount list hash mismatch");
  }

  assertPayoutSignerInstructionPolicy({
    plan: input.plan,
    allowedTokenProgramIds
  });
  assertPayoutSignerAmountLimits({
    plan: input.plan,
    maxTransactionAmountAtomic: input.policy.maxTransactionAmountAtomic,
    maxBatchAmountAtomic: input.policy.maxBatchAmountAtomic
  });
  if (input.policy.requireSuccessfulSimulation ?? true) {
    assertSuccessfulPayoutSimulation(input.plan, input.simulationReport);
  }
}

function readAllowedTokenProgramIds(
  value: readonly string[] | undefined
): Set<string> {
  if (value === undefined) {
    return new Set(TOKEN_PROGRAM_IDS);
  }
  if (value.length === 0) {
    throw new Error("policy.allowedTokenProgramIds must not be empty");
  }
  return new Set(
    value.map((tokenProgramId) =>
      assertSupportedTokenProgramId(tokenProgramId)
    )
  );
}

function assertPayoutSignerInstructionPolicy(input: {
  plan: SolanaPayoutTransactionPlan;
  allowedTokenProgramIds: Set<string>;
}): void {
  for (const transaction of input.plan.transactions) {
    for (const instruction of transaction.instructions) {
      switch (instruction.kind) {
        case "createAssociatedTokenIdempotent":
          if (instruction.programId !== ASSOCIATED_TOKEN_PROGRAM_ID) {
            throw new Error("payout signer policy rejects unsupported ATA program");
          }
          if (instruction.payer !== input.plan.fundingWallet) {
            throw new Error("payout signer policy rejects ATA payer mismatch");
          }
          if (instruction.mint !== input.plan.asset) {
            throw new Error("payout signer policy rejects ATA mint mismatch");
          }
          if (!input.allowedTokenProgramIds.has(instruction.tokenProgramId)) {
            throw new Error("payout signer policy rejects ATA token program");
          }
          break;
        case "transferChecked":
          if (!input.allowedTokenProgramIds.has(instruction.programId)) {
            throw new Error("payout signer policy rejects transfer token program");
          }
          if (instruction.source !== input.plan.sourceTokenAccount) {
            throw new Error("payout signer policy rejects transfer source");
          }
          if (instruction.authority !== input.plan.fundingWallet) {
            throw new Error("payout signer policy rejects transfer authority");
          }
          if (instruction.mint !== input.plan.asset) {
            throw new Error("payout signer policy rejects transfer mint");
          }
          if (instruction.decimals !== input.plan.tokenDecimals) {
            throw new Error("payout signer policy rejects transfer decimals");
          }
          assertPositiveAtomicAmount(
            instruction.amountAtomic,
            `payout transaction ${transaction.index} transfer amountAtomic`
          );
          break;
      }
    }
  }
}

function assertPayoutSignerAmountLimits(input: {
  plan: SolanaPayoutTransactionPlan;
  maxTransactionAmountAtomic: string | undefined;
  maxBatchAmountAtomic: string | undefined;
}): void {
  const maxTransactionAmount = readOptionalAtomicLimit(
    input.maxTransactionAmountAtomic,
    "policy.maxTransactionAmountAtomic"
  );
  const maxBatchAmount = readOptionalAtomicLimit(
    input.maxBatchAmountAtomic,
    "policy.maxBatchAmountAtomic"
  );
  const batchAmount = BigInt(input.plan.totalAmountAtomic);
  if (maxBatchAmount !== undefined && batchAmount > maxBatchAmount) {
    throw new Error("payout batch amount exceeds signer maxBatchAmountAtomic");
  }
  if (maxTransactionAmount === undefined) {
    return;
  }
  for (const transaction of input.plan.transactions) {
    if (sumPlannedTransactionAmount(transaction) > maxTransactionAmount) {
      throw new Error(
        `payout transaction ${transaction.index} amount exceeds signer maxTransactionAmountAtomic`
      );
    }
  }
}

function readOptionalAtomicLimit(
  value: string | undefined,
  label: string
): bigint | undefined {
  if (value === undefined) {
    return undefined;
  }
  assertPositiveAtomicAmount(value, label);
  return BigInt(value);
}

function sumPlannedTransactionAmount(
  transaction: SolanaPayoutPlannedTransaction
): bigint {
  return transaction.items.reduce(
    (total, item) => total + BigInt(item.amountAtomic),
    0n
  );
}

function assertSuccessfulPayoutSimulation(
  plan: SolanaPayoutTransactionPlan,
  report: SolanaPayoutSimulationReport | undefined
): void {
  if (report === undefined) {
    throw new Error("successful payout simulation is required before signing");
  }
  if (report.batchId !== plan.batchId || report.network !== plan.network) {
    throw new Error("payout simulation report does not match plan");
  }
  if (report.status !== "succeeded") {
    throw new Error("successful payout simulation is required before signing");
  }
  const resultsByIndex = new Map(
    report.transactionResults.map((result) => [result.index, result])
  );
  for (const transaction of plan.transactions) {
    const result = resultsByIndex.get(transaction.index);
    if (result?.status !== "succeeded") {
      throw new Error(
        `successful payout simulation is required for transaction ${transaction.index}`
      );
    }
  }
  if (resultsByIndex.size !== plan.transactions.length) {
    throw new Error("payout simulation report must cover every planned transaction");
  }
}

function readSerializedPayoutTransactions(
  input: SimulateSolanaPayoutTransactionPlanInput
): Map<number, string> {
  const expectedIndexes = new Set(
    input.plan.transactions.map((transaction) => transaction.index)
  );
  const serializedTransactions = new Map<number, string>();
  for (const transaction of input.transactions) {
    if (!expectedIndexes.has(transaction.index)) {
      throw new Error(
        `serialized transaction index ${transaction.index} is not in payout plan`
      );
    }
    if (serializedTransactions.has(transaction.index)) {
      throw new Error(
        `duplicate serialized transaction for payout plan index ${transaction.index}`
      );
    }
    serializedTransactions.set(
      transaction.index,
      assertBase64Transaction(
        transaction.transactionBase64,
        `serialized transaction ${transaction.index}`
      )
    );
  }
  if (serializedTransactions.size !== input.plan.transactions.length) {
    throw new Error("serialized transactions must cover every planned transaction");
  }
  return serializedTransactions;
}

function assertBase64Transaction(value: string, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)
  ) {
    throw new Error(`${label} must be a base64 serialized transaction`);
  }
  return value;
}

function readPayoutSimulationTransactionResult(
  index: number,
  rpcUrl: string,
  body: unknown
): SolanaPayoutSimulationTransactionResult {
  const result = readRecord(readRecord(body).result);
  const value = readRecord(result.value);
  const err = value.err;
  if (err === undefined) {
    throw new Error("simulation.value.err is required");
  }
  const logs = readOptionalStringArray(value.logs, "simulation.value.logs");
  const unitsConsumed = readOptionalInteger(
    value.unitsConsumed,
    "simulation.value.unitsConsumed"
  );
  return {
    index,
    status: err === null ? "succeeded" : "failed",
    rpcUrl,
    ...(err === null ? {} : { error: JSON.stringify(err) }),
    ...(logs === undefined ? {} : { logs }),
    ...(unitsConsumed === undefined ? {} : { unitsConsumed })
  };
}

function summarizeSimulationStatus(
  results: readonly SolanaPayoutSimulationTransactionResult[]
): SolanaPayoutSimulationStatus {
  if (results.some((result) => result.status === "failed")) {
    return "failed";
  }
  if (results.some((result) => result.status === "retry")) {
    return "retry";
  }
  return "succeeded";
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

async function verifyReceiptTransaction(
  receipt: Split402ReceiptV1,
  transaction: SolanaConfirmedTransaction
): Promise<ReceiptChainVerificationResult | undefined> {
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
  for (const transfer of transaction.transfers) {
    if (
      await transferSatisfiesReceipt(
        transfer,
        receipt,
        requiredAmount,
        transaction.tokenAccounts
      )
    ) {
      return undefined;
    }
  }

  return {
    status: "rejected",
    error:
      "settlement transaction does not contain a matching token transfer for receipt asset, payTo wallet, payer wallet, and amount"
  };
}

async function transferSatisfiesReceipt(
  transfer: SolanaTokenTransfer,
  receipt: Split402ReceiptV1,
  requiredAmount: string,
  tokenAccounts: Map<string, SolanaTokenAccountEvidence>
): Promise<boolean> {
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
  const destinationProgramMatches =
    destination?.programId === undefined || destination.programId === transfer.programId;
  const destinationMintMatches =
    destination === undefined || destination.mint === receipt.asset;
  const destinationOwnerMatches = destination?.owner === receipt.payToWallet;
  const destinationIsAssociatedTokenAccount = await isAssociatedTokenAccount({
    account: transfer.destination,
    owner: receipt.payToWallet,
    mint: receipt.asset,
    tokenProgramId: transfer.programId
  });
  return (
    destinationMintMatches &&
    destinationProgramMatches &&
    (destinationOwnerMatches || destinationIsAssociatedTokenAccount)
  );
}

async function isAssociatedTokenAccount(input: {
  account: string;
  owner: string;
  mint: string;
  tokenProgramId: string | undefined;
}): Promise<boolean> {
  if (input.tokenProgramId === undefined || !TOKEN_PROGRAM_IDS.has(input.tokenProgramId)) {
    return false;
  }
  try {
    const [associatedTokenAccount] = await findAssociatedTokenPda({
      owner: address(input.owner),
      tokenProgram: address(input.tokenProgramId),
      mint: address(input.mint)
    });
    return input.account === associatedTokenAccount.toString();
  } catch {
    return false;
  }
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

function readOptionalStringArray(
  value: unknown,
  label: string
): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return readStringArray(value, label);
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

function readOptionalInteger(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return readInteger(value, label);
}

function assertNonEmptyString(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
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
