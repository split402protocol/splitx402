import "./env.js";

import { access, appendFile, readFile, writeFile } from "node:fs/promises";

import { readDemoNetwork } from "./network.js";
import { getSolLamports, requestSolAirdrop, waitForSignatureConfirmation } from "./solana-rpc.js";
import {
  createSvmSignerFromBase58,
  encodeSvmPrivateSeed,
  generateSvmPrivateSeed
} from "./svm-key.js";
import { WORKSPACE_ENV_PATH } from "./env.js";

const ENV_PATH = WORKSPACE_ENV_PATH;
const NETWORK = readDemoNetwork();
const AIRDROP_LAMPORTS = BigInt(process.env.SPLIT402_AIRDROP_LAMPORTS ?? "1000000000");
const SKIP_AIRDROP =
  process.env.SPLIT402_SKIP_AIRDROP === "true" || NETWORK.cluster === "mainnet";

await main();

async function main(): Promise<void> {
  const existingSecret = process.env.SVM_PRIVATE_KEY;
  const setup =
    existingSecret === undefined || existingSecret.length === 0
      ? await createNewSetup()
      : await reuseExistingSetup(existingSecret);

  const envWrite = await maybeWriteEnv(setup.secret);
  let beforeLamports: string | undefined;
  let afterLamports: string | undefined;
  let airdropLamportsRequested = "0";
  let airdropSignature: string | undefined;
  let airdropError: string | undefined;

  try {
    beforeLamports = await getSolLamports(setup.address);
    if (
      !SKIP_AIRDROP &&
      (BigInt(beforeLamports) === 0n || process.env.SPLIT402_FORCE_AIRDROP === "true")
    ) {
      airdropLamportsRequested = AIRDROP_LAMPORTS.toString();
      airdropSignature = await requestSolAirdrop(setup.address, AIRDROP_LAMPORTS);
      await waitForSignatureConfirmation(airdropSignature);
    }
    afterLamports = await getSolLamports(setup.address);
  } catch (error) {
    airdropError = errorMessage(error);
  }

  const hasSolForDirectTransactions =
    afterLamports !== undefined && BigInt(afterLamports) > 0n;

  console.log(
    JSON.stringify(
      {
        address: setup.address,
        generatedNewKey: setup.generatedNewKey,
        secretFormat: setup.secretFormat,
        network: NETWORK.networkId,
        networkLabel: NETWORK.label,
        airdrop: {
          skipped: SKIP_AIRDROP,
          skippedBecauseMainnet: NETWORK.cluster === "mainnet",
          lamportsRequested: airdropLamportsRequested,
          signature: airdropSignature,
          error: airdropError
        },
        solLamportsBefore: beforeLamports,
        solLamportsAfter: afterLamports,
        solRequiredForX402: false,
        hasSolForDirectTransactions,
        env: envWrite,
        next: [
          `${NETWORK.label} SOL is optional for the x402 demo because the facilitator supplies the fee payer`,
          `fund this address with ${NETWORK.label} USDC for mint ${NETWORK.usdcMint}`,
          "run corepack pnpm demo:preflight",
          "run corepack pnpm demo:paid-suite when preflight reports readyForPaidRun: true"
        ]
      },
      null,
      2
    )
  );
}

async function createNewSetup(): Promise<{
  address: string;
  secret: string;
  generatedNewKey: boolean;
  secretFormat: "base58-32-byte-seed";
}> {
  const seed = generateSvmPrivateSeed();
  const secret = encodeSvmPrivateSeed(seed);
  const signer = await createSvmSignerFromBase58(secret);
  return {
    address: signer.address.toString(),
    secret,
    generatedNewKey: true,
    secretFormat: "base58-32-byte-seed"
  };
}

async function reuseExistingSetup(secret: string): Promise<{
  address: string;
  secret: string;
  generatedNewKey: boolean;
  secretFormat: "base58-existing-secret";
}> {
  const signer = await createSvmSignerFromBase58(secret);
  return {
    address: signer.address.toString(),
    secret,
    generatedNewKey: false,
    secretFormat: "base58-existing-secret"
  };
}

async function maybeWriteEnv(secret: string): Promise<Record<string, unknown>> {
  const envExists = await fileExists(ENV_PATH);
  if (!envExists) {
    await writeFile(ENV_PATH, `SVM_PRIVATE_KEY=${secret}\n`, { encoding: "utf8" });
    return {
      path: ENV_PATH,
      wrote: true,
      reason: ".env did not exist"
    };
  }

  const contents = await readFile(ENV_PATH, "utf8");
  if (/^SVM_PRIVATE_KEY=/mu.test(contents)) {
    return {
      path: ENV_PATH,
      wrote: false,
      reason: ".env already contains SVM_PRIVATE_KEY"
    };
  }

  await appendFile(ENV_PATH, `\nSVM_PRIVATE_KEY=${secret}\n`, { encoding: "utf8" });
  return {
    path: ENV_PATH,
    wrote: true,
    reason: "appended SVM_PRIVATE_KEY to existing .env"
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
