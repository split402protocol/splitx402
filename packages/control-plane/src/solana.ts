import {
  address,
  createKeyPairSignerFromBytes,
  createKeyPairSignerFromPrivateKeyBytes,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  getTransactionDecoder,
  signTransaction
} from "@solana/kit";
import { findAssociatedTokenPda } from "@solana-program/token";
import {
  base58Encode,
  hashProtocolObject,
  type Split402ReceiptV1
} from "@split402/protocol";
import { Buffer } from "node:buffer";
import { createHmac } from "node:crypto";

import type {
  ReceiptChainVerificationResult,
  ReceiptChainVerifier
} from "./workers.js";
import type {
  PayoutFinalizedTransferVerifier,
  PayoutFinalizedTransferVerificationResult,
  PayoutFundingBalance,
  PayoutBatchRecord,
  PayoutItemRecord,
  PayoutTransactionRecord
} from "./payouts.js";
import type { MerchantPayoutWalletRecord } from "./merchants.js";

type LocalDevSolanaKeyPair = Awaited<
  ReturnType<typeof createKeyPairSignerFromPrivateKeyBytes>
>["keyPair"];

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

export interface SolanaRpcMerchantFundingBalanceProviderOptions {
  rpcUrl?: string;
  rpcUrls?: string[];
  commitment?: SolanaRpcCommitment;
  fetch?: SolanaRpcFetch;
  tokenProgramId?: string;
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

export class SolanaRpcMerchantFundingBalanceProvider {
  constructor(
    private readonly options: SolanaRpcMerchantFundingBalanceProviderOptions
  ) {}

  async getMerchantFundingBalances(input: {
    merchantId: string;
    payoutWallets: readonly MerchantPayoutWalletRecord[];
  }): Promise<PayoutFundingBalance[]> {
    const balances: PayoutFundingBalance[] = [];
    for (const wallet of input.payoutWallets) {
      if (!wallet.network.startsWith("solana:")) {
        continue;
      }
      const sourceTokenAccount = await deriveAssociatedTokenAccount({
        owner: wallet.wallet,
        mint: wallet.asset,
        tokenProgramId: this.options.tokenProgramId ?? SOLANA_TOKEN_PROGRAM_ID
      });
      const amountAtomic = await this.getTokenAccountBalance(sourceTokenAccount);
      balances.push({
        asset: wallet.asset,
        amountAtomic,
        fundingWallet: wallet.wallet
      });
    }
    return balances;
  }

  private async getTokenAccountBalance(tokenAccount: string): Promise<string> {
    let lastError: unknown;
    for (const rpcUrl of this.rpcUrls()) {
      try {
        const response = await this.fetch()(rpcUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "split402-funding-balance",
            method: "getTokenAccountBalance",
            params: [
              tokenAccount,
              {
                commitment: this.options.commitment ?? "confirmed"
              }
            ]
          })
        });
        if (!response.ok) {
          lastError = new Error(`Solana RPC returned HTTP ${response.status}`);
          continue;
        }
        const body = await response.json();
        const rpcError = readRpcError(body);
        if (rpcError !== undefined) {
          if (rpcError.includes("could not find account")) {
            return "0";
          }
          lastError = new Error(`Solana RPC returned error: ${rpcError}`);
          continue;
        }
        return readTokenAccountBalanceAmount(body);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("Solana RPC funding balance lookup failed");
  }

  private fetch(): SolanaRpcFetch {
    return this.options.fetch ?? fetch;
  }

