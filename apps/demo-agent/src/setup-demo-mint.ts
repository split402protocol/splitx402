import "./env.js";

import { readFile, writeFile } from "node:fs/promises";

import {
  address,
  assertIsTransactionWithBlockhashLifetime,
  createKeyPairSignerFromPrivateKeyBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  createTransactionPlanner,
  createTransactionPlanExecutor,
  generateKeyPairSigner,
  pipe,
  sendAndConfirmTransactionFactory,
  sequentialInstructionPlan,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  summarizeTransactionPlanResult
} from "@solana/kit";
import {
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getCreateMintInstructionPlan,
  getMintToATAInstructionPlanAsync
} from "@solana-program/token";
import { base58Encode, hexToBytes } from "@split402/protocol";

import { WORKSPACE_ENV_PATH } from "./env.js";
import { getSolLamports, getTokenAccountSummary, SOLANA_RPC_URL } from "./solana-rpc.js";
import { createSvmSignerFromBase58, createSvmSignerFromEnv } from "./svm-key.js";

const DEFAULT_SERVICE_SEED_HEX =
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const DEFAULT_PAY_TO = base58Encode(
  hexToBytes("808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f")
);
const DECIMALS = Number.parseInt(process.env.SPLIT402_DEMO_MINT_DECIMALS ?? "6", 10);
const REQUIRED_AMOUNT_ATOMIC = process.env.SPLIT402_REQUIRED_AMOUNT_ATOMIC ?? "10000";
const BUYER_MINT_AMOUNT_ATOMIC = BigInt(
  process.env.SPLIT402_DEMO_MINT_BUYER_AMOUNT_ATOMIC ?? "100000000"
);
const SOLANA_WS_URL =
  process.env.SPLIT402_SOLANA_RPC_WS_URL ?? deriveWebSocketUrl(SOLANA_RPC_URL);

try {
  await main();
} catch (error) {
  console.error(JSON.stringify(formatSetupError(error), null, 2));
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const serviceSeed = hexToBytes(
    process.env.SPLIT402_SERVICE_SEED_HEX ?? DEFAULT_SERVICE_SEED_HEX
  );
  const serviceSigner = await createKeyPairSignerFromPrivateKeyBytes(serviceSeed);
  const buyerSigner = await createSvmSignerFromEnv();
  const feePayerSigner = await createDemoFeePayerSigner(serviceSigner, buyerSigner);
  const mintSigner = await generateKeyPairSigner();
  const merchantPayTo = process.env.SPLIT402_MERCHANT_PAY_TO ?? DEFAULT_PAY_TO;
  const feePayerLamports = await getSolLamports(feePayerSigner.address);

  if (BigInt(feePayerLamports) <= 0n) {
    throw new Error(
      `demo fee payer ${feePayerSigner.address} has no Devnet SOL; run corepack pnpm demo:setup-buyer, set SPLIT402_DEMO_FEE_PAYER_PRIVATE_KEY to a funded Devnet key, or fund the selected fee payer`
    );
  }

  const rpc = createSolanaRpc(SOLANA_RPC_URL);
  const rpcSubscriptions = createSolanaRpcSubscriptions(SOLANA_WS_URL);
  const createMintPlan = getCreateMintInstructionPlan({
    payer: feePayerSigner,
    newMint: mintSigner,
    decimals: DECIMALS,
    mintAuthority: serviceSigner.address,
    freezeAuthority: null
  });
  const mintToBuyerPlan = await getMintToATAInstructionPlanAsync({
    payer: feePayerSigner,
    owner: buyerSigner.address,
    mint: mintSigner.address,
    mintAuthority: serviceSigner,
    amount: BUYER_MINT_AMOUNT_ATOMIC,
    decimals: DECIMALS
  });
  const createMerchantAtaInstruction =
    await getCreateAssociatedTokenIdempotentInstructionAsync({
      payer: feePayerSigner,
      owner: address(merchantPayTo),
      mint: mintSigner.address
    });
  const instructionPlan = sequentialInstructionPlan([
    createMintPlan,
    mintToBuyerPlan,
    createMerchantAtaInstruction
  ]);
  const transactionPlanner = createTransactionPlanner({
    createTransactionMessage: async () => {
      const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
      return pipe(
        createTransactionMessage({ version: 0 }),
        (message) => setTransactionMessageFeePayerSigner(feePayerSigner, message),
        (message) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, message)
      );
    }
  });
  const transactionPlan = await transactionPlanner(instructionPlan);
  const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions
  });
  const transactionPlanExecutor = createTransactionPlanExecutor({
    executeTransactionMessage: async (message, config) => {
      const transaction = await signTransactionMessageWithSigners(message, config);
      assertIsTransactionWithBlockhashLifetime(transaction);
      await sendAndConfirmTransaction(transaction, {
        ...(config?.abortSignal === undefined ? {} : { abortSignal: config.abortSignal }),
        commitment: "confirmed"
      });
      return { transaction };
    }
  });
  const result = await transactionPlanExecutor(transactionPlan);
  const summary = summarizeTransactionPlanResult(result);
  if (!summary.successful) {
    throw new Error("demo mint setup transaction plan did not complete");
  }

  await upsertEnvValues({
    SPLIT402_ASSET: mintSigner.address,
    SPLIT402_REQUIRED_AMOUNT_ATOMIC: REQUIRED_AMOUNT_ATOMIC
  });

  const [buyerTokenSummary, merchantTokenSummary] = await Promise.all([
    getTokenAccountSummary(buyerSigner.address, mintSigner.address),
    getTokenAccountSummary(merchantPayTo, mintSigner.address)
  ]);

  console.log(
    JSON.stringify(
      {
        demoMintReady: true,
        network: "Solana Devnet",
        rpcUrl: SOLANA_RPC_URL,
        serviceMintAuthority: serviceSigner.address,
        feePayer: feePayerSigner.address,
        feePayerLamportsBefore: feePayerLamports,
        mint: mintSigner.address,
        decimals: DECIMALS,
        requiredAmountAtomic: REQUIRED_AMOUNT_ATOMIC,
        buyer: {
          address: buyerSigner.address,
          mintedAtomic: BUYER_MINT_AMOUNT_ATOMIC.toString(),
          tokenAccountCount: buyerTokenSummary.accountCount,
          tokenAtomic: buyerTokenSummary.atomicBalance
        },
        merchant: {
          payToWallet: merchantPayTo,
          tokenAccountCount: merchantTokenSummary.accountCount,
          tokenAtomic: merchantTokenSummary.atomicBalance
        },
        transactions: summary.successfulTransactions.map((transaction) => ({
          signature: transaction.status.signature
        })),
        env: {
          path: WORKSPACE_ENV_PATH,
          wrote: ["SPLIT402_ASSET", "SPLIT402_REQUIRED_AMOUNT_ATOMIC"]
        },
        next: [
          "run corepack pnpm demo:preflight",
          "run corepack pnpm demo:paid-suite"
        ]
      },
      null,
      2
    )
  );
}

