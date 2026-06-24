import "./env.js";

import { readFile, writeFile } from "node:fs/promises";

import { base58Encode, deriveEd25519PublicKey, hexToBytes } from "@split402/protocol";

import { WORKSPACE_ENV_PATH } from "./env.js";
import { getTokenAccountSummary } from "./solana-rpc.js";

const EXISTING_BUYER_SEED_HEX =
  "707172737475767778797a7b7c7d7e7f808182838485868788898a8b8c8d8e8f";
const EXISTING_PAYMENT_ASSET = "5GjxfPVysU13H9SKizkTdd3pjYU4Str9x37CEFKAqjcN";
const EXISTING_REQUIRED_AMOUNT_ATOMIC = "1";
const EXISTING_COMMISSION_BPS = "10000";

try {
  await main();
} catch (error) {
  console.error(errorMessage(error));
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const seed = hexToBytes(EXISTING_BUYER_SEED_HEX);
  const buyerAddress = deriveEd25519PublicKey(seed);
  const summary = await getTokenAccountSummary(buyerAddress, EXISTING_PAYMENT_ASSET);

  if (BigInt(summary.atomicBalance) < BigInt(EXISTING_REQUIRED_AMOUNT_ATOMIC)) {
    throw new Error(
      `fallback buyer ${buyerAddress} has ${summary.atomicBalance} atomic units of ${EXISTING_PAYMENT_ASSET}; expected at least ${EXISTING_REQUIRED_AMOUNT_ATOMIC}`
    );
  }

  await upsertEnvValues({
    SVM_PRIVATE_KEY: base58Encode(seed),
    SPLIT402_ASSET: EXISTING_PAYMENT_ASSET,
    SPLIT402_REQUIRED_AMOUNT_ATOMIC: EXISTING_REQUIRED_AMOUNT_ATOMIC,
    SPLIT402_MERCHANT_PAY_TO: buyerAddress,
    SPLIT402_COMMISSION_BPS: EXISTING_COMMISSION_BPS
  });

  console.log(
    JSON.stringify(
      {
        existingTokenReady: true,
        network: "Solana Devnet",
        buyerAndMerchantPayTo: buyerAddress,
        paymentAsset: EXISTING_PAYMENT_ASSET,
        requiredAmountAtomic: EXISTING_REQUIRED_AMOUNT_ATOMIC,
        commissionBps: EXISTING_COMMISSION_BPS,
        tokenAccountCount: summary.accountCount,
        tokenAtomic: summary.atomicBalance,
        env: {
          path: WORKSPACE_ENV_PATH,
          wrote: [
            "SVM_PRIVATE_KEY",
            "SPLIT402_ASSET",
            "SPLIT402_REQUIRED_AMOUNT_ATOMIC",
            "SPLIT402_MERCHANT_PAY_TO",
            "SPLIT402_COMMISSION_BPS"
          ]
        },
        next: ["run corepack pnpm demo:preflight", "run corepack pnpm demo:paid-suite"]
      },
      null,
      2
    )
  );
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