  private rpcUrls(): string[] {
    const urls = [
      ...(this.options.rpcUrl === undefined ? [] : [this.options.rpcUrl]),
      ...(this.options.rpcUrls ?? [])
    ];
    if (urls.length === 0) {
      throw new Error("Solana RPC URL is required");
    }
    return urls;
  }
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

export interface VerifySolanaPayoutTransactionBytesInput {
  transactionBase64: string;
  plannedTransaction: SolanaPayoutPlannedTransaction;
  policy: SolanaPayoutSignerPolicy;
}

export interface VerifySolanaPayoutTransactionBytesResult {
  ok: boolean;
  errors: string[];
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

export interface LocalDevSolanaPayoutSignerOptions {
  signerReference: string;
  expectedAddress?: string;
  secretKeyBytes?: Uint8Array | readonly number[];
  privateKeyBytes?: Uint8Array | readonly number[];
  secretKeyJson?: string;
  secretKeyBase64?: string;
  privateKeyBase64?: string;
}

export interface CreateLocalDevSolanaPayoutSignerInput
  extends LocalDevSolanaPayoutSignerOptions {
  policy: SolanaPayoutSignerPolicy;
}

export interface CreateLocalDevSolanaPayoutSignerFromEnvInput {
  policy: SolanaPayoutSignerPolicy;
  env?: NodeJS.ProcessEnv;
}

export type RemoteSolanaPayoutSignerFetch = (
  input: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  }
) => Promise<SolanaRpcHttpResponse>;

export interface RemoteSolanaPayoutSignerOptions {
  signerReference: string;
  endpointUrl: string;
  keyId?: string;
  sharedSecret?: string;
  timeoutMs?: number;
  fetch?: RemoteSolanaPayoutSignerFetch;
  now?: () => Date;
}

export interface CreateRemoteSolanaPayoutSignerInput
  extends RemoteSolanaPayoutSignerOptions {
  policy: SolanaPayoutSignerPolicy;
}

export interface CreateRemoteSolanaPayoutSignerFromEnvInput {
  policy: SolanaPayoutSignerPolicy;
  env?: NodeJS.ProcessEnv;
  fetch?: RemoteSolanaPayoutSignerFetch;
  now?: () => Date;
}

export interface SolanaRpcPayoutTransactionBroadcasterOptions {
  rpcUrl?: string;
  rpcUrls?: string[];
  network: string;
  commitment?: SolanaRpcCommitment;
  fetch?: SolanaRpcFetch;
  skipPreflight?: boolean;
  maxRetries?: number;
}

export interface BroadcastSolanaPayoutTransactionInput {
  transaction: PayoutTransactionRecord;
}

export type SolanaPayoutBroadcastStatus = "submitted" | "retry";

export interface SolanaPayoutBroadcastResult {
  transactionId: string;
  status: SolanaPayoutBroadcastStatus;
  rpcUrl?: string;
  signature?: string;
  error?: string;
}

export interface SolanaRpcPayoutTransactionFinalityMonitorOptions {
  rpcUrl?: string;
  rpcUrls?: string[];
  network: string;
  fetch?: SolanaRpcFetch;
  retryDelayMs?: number;
  unknownOutcomeAfterMs?: number;
  now?: () => Date;
}

export interface SolanaRpcPayoutFinalizedTransferVerifierOptions {
  rpcUrl?: string;
  rpcUrls?: string[];
  network: string;
  fundingWallet: string;
  sourceTokenAccount: string;
  tokenProgramId?: string;
  fetch?: SolanaRpcFetch;
}

export interface MonitorSolanaPayoutTransactionInput {
  transaction: PayoutTransactionRecord;
}

export type SolanaPayoutFinalityStatus =
  | "confirmed"
  | "finalized"
  | "failed"
  | "expired"
  | "outcome_unknown"
  | "retry";

export interface SolanaPayoutFinalityResult {
  transactionId: string;
  status: SolanaPayoutFinalityStatus;
  signature?: string;
  rpcUrl?: string;
  error?: string;
  confirmationStatus?: SolanaSignatureConfirmationStatus;
  confirmations?: number | null;
  retryAt?: string;
}

export type SolanaSignatureConfirmationStatus =
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
      assertSolanaPayoutTransactionBytesMatchPlan({
        transactionBase64,
        plannedTransaction,
        policy: policyFromPayoutPlan(input.plan)
      });
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

export async function createLocalDevSolanaPayoutSigner(
  input: CreateLocalDevSolanaPayoutSignerInput
): Promise<SolanaPolicyEnforcedPayoutSigner> {
  const signerReference = assertLocalDevSignerReference(input.signerReference);
  if (input.policy.signerReference !== signerReference) {
    throw new Error("local-dev signer reference does not match policy");
  }
  const signer = await createLocalDevSigner(input);
  const expectedAddress = assertSolanaAddress(
    input.expectedAddress ?? input.policy.fundingWallet,
    "expectedAddress"
  );
  if (signer.address !== expectedAddress) {
    throw new Error("local-dev signer address does not match expectedAddress");
  }
  return new SolanaPolicyEnforcedPayoutSigner({
    policy: input.policy,
    signTransaction: createLocalDevSolanaPayoutSigningDelegate({
      signerReference,
      keyPair: signer.keyPair,
      policy: input.policy
    })
  });
}

export async function createLocalDevSolanaPayoutSignerFromEnv(
  input: CreateLocalDevSolanaPayoutSignerFromEnvInput
): Promise<SolanaPolicyEnforcedPayoutSigner> {
  const env = input.env ?? process.env;
  return createLocalDevSolanaPayoutSigner({
    policy: input.policy,
    signerReference:
      env.SPLIT402_PAYOUT_SIGNER_REF ?? input.policy.signerReference,
    expectedAddress:
      env.SPLIT402_PAYOUT_SIGNER_EXPECTED_ADDRESS ?? input.policy.fundingWallet,
    ...(env.SPLIT402_PAYOUT_SIGNER_SECRET_KEY_JSON === undefined
      ? {}
      : { secretKeyJson: env.SPLIT402_PAYOUT_SIGNER_SECRET_KEY_JSON }),
    ...(env.SPLIT402_PAYOUT_SIGNER_SECRET_KEY_BASE64 === undefined
      ? {}
      : { secretKeyBase64: env.SPLIT402_PAYOUT_SIGNER_SECRET_KEY_BASE64 }),
    ...(env.SPLIT402_PAYOUT_SIGNER_PRIVATE_KEY_BASE64 === undefined
      ? {}
      : { privateKeyBase64: env.SPLIT402_PAYOUT_SIGNER_PRIVATE_KEY_BASE64 })
  });
}

export function createRemoteSolanaPayoutSigner(
  input: CreateRemoteSolanaPayoutSignerInput
): SolanaPolicyEnforcedPayoutSigner {
  const signerReference = assertRemoteSignerReference(input.signerReference);
  if (input.policy.signerReference !== signerReference) {
    throw new Error("remote signer reference does not match policy");
  }
  const endpointUrl = assertHttpUrl(input.endpointUrl, "endpointUrl");
  const timeoutMs =
    input.timeoutMs === undefined
      ? 5_000
      : assertPositiveInteger(input.timeoutMs, "timeoutMs");
  return new SolanaPolicyEnforcedPayoutSigner({
    policy: input.policy,
    signTransaction: createRemoteSolanaPayoutSigningDelegate({
      signerReference,
      endpointUrl,
      ...(input.keyId === undefined
        ? {}
        : { keyId: assertNonEmptyString(input.keyId, "keyId") }),
      ...(input.sharedSecret === undefined
        ? {}
        : {
            sharedSecret: assertNonEmptyString(
              input.sharedSecret,
              "sharedSecret"
            )
          }),
      timeoutMs,
      ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
      ...(input.now === undefined ? {} : { now: input.now }),
      policy: input.policy
    })
  });
}

export function createRemoteSolanaPayoutSignerFromEnv(
  input: CreateRemoteSolanaPayoutSignerFromEnvInput
): SolanaPolicyEnforcedPayoutSigner {
  const env = input.env ?? process.env;
  const timeoutMs = readOptionalIntegerEnv(
    env.SPLIT402_REMOTE_PAYOUT_SIGNER_TIMEOUT_MS,
    "SPLIT402_REMOTE_PAYOUT_SIGNER_TIMEOUT_MS"
  );
  return createRemoteSolanaPayoutSigner({
    policy: input.policy,
    signerReference:
      env.SPLIT402_REMOTE_PAYOUT_SIGNER_REF ?? input.policy.signerReference,
    endpointUrl: env.SPLIT402_REMOTE_PAYOUT_SIGNER_URL ?? "",
    ...(env.SPLIT402_REMOTE_PAYOUT_SIGNER_KEY_ID === undefined
      ? {}
      : { keyId: env.SPLIT402_REMOTE_PAYOUT_SIGNER_KEY_ID }),
    ...(env.SPLIT402_REMOTE_PAYOUT_SIGNER_SHARED_SECRET === undefined
      ? {}
      : { sharedSecret: env.SPLIT402_REMOTE_PAYOUT_SIGNER_SHARED_SECRET }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
    ...(input.now === undefined ? {} : { now: input.now })
  });
}

function createLocalDevSolanaPayoutSigningDelegate(input: {
  signerReference: string;
  keyPair: LocalDevSolanaKeyPair;
  policy: SolanaPayoutSignerPolicy;
}): SolanaPayoutTransactionSigningDelegate {
  return async (transactionInput) => {
    if (transactionInput.signerReference !== input.signerReference) {
      throw new Error("local-dev signer received an unexpected signerReference");
    }
    assertSolanaPayoutTransactionBytesMatchPlan({
      transactionBase64: transactionInput.transactionBase64,
      plannedTransaction: transactionInput.plannedTransaction,
      policy: input.policy
    });
    const transactionBytes = Buffer.from(
      assertBase64Transaction(
        transactionInput.transactionBase64,
        "transactionBase64"
      ),
      "base64"
    );
    const transaction = getTransactionDecoder().decode(transactionBytes);
    const signed = await signTransaction([input.keyPair], transaction);
    return {
      signedTransactionBase64: getBase64EncodedWireTransaction(signed),
      expectedSignature: getSignatureFromTransaction(signed)
    };
  };
}

function createRemoteSolanaPayoutSigningDelegate(input: {
  signerReference: string;
  endpointUrl: string;
  keyId?: string;
  sharedSecret?: string;
  timeoutMs: number;
  fetch?: RemoteSolanaPayoutSignerFetch;
  now?: () => Date;
  policy: SolanaPayoutSignerPolicy;
}): SolanaPayoutTransactionSigningDelegate {
  return async (transactionInput) => {
    if (transactionInput.signerReference !== input.signerReference) {
      throw new Error("remote signer received an unexpected signerReference");
    }
    assertSolanaPayoutTransactionBytesMatchPlan({
      transactionBase64: transactionInput.transactionBase64,
      plannedTransaction: transactionInput.plannedTransaction,
      policy: input.policy
    });
    const payload = {
      schema: "split402.solana.remote_payout_sign_request.v1",
      batchId: transactionInput.batchId,
      network: transactionInput.network,
      signerReference: transactionInput.signerReference,
      destinationAmountListHash: transactionInput.destinationAmountListHash,
      transactionIndex: transactionInput.plannedTransaction.index,
      amountAtomic: transactionInput.amountAtomic,
      transactionBase64: transactionInput.transactionBase64,
      plannedTransaction: transactionInput.plannedTransaction,
      policy: input.policy
    };
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
      "x-split402-request-schema": payload.schema
    };
    if (input.keyId !== undefined) {
      headers["x-split402-signer-key-id"] = input.keyId;
    }
    if (input.sharedSecret !== undefined) {
      const timestamp = (input.now?.() ?? new Date()).toISOString();
      headers["x-split402-signature-timestamp"] = timestamp;
      headers["x-split402-signature"] = createRemoteSignerRequestSignature({
        timestamp,
        body,
        sharedSecret: input.sharedSecret
      });
    }

    const response = await fetchRemoteSigner(input, body, headers);
    return readRemoteSignerResponse(
      response,
      transactionInput.plannedTransaction.index
    );
  };
}

async function createLocalDevSigner(input: LocalDevSolanaPayoutSignerOptions) {
  const keyMaterial = readLocalDevSignerKeyMaterial(input);
  if (keyMaterial.kind === "secret") {
    return createKeyPairSignerFromBytes(keyMaterial.bytes, false);
  }
  return createKeyPairSignerFromPrivateKeyBytes(keyMaterial.bytes, false);
}

function readLocalDevSignerKeyMaterial(
  input: LocalDevSolanaPayoutSignerOptions
): { kind: "secret" | "private"; bytes: Uint8Array } {
  const provided = [
    input.secretKeyBytes,
    input.privateKeyBytes,
    input.secretKeyJson,
    input.secretKeyBase64,
    input.privateKeyBase64
  ].filter((value) => value !== undefined);
  if (provided.length !== 1) {
    throw new Error(
      "local-dev signer requires exactly one key material input"
    );
  }
  if (input.secretKeyBytes !== undefined) {
    return {
      kind: "secret",
      bytes: readByteArray(input.secretKeyBytes, "secretKeyBytes", 64)
    };
  }
  if (input.privateKeyBytes !== undefined) {
    return {
      kind: "private",
      bytes: readByteArray(input.privateKeyBytes, "privateKeyBytes", 32)
    };
  }
  if (input.secretKeyJson !== undefined) {
    return {
      kind: "secret",
      bytes: readSecretKeyJson(input.secretKeyJson)
    };
  }
  if (input.secretKeyBase64 !== undefined) {
    return {
      kind: "secret",
      bytes: readBase64Bytes(input.secretKeyBase64, "secretKeyBase64", 64)
    };
  }
  return {
    kind: "private",
    bytes: readBase64Bytes(
      input.privateKeyBase64 ?? "",
      "privateKeyBase64",
      32
    )
  };
}

export class SolanaRpcPayoutTransactionBroadcaster {
  constructor(
    private readonly options: SolanaRpcPayoutTransactionBroadcasterOptions
  ) {}