async function createDemoFeePayerSigner(
  serviceSigner: Awaited<ReturnType<typeof createKeyPairSignerFromPrivateKeyBytes>>,
  buyerSigner: Awaited<ReturnType<typeof createSvmSignerFromEnv>>
) {
  const feePayerSecret = process.env.SPLIT402_DEMO_FEE_PAYER_PRIVATE_KEY;
  if (feePayerSecret !== undefined && feePayerSecret.length > 0) {
    return await createSvmSignerFromBase58(feePayerSecret);
  }
  if (process.env.SPLIT402_USE_BUYER_AS_DEMO_FEE_PAYER === "true") {
    return buyerSigner;
  }
  return serviceSigner;
}

async function upsertEnvValues(values: Record<string, string>): Promise<void> {
  let contents = "";
  try {
    contents = await readFile(WORKSPACE_ENV_PATH, "utf8");
  } catch {
    contents = "";
  }

  const lines = contents.length > 0 ? contents.split(/\r?\n/u) : [];
  for (const [key, value] of Object.entries(values)) {
    const assignment = `${key}=${value}`;
    const existingIndex = lines.findIndex((line) => line.startsWith(`${key}=`));
    if (existingIndex >= 0) {
      lines[existingIndex] = assignment;
    } else {
      lines.push(assignment);
    }
  }

  const normalized = lines.filter((line, index) => line.length > 0 || index < lines.length - 1);
  await writeFile(WORKSPACE_ENV_PATH, `${normalized.join("\n")}\n`, "utf8");
}

function deriveWebSocketUrl(rpcUrl: string): string {
  const url = new URL(rpcUrl);
  if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else if (url.protocol === "http:") {
    url.protocol = "ws:";
  }
  return url.toString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatSetupError(error: unknown): Record<string, unknown> {
  const record = asOptionalRecord(error);
  return {
    error: errorMessage(error),
    name: error instanceof Error ? error.name : undefined,
    code: record?.code,
    context: simplifyUnknown(record?.context, new WeakSet(), 0),
    cause: simplifyUnknown(record?.cause, new WeakSet(), 0)
  };
}

function simplifyUnknown(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Error) {
    return formatSetupError(value);
  }
  if (Array.isArray(value)) {
    if (depth > 5) {
      return "[max depth]";
    }
    return value.map((item) => simplifyUnknown(item, seen, depth + 1));
  }
  const record = asOptionalRecord(value);
  if (record === undefined) {
    return value;
  }
  if (seen.has(record)) {
    return "[circular]";
  }
  if (depth > 5) {
    return "[max depth]";
  }
  seen.add(record);

  const simplified: Record<string, unknown> = {};
  for (const key of Object.getOwnPropertyNames(record)) {
    if (
      key === "transaction" ||
      key === "messageBytes" ||
      key === "signatures" ||
      key === "message"
    ) {
      simplified[key] = "[omitted]";
      continue;
    }
    simplified[key] = simplifyUnknown(record[key], seen, depth + 1);
  }
  return simplified;
}

function asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}