  async broadcast(
    input: BroadcastSolanaPayoutTransactionInput
  ): Promise<SolanaPayoutBroadcastResult> {
    const transaction = input.transaction;
    if (!canBroadcastPayoutTransaction(transaction)) {
      throw new Error(
        `payout transaction ${transaction.id} must be signed before broadcast`
      );
    }
    const signedTransactionBase64 = assertBase64Transaction(
      transaction.signedTransactionBase64 ?? "",
      `payout transaction ${transaction.id} signedTransactionBase64`
    );

    let lastRetry: SolanaPayoutBroadcastResult | undefined;
    for (const rpcUrl of this.rpcUrls()) {
      const result = await this.broadcastWithRpcUrl(
        rpcUrl,
        transaction,
        signedTransactionBase64
      );
      if (result.status === "submitted") {
        return result;
      }
      lastRetry = result;
    }
    return (
      lastRetry ?? {
        transactionId: transaction.id,
        status: "retry",
        error: "no Solana RPC URLs configured"
      }
    );
  }

  private async broadcastWithRpcUrl(
    rpcUrl: string,
    transaction: PayoutTransactionRecord,
    signedTransactionBase64: string
  ): Promise<SolanaPayoutBroadcastResult> {
    let response: SolanaRpcHttpResponse;
    try {
      response = await this.fetch()(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: `split402-payout-broadcast-${transaction.id}`,
          method: "sendTransaction",
          params: [
            signedTransactionBase64,
            {
              encoding: "base64",
              skipPreflight: this.skipPreflight(),
              preflightCommitment: this.commitment(),
              ...(this.options.maxRetries === undefined
                ? {}
                : { maxRetries: this.options.maxRetries })
            }
          ]
        })
      });
    } catch (error) {
      return {
        transactionId: transaction.id,
        status: "retry",
        rpcUrl,
        error: `Solana RPC request failed: ${readErrorMessage(error)}`
      };
    }

    if (!response.ok) {
      return {
        transactionId: transaction.id,
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
          transactionId: transaction.id,
          status: "retry",
          rpcUrl,
          error: `Solana RPC returned error: ${rpcError}`
        };
      }

      const signature = readSendTransactionSignature(body);
      if (
        transaction.expectedSignature !== undefined &&
        transaction.expectedSignature !== signature
      ) {
        return {
          transactionId: transaction.id,
          status: "retry",
          rpcUrl,
          error: "Solana RPC returned a signature that does not match expectedSignature"
        };
      }
      return {
        transactionId: transaction.id,
        status: "submitted",
        rpcUrl,
        signature
      };
    } catch (error) {
      return {
        transactionId: transaction.id,
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

  private skipPreflight(): boolean {
    return this.options.skipPreflight ?? false;
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

export class SolanaRpcPayoutTransactionFinalityMonitor {
  constructor(
    private readonly options: SolanaRpcPayoutTransactionFinalityMonitorOptions
  ) {}

  async monitor(
    input: MonitorSolanaPayoutTransactionInput
  ): Promise<SolanaPayoutFinalityResult> {
    const transaction = input.transaction;
    const signature = assertPayoutTransactionSignatureForMonitoring(transaction);
    let lastRetry: SolanaPayoutFinalityResult | undefined;
    for (const rpcUrl of this.rpcUrls()) {
      const result = await this.monitorWithRpcUrl(rpcUrl, transaction, signature);
      if (result.status !== "retry") {
        return result;
      }
      lastRetry = result;
    }
    return (
      lastRetry ?? {
        transactionId: transaction.id,
        status: "retry",
        signature,
        error: "no Solana RPC URLs configured",
        retryAt: this.retryAt()
      }
    );
  }

  private async monitorWithRpcUrl(
    rpcUrl: string,
    transaction: PayoutTransactionRecord,
    signature: string
  ): Promise<SolanaPayoutFinalityResult> {
    let response: SolanaRpcHttpResponse;
    try {
      response = await this.fetch()(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: `split402-payout-finality-${transaction.id}`,
          method: "getSignatureStatuses",
          params: [[signature], { searchTransactionHistory: true }]
        })
      });
    } catch (error) {
      return this.retryResult({
        transaction,
        signature,
        rpcUrl,
        error: `Solana RPC request failed: ${readErrorMessage(error)}`
      });
    }

    if (!response.ok) {
      return this.retryResult({
        transaction,
        signature,
        rpcUrl,
        error: `Solana RPC returned HTTP ${response.status}`
      });
    }

    try {
      const body = await response.json();
      const rpcError = readRpcError(body);
      if (rpcError !== undefined) {
        return this.retryResult({
          transaction,
          signature,
          rpcUrl,
          error: `Solana RPC returned error: ${rpcError}`
        });
      }
      const signatureStatus = readSignatureStatus(body);
      return await this.readFinalityResult(
        transaction,
        signature,
        rpcUrl,
        signatureStatus
      );
    } catch (error) {
      return this.retryResult({
        transaction,
        signature,
        rpcUrl,
        error: `Solana RPC response was invalid: ${readErrorMessage(error)}`
      });
    }
  }

  private async readFinalityResult(
    transaction: PayoutTransactionRecord,
    signature: string,
    rpcUrl: string,
    signatureStatus: SolanaSignatureStatus | null
  ): Promise<SolanaPayoutFinalityResult> {
    if (signatureStatus === null) {
      const expired = await this.readExpiredResult(transaction, signature, rpcUrl);
      if (expired !== undefined) {
        return expired;
      }
      if (this.isOutcomeUnknown(transaction)) {
        return {
          transactionId: transaction.id,
          status: "outcome_unknown",
          signature,
          rpcUrl,
          error: `payout transaction signature not found after unknown-outcome threshold: ${signature}`
        };
      }
      return this.retryResult({
        transaction,
        signature,
        rpcUrl,
        error: `payout transaction signature not found: ${signature}`
      });
    }
    const common = {
      transactionId: transaction.id,
      signature,
      rpcUrl,
      ...(signatureStatus.confirmationStatus === undefined
        ? {}
        : { confirmationStatus: signatureStatus.confirmationStatus }),
      ...(signatureStatus.confirmations === undefined
        ? {}
        : { confirmations: signatureStatus.confirmations })
    };
    if (signatureStatus.err !== null) {
      return {
        ...common,
        status: "failed",
        error: `payout transaction failed: ${JSON.stringify(signatureStatus.err)}`
      };
    }
    if (signatureStatus.confirmationStatus === "finalized") {
      return {
        ...common,
        status: "finalized"
      };
    }
    if (signatureStatus.confirmationStatus === "confirmed") {
      return {
        ...common,
        status: "confirmed"
      };
    }
    return this.retryResult({
      transaction,
      signature,
      rpcUrl,
      error: "payout transaction has not reached confirmed commitment",
      signatureStatus
    });
  }

  private async readExpiredResult(
    transaction: PayoutTransactionRecord,
    signature: string,
    rpcUrl: string
  ): Promise<SolanaPayoutFinalityResult | undefined> {
    const lastValidBlockHeight = transaction.lastValidBlockHeight;
    if (lastValidBlockHeight === undefined) {
      return undefined;
    }
    // Fail closed: any RPC failure here falls back to retry/outcome-unknown
    // handling instead of claiming the blockhash expired.
    let blockHeight: number;
    try {
      const response = await this.fetch()(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: `split402-payout-block-height-${transaction.id}`,
          method: "getBlockHeight",
          params: [{ commitment: "finalized" }]
        })
      });
      if (!response.ok) {
        return undefined;
      }
      const body = await response.json();
      if (readRpcError(body) !== undefined) {
        return undefined;
      }
      blockHeight = readBlockHeightResult(body);
    } catch {
      return undefined;
    }
    if (blockHeight <= lastValidBlockHeight) {
      return undefined;
    }
    return {
      transactionId: transaction.id,
      status: "expired",
      signature,
      rpcUrl,
      error: `payout transaction blockhash expired: finalized block height ${blockHeight} passed lastValidBlockHeight ${lastValidBlockHeight} and signature was not found: ${signature}`
    };
  }

  private retryResult(input: {
    transaction: PayoutTransactionRecord;
    signature: string;
    rpcUrl?: string;
    error: string;
    signatureStatus?: SolanaSignatureStatus;
  }): SolanaPayoutFinalityResult {
    return {
      transactionId: input.transaction.id,
      status: "retry",
      signature: input.signature,
      ...(input.rpcUrl === undefined ? {} : { rpcUrl: input.rpcUrl }),
      error: input.error,
      ...(input.signatureStatus?.confirmationStatus === undefined
        ? {}
        : { confirmationStatus: input.signatureStatus.confirmationStatus }),
      ...(input.signatureStatus?.confirmations === undefined
        ? {}
        : { confirmations: input.signatureStatus.confirmations }),
      retryAt: this.retryAt()
    };
  }

  private isOutcomeUnknown(transaction: PayoutTransactionRecord): boolean {
    const unknownOutcomeAfterMs = this.options.unknownOutcomeAfterMs;
    if (unknownOutcomeAfterMs === undefined || transaction.submittedAt === undefined) {
      return false;
    }
    return this.now().getTime() - Date.parse(transaction.submittedAt) >= unknownOutcomeAfterMs;
  }

  private retryAt(): string {
    const delayMs = this.options.retryDelayMs ?? 30_000;
    return new Date(this.now().getTime() + delayMs).toISOString();
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
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

export class SolanaRpcPayoutFinalizedTransferVerifier
  implements PayoutFinalizedTransferVerifier {
  constructor(
    private readonly options: SolanaRpcPayoutFinalizedTransferVerifierOptions
  ) {}

  async verifyFinalizedPayout(input: {
    batch: PayoutBatchRecord;
    transactions: PayoutTransactionRecord[];
  }): Promise<PayoutFinalizedTransferVerificationResult> {
    const setupErrors = this.validateBatch(input.batch);
    if (setupErrors.length > 0) {
      return { ok: false, errors: setupErrors };
    }

    const errors: string[] = [];
    for (const transaction of input.transactions) {
      errors.push(
        ...(await this.verifyTransaction(input.batch, transaction))
      );
    }
    return {
      ok: errors.length === 0,
      errors
    };
  }

  private validateBatch(batch: PayoutBatchRecord): string[] {
    const errors: string[] = [];
    if (batch.network !== this.options.network) {
      errors.push(
        `payout batch network ${batch.network} does not match verifier network ${this.options.network}`
      );
    }
    if (batch.status !== "finalized") {
      errors.push("payout batch must be finalized before transfer verification");
    }
    try {
      assertSolanaAddress(this.options.fundingWallet, "fundingWallet");
      assertSolanaAddress(this.options.sourceTokenAccount, "sourceTokenAccount");
      assertSupportedTokenProgramId(
        this.options.tokenProgramId ?? SOLANA_TOKEN_PROGRAM_ID
      );
    } catch (error) {
      errors.push(readErrorMessage(error));
    }
    return errors;
  }

  private async verifyTransaction(
    batch: PayoutBatchRecord,
    transaction: PayoutTransactionRecord
  ): Promise<string[]> {
    const errors: string[] = [];
    if (transaction.status !== "finalized") {
      errors.push(`payout transaction ${transaction.id} is not finalized`);
    }
    const signature = transaction.expectedSignature;
    if (signature === undefined) {
      errors.push(`payout transaction ${transaction.id} is missing expectedSignature`);
      return errors;
    }
    if (transaction.items.length === 0) {
      errors.push(`payout transaction ${transaction.id} has no mapped payout items`);
      return errors;
    }

    const response = await this.requestFinalizedTransaction(signature);
    if (response.transaction === undefined) {
      errors.push(...response.errors);
      return errors;
    }

    const confirmed = response.transaction;
    if (!confirmed.signatures.includes(signature)) {
      errors.push(`finalized transaction ${signature} does not include expected signature`);
    }
    if (confirmed.metaErr !== null) {
      errors.push(`finalized transaction ${signature} failed: ${JSON.stringify(confirmed.metaErr)}`);
    }
    errors.push(
      ...(await verifyFinalizedPayoutTransfersForTransaction({
        batch,
        transaction,
        confirmed,
        fundingWallet: this.options.fundingWallet,
        sourceTokenAccount: this.options.sourceTokenAccount,
        tokenProgramId: this.options.tokenProgramId ?? SOLANA_TOKEN_PROGRAM_ID
      }))
    );
    return errors.map((error) => `${transaction.id}: ${error}`);
  }

  private async requestFinalizedTransaction(
    signature: string
  ): Promise<{ transaction?: SolanaConfirmedTransaction; errors: string[] }> {
    const errors: string[] = [];
    for (const rpcUrl of this.rpcUrls()) {
      try {
        const response = await this.fetch()(rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "split402-payout-finalized-transfer-verification",
            method: "getTransaction",
            params: [
              signature,
              {
                commitment: "finalized",
                encoding: "jsonParsed",
                maxSupportedTransactionVersion: 0
              }
            ]
          })
        });
        if (!response.ok) {
          errors.push(`Solana RPC ${rpcUrl} returned HTTP ${response.status}`);
          continue;
        }
        const body = await response.json();
        const rpcError = readRpcError(body);
        if (rpcError !== undefined) {
          errors.push(`Solana RPC ${rpcUrl} returned error: ${rpcError}`);
          continue;
        }
        const transaction = readConfirmedTransaction(body);
        if (transaction === null) {
          errors.push(`finalized transaction details not found: ${signature}`);
          continue;
        }
        return { transaction, errors: [] };
      } catch (error) {
        errors.push(`Solana RPC finalized transaction lookup failed: ${readErrorMessage(error)}`);
      }
    }
    if (errors.length === 0) {
      errors.push("no Solana RPC URLs configured");
    }
    return { errors };
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

function assertLocalDevSignerReference(value: string): string {
  const signerReference = assertNonEmptyString(value, "signerReference");
  if (!signerReference.startsWith("local-dev:")) {
    throw new Error("local-dev signerReference must start with local-dev:");
  }
  return signerReference;
}

function assertRemoteSignerReference(value: string): string {
  const signerReference = assertNonEmptyString(value, "signerReference");
  if (signerReference.startsWith("local-dev:")) {
    throw new Error("remote signerReference must not start with local-dev:");
  }
  return signerReference;
}

function assertHttpUrl(value: string, label: string): string {
  const url = assertNonEmptyString(value, label);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${label} must be an HTTP URL`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`${label} must be an HTTP URL`);
  }
  return parsed.toString();
}

async function fetchRemoteSigner(
  input: {
    endpointUrl: string;
    timeoutMs: number;
    fetch?: RemoteSolanaPayoutSignerFetch;
  },
  body: string,
  headers: Record<string, string>
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await (input.fetch ?? fetch)(input.endpointUrl, {
      method: "POST",
      headers,
      body,
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`remote payout signer returned HTTP ${response.status}`);
    }
    return response.json();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("remote payout signer request timed out");
    }
    throw new Error(`remote payout signer request failed: ${readErrorMessage(error)}`);
  } finally {
    clearTimeout(timeout);
  }
}

function readRemoteSignerResponse(
  body: unknown,
  transactionIndex: number
): SolanaPayoutTransactionSigningDelegateResult {
  const record = readRecord(body);
  const responseIndex = readOptionalInteger(
    record.transactionIndex,
    "transactionIndex"
  );
  if (responseIndex !== undefined && responseIndex !== transactionIndex) {
    throw new Error("remote payout signer returned mismatched transactionIndex");
  }
  return {
    signedTransactionBase64: assertBase64Transaction(
      readRequiredString(
        record.signedTransactionBase64,
        "signedTransactionBase64"
      ),
      "signedTransactionBase64"
    ),
    ...(record.expectedSignature === undefined
      ? {}
      : {
          expectedSignature: readRequiredString(
            record.expectedSignature,
            "expectedSignature"
          )
        })
  };
}

function createRemoteSignerRequestSignature(input: {
  timestamp: string;
  body: string;
  sharedSecret: string;
}): string {
  const digest = createHmac("sha256", input.sharedSecret)
    .update(`${input.timestamp}.${input.body}`)
    .digest("hex");
  return `v1=${digest}`;
}

function readOptionalIntegerEnv(
  value: string | undefined,
  label: string
): number | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  if (!/^[1-9][0-9]*$/u.test(value.trim())) {
    throw new Error(`${label} must be a positive integer`);
  }
  return Number.parseInt(value.trim(), 10);
}

function readSecretKeyJson(value: string): Uint8Array {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("secretKeyJson must be a JSON array");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("secretKeyJson must be a JSON array");
  }
  return readByteArray(parsed, "secretKeyJson", 64);
}

function readBase64Bytes(value: string, label: string, length: number): Uint8Array {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty base64 string`);
  }
  const normalized = value.trim();
  const bytes = Buffer.from(normalized, "base64");
  if (bytes.length !== length || bytes.toString("base64") !== normalized) {
    throw new Error(`${label} must decode to ${length} bytes`);
  }
  return new Uint8Array(bytes);
}

function readByteArray(
  value: Uint8Array | readonly number[],
  label: string,
  length: number
): Uint8Array {
  const raw = Array.from(value);
  if (raw.length !== length) {
    throw new Error(`${label} must contain ${length} bytes`);
  }
  for (const byte of raw) {
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new Error(`${label} must contain byte values`);
    }
  }
  return new Uint8Array(raw);
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

export function verifySolanaPayoutTransactionBytesAgainstPlan(
  input: VerifySolanaPayoutTransactionBytesInput
): VerifySolanaPayoutTransactionBytesResult {
  const errors: string[] = [];
  let message: DecodedSolanaTransactionMessage;
  try {
    message = decodeSolanaTransactionMessageBytes(input.transactionBase64);
  } catch (error) {
    return {
      ok: false,
      errors: [`transaction bytes are not a supported Solana transaction: ${readErrorMessage(error)}`]
    };
  }

  const fundingWallet = safeSolanaAddress(input.policy.fundingWallet);
  if (fundingWallet === undefined) {
    errors.push("policy funding wallet is not a valid Solana address");
  } else {
    const requiredSigners = message.accountKeys.slice(
      0,
      message.numRequiredSignatures
    );
    if (message.numRequiredSignatures !== 1 || requiredSigners[0] !== fundingWallet) {
      errors.push("transaction must require exactly the approved funding wallet signer");
    }
    if (message.accountKeys[0] !== fundingWallet) {
      errors.push("transaction fee payer must be the approved funding wallet");
    }
  }

  if (message.addressTableLookupCount !== 0) {
    errors.push("address lookup tables are not supported for payout signing");
  }
  if (message.instructions.length !== input.plannedTransaction.instructions.length) {
    errors.push("transaction instruction count does not match approved plan");
  }

  const plannedByPayoutItem = new Map(
    input.plannedTransaction.items.map((item) => [item.payoutItemId, item])
  );
  for (
    let index = 0;
    index <
    Math.max(message.instructions.length, input.plannedTransaction.instructions.length);
    index += 1
  ) {
    const actual = message.instructions[index];
    const planned = input.plannedTransaction.instructions[index];
    if (actual === undefined || planned === undefined) {
      continue;
    }
    const actualProgram = message.accountKeys[actual.programIdIndex];
    if (actualProgram === undefined) {
      errors.push(`instruction ${index} references an unknown program account`);
      continue;
    }
    switch (planned.kind) {
      case "createAssociatedTokenIdempotent":
        errors.push(
          ...verifyCompiledCreateAssociatedTokenInstruction({
            index,
            actual,
            actualProgram,
            accountKeys: message.accountKeys,
            planned,
            policy: input.policy
          })
        );
        break;
      case "transferChecked":
        errors.push(
          ...verifyCompiledTransferCheckedInstruction({
            index,
            actual,
            actualProgram,
            accountKeys: message.accountKeys,
            planned,
            plannedItem: plannedByPayoutItem.get(planned.payoutItemId),
            policy: input.policy
          })
        );
        break;
    }
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

function assertSolanaPayoutTransactionBytesMatchPlan(
  input: VerifySolanaPayoutTransactionBytesInput
): void {
  const result = verifySolanaPayoutTransactionBytesAgainstPlan(input);
  if (!result.ok) {
    throw new Error(
      `serialized payout transaction does not match approved plan: ${result.errors.join("; ")}`
    );
  }
}

interface DecodedSolanaTransactionMessage {
  numRequiredSignatures: number;
  accountKeys: string[];
  instructions: DecodedCompiledInstruction[];
  addressTableLookupCount: number;
}

interface DecodedCompiledInstruction {
  programIdIndex: number;
  accountIndexes: number[];
  data: Uint8Array;
}

function decodeSolanaTransactionMessageBytes(
  transactionBase64: string
): DecodedSolanaTransactionMessage {
  const transactionBytes = Buffer.from(
    assertBase64Transaction(transactionBase64, "transactionBase64"),
    "base64"
  );
  const transaction = getTransactionDecoder().decode(transactionBytes);
  const messageBytes = readTransactionMessageBytes(transaction);
  return decodeCompiledSolanaMessage(messageBytes);
}

function readTransactionMessageBytes(transaction: unknown): Uint8Array {
  const messageBytes = readRecord(transaction).messageBytes;
  if (
    messageBytes instanceof Uint8Array ||
    (typeof Buffer !== "undefined" && Buffer.isBuffer(messageBytes))
  ) {
    return new Uint8Array(messageBytes);
  }
  throw new Error("decoded transaction is missing message bytes");
}

function decodeCompiledSolanaMessage(messageBytes: Uint8Array): DecodedSolanaTransactionMessage {
  const cursor = new ByteCursor(messageBytes);
  const first = cursor.readByte("message header");
  const versioned = (first & 0x80) !== 0;
  if (versioned && (first & 0x7f) !== 0) {
    throw new Error("only Solana v0 transactions are supported");
  }
  const numRequiredSignatures = versioned
    ? cursor.readByte("message header numRequiredSignatures")
    : first;
  cursor.readByte("message header numReadonlySignedAccounts");
  cursor.readByte("message header numReadonlyUnsignedAccounts");

  const accountKeyCount = cursor.readShortVec("account key count");
  const accountKeys: string[] = [];
  for (let index = 0; index < accountKeyCount; index += 1) {
    accountKeys.push(solanaAddressFromBytes(cursor.readBytes(32, `account key ${index}`)));
  }
  cursor.readBytes(32, "recent blockhash");

  const instructionCount = cursor.readShortVec("instruction count");
  const instructions: DecodedCompiledInstruction[] = [];
  for (let index = 0; index < instructionCount; index += 1) {
    const programIdIndex = cursor.readByte(`instruction ${index} programIdIndex`);
    const accountIndexCount = cursor.readShortVec(
      `instruction ${index} account index count`
    );
    const accountIndexes: number[] = [];
    for (let accountIndex = 0; accountIndex < accountIndexCount; accountIndex += 1) {
      accountIndexes.push(
        cursor.readByte(`instruction ${index} account index ${accountIndex}`)
      );
    }
    const dataLength = cursor.readShortVec(`instruction ${index} data length`);
    const data = cursor.readBytes(dataLength, `instruction ${index} data`);
    instructions.push({ programIdIndex, accountIndexes, data });
  }

  const addressTableLookupCount = versioned
    ? cursor.readShortVec("address table lookup count")
    : 0;
  if (cursor.remaining() !== 0 && addressTableLookupCount === 0) {
    throw new Error("transaction message has trailing bytes");
  }

  return {
    numRequiredSignatures,
    accountKeys,
    instructions,
    addressTableLookupCount
  };
}

function solanaAddressFromBytes(bytes: Uint8Array): string {
  if (bytes.every((byte) => byte === 0)) {
    return "11111111111111111111111111111111";
  }
  return base58Encode(bytes);
}

class ByteCursor {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  readByte(label: string): number {
    if (this.offset >= this.bytes.length) {
      throw new Error(`${label} is truncated`);
    }
    const value = this.bytes[this.offset] ?? 0;
    this.offset += 1;
    return value;
  }

  readBytes(length: number, label: string): Uint8Array {
    if (length < 0 || this.offset + length > this.bytes.length) {
      throw new Error(`${label} is truncated`);
    }
    const value = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  readShortVec(label: string): number {
    let value = 0;
    let shift = 0;
    for (let byteIndex = 0; byteIndex < 3; byteIndex += 1) {
      const byte = this.readByte(label);
      value |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) {
        return value;
      }
      shift += 7;
    }
    throw new Error(`${label} is not a canonical Solana shortvec`);
  }

  remaining(): number {
    return this.bytes.length - this.offset;
  }
}

function verifyCompiledCreateAssociatedTokenInstruction(input: {
  index: number;
  actual: DecodedCompiledInstruction;
  actualProgram: string;
  accountKeys: string[];
  planned: SolanaCreateAssociatedTokenInstructionPlan;
  policy: SolanaPayoutSignerPolicy;
}): string[] {
  const errors: string[] = [];
  if (input.actualProgram !== ASSOCIATED_TOKEN_PROGRAM_ID) {
    errors.push(`instruction ${input.index} uses unsupported ATA program`);
  }
  if (input.actual.data.length !== 1 || input.actual.data[0] !== 1) {
    errors.push(`instruction ${input.index} is not idempotent ATA creation`);
  }
  const accounts = input.actual.accountIndexes.map(
    (accountIndex) => input.accountKeys[accountIndex]
  );
  if (accounts.length !== 6 || accounts.some((account) => account === undefined)) {
    errors.push(`instruction ${input.index} ATA account layout is unsupported`);
    return errors;
  }
  compareAccount(errors, input.index, "ATA payer", accounts[0], input.planned.payer);
  compareAccount(
    errors,
    input.index,
    "ATA account",
    accounts[1],
    input.planned.associatedTokenAccount
  );
  compareAccount(errors, input.index, "ATA owner", accounts[2], input.planned.owner);
  compareAccount(errors, input.index, "ATA mint", accounts[3], input.planned.mint);
  compareAccount(
    errors,
    input.index,
    "ATA system program",
    accounts[4],
    "11111111111111111111111111111111"
  );
  compareAccount(
    errors,
    input.index,
    "ATA token program",
    accounts[5],
    input.planned.tokenProgramId
  );
  if (input.planned.payer !== input.policy.fundingWallet) {
    errors.push(`instruction ${input.index} ATA payer does not match policy funding wallet`);
  }
  if (input.planned.mint !== input.policy.mint) {
    errors.push(`instruction ${input.index} ATA mint does not match policy mint`);
  }
  return errors;
}

function verifyCompiledTransferCheckedInstruction(input: {
  index: number;
  actual: DecodedCompiledInstruction;
  actualProgram: string;
  accountKeys: string[];
  planned: SolanaTransferCheckedInstructionPlan;
  plannedItem: SolanaPayoutPlannedItem | undefined;
  policy: SolanaPayoutSignerPolicy;
}): string[] {
  const errors: string[] = [];
  const allowedTokenProgramIds = readAllowedTokenProgramIds(
    input.policy.allowedTokenProgramIds
  );
  if (!allowedTokenProgramIds.has(input.actualProgram)) {
    errors.push(`instruction ${input.index} uses a token program outside signer policy`);
  }
  if (input.actualProgram !== input.planned.programId) {
    errors.push(`instruction ${input.index} token program does not match approved plan`);
  }
  const accounts = input.actual.accountIndexes.map(
    (accountIndex) => input.accountKeys[accountIndex]
  );
  if (accounts.length !== 4 || accounts.some((account) => account === undefined)) {
    errors.push(`instruction ${input.index} transfer account layout is unsupported`);
    return errors;
  }
  compareAccount(errors, input.index, "transfer source", accounts[0], input.planned.source);
  compareAccount(errors, input.index, "transfer mint", accounts[1], input.planned.mint);
  compareAccount(
    errors,
    input.index,
    "transfer destination",
    accounts[2],
    input.planned.destination
  );
  compareAccount(
    errors,
    input.index,
    "transfer authority",
    accounts[3],
    input.planned.authority
  );
  compareAccount(
    errors,
    input.index,
    "policy source token account",
    input.planned.source,
    input.policy.sourceTokenAccount
  );
  compareAccount(
    errors,
    input.index,
    "policy mint",
    input.planned.mint,
    input.policy.mint
  );
  compareAccount(
    errors,
    input.index,
    "policy funding authority",
    input.planned.authority,
    input.policy.fundingWallet
  );
  if (input.plannedItem === undefined) {
    errors.push(`instruction ${input.index} transfer payout item is missing from plan`);
  } else {
    compareAccount(
      errors,
      input.index,
      "payout item destination token account",
      input.planned.destination,
      input.plannedItem.destinationTokenAccount
    );
    if (input.planned.amountAtomic !== input.plannedItem.amountAtomic) {
      errors.push(`instruction ${input.index} transfer amount does not match payout item`);
    }
  }

  const decoded = decodeTransferCheckedInstructionData(input.actual.data);
  if (decoded === undefined) {
    errors.push(`instruction ${input.index} is not transferChecked`);
    return errors;
  }
  if (decoded.amountAtomic !== input.planned.amountAtomic) {
    errors.push(`instruction ${input.index} transfer amount does not match approved plan`);
  }
  if (decoded.decimals !== input.planned.decimals) {
    errors.push(`instruction ${input.index} transfer decimals do not match approved plan`);
  }
  return errors;
}

function decodeTransferCheckedInstructionData(
  data: Uint8Array
): { amountAtomic: string; decimals: number } | undefined {
  if (data.length !== 10 || data[0] !== 12) {
    return undefined;
  }
  let amount = 0n;
  for (let index = 0; index < 8; index += 1) {
    amount += BigInt(data[index + 1] ?? 0) << BigInt(index * 8);
  }
  return {
    amountAtomic: amount.toString(),
    decimals: data[9] ?? 0
  };
}

function compareAccount(
  errors: string[],
  instructionIndex: number,
  label: string,
  actual: string | undefined,
  expected: string
): void {
  if (actual !== expected) {
    errors.push(`instruction ${instructionIndex} ${label} does not match approved plan`);
  }
}

function safeSolanaAddress(value: string): string | undefined {
  try {
    return assertSolanaAddress(value, "address");
  } catch {
    return undefined;
  }
}

function policyFromPayoutPlan(
  plan: SolanaPayoutTransactionPlan
): SolanaPayoutSignerPolicy {
  return {
    network: plan.network,
    signerReference: "simulation",
    fundingWallet: plan.fundingWallet,
    sourceTokenAccount: plan.sourceTokenAccount,
    mint: plan.asset,
    allowedTokenProgramIds: [plan.tokenProgramId]
  };
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

function readTokenAccountBalanceAmount(body: unknown): string {
  const result = readRecord(readRecord(body).result);
  const value = readRecord(result.value);
  return assertNumericString(value.amount, "getTokenAccountBalance.result.value.amount");
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

async function verifyFinalizedPayoutTransfersForTransaction(input: {
  batch: PayoutBatchRecord;
  transaction: PayoutTransactionRecord;
  confirmed: SolanaConfirmedTransaction;
  fundingWallet: string;
  sourceTokenAccount: string;
  tokenProgramId: string;
}): Promise<string[]> {
  const errors: string[] = [];
  const expectedItems = input.transaction.items;
  const matchedItemIds = new Set<string>();
  const payoutTransfers = input.confirmed.transfers.filter(
    (transfer) =>
      transfer.mint === input.batch.asset &&
      transfer.source === input.sourceTokenAccount &&
      transfer.authority === input.fundingWallet
  );

  for (const transfer of payoutTransfers) {
    if (transfer.programId !== input.tokenProgramId) {
      errors.push("finalized transfer token program does not match funding policy");
      continue;
    }
    const item = expectedItems.find(
      (candidate) =>
        !matchedItemIds.has(candidate.payoutItemId) &&
        candidate.amountAtomic === transfer.amount &&
        (candidate.destinationTokenAccount === undefined ||
          candidate.destinationTokenAccount === transfer.destination)
    );
    if (item === undefined) {
      errors.push(
        `extra payout transfer from funding account to ${transfer.destination} for ${transfer.amount}`
      );
      continue;
    }
    matchedItemIds.add(item.payoutItemId);
    if (
      !(await transferRecipientMatchesPayoutItem({
        transfer,
        item,
        tokenAccounts: input.confirmed.tokenAccounts,
        mint: input.batch.asset,
        tokenProgramId: input.tokenProgramId
      }))
    ) {
      errors.push(
        `recipient owner does not match payout item destination wallet: ${item.payoutItemId}`
      );
    }
  }

  for (const item of expectedItems) {
    if (!matchedItemIds.has(item.payoutItemId)) {
      errors.push(`missing finalized payout transfer for item ${item.payoutItemId}`);
    }
  }

  return errors;
}

async function transferRecipientMatchesPayoutItem(input: {
  transfer: SolanaTokenTransfer;
  item: PayoutTransactionRecord["items"][number];
  tokenAccounts: Map<string, SolanaTokenAccountEvidence>;
  mint: string;
  tokenProgramId: string;
}): Promise<boolean> {
  if (
    input.item.destinationTokenAccount !== undefined &&
    input.transfer.destination !== input.item.destinationTokenAccount
  ) {
    return false;
  }
  const destination = input.tokenAccounts.get(input.transfer.destination);
  const ownerMatches = destination?.owner === input.item.destinationWallet;
  const mintMatches = destination?.mint === undefined || destination.mint === input.mint;
  const programMatches =
    destination?.programId === undefined ||
    destination.programId === input.transfer.programId;
  const ataMatches = await isAssociatedTokenAccount({
    account: input.transfer.destination,
    owner: input.item.destinationWallet,
    mint: input.mint,
    tokenProgramId: input.tokenProgramId
  });
  return mintMatches && programMatches && (ownerMatches || ataMatches);
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

function readSendTransactionSignature(body: unknown): string {
  return readRequiredString(readRecord(body).result, "sendTransaction result");
}

function readBlockHeightResult(body: unknown): number {
  const result = readRecord(body).result;
  if (typeof result !== "number" || !Number.isInteger(result) || result < 0) {
    throw new Error(
      "Solana RPC getBlockHeight result must be a non-negative integer"
    );
  }
  return result;
}

function canBroadcastPayoutTransaction(
  transaction: PayoutTransactionRecord
): boolean {
  return (
    transaction.status === "signed" ||
    transaction.status === "submitted" ||
    transaction.status === "outcome_unknown"
  );
}

function assertPayoutTransactionSignatureForMonitoring(
  transaction: PayoutTransactionRecord
): string {
  // "signed" is allowed so allocation-release safety checks can prove whether
  // a maybe-broadcast transaction landed even when the submit attempt only
  // observed an RPC timeout.
  if (
    transaction.status !== "signed" &&
    transaction.status !== "submitted" &&
    transaction.status !== "confirmed" &&
    transaction.status !== "outcome_unknown"
  ) {
    throw new Error(
      `payout transaction ${transaction.id} must be submitted before finality monitoring`
    );
  }
  return assertNonEmptyString(
    transaction.expectedSignature ?? "",
    `payout transaction ${transaction.id} expectedSignature`
  );
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

function assertNumericString(value: unknown, label: string): string {
  if (typeof value !== "string" || !isAtomicAmount(value)) {
    throw new Error(`${label} must be an unsigned integer string`);
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
