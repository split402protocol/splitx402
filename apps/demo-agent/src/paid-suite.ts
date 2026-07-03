import "./env.js";

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import path, { dirname, isAbsolute, resolve } from "node:path";

import {
  deriveEd25519PublicKey,
  hexToBytes,
  Split402ReceiptV1Schema,
  verifySplit402Receipt,
  type Split402ReceiptV1
} from "@split402/protocol";

import { WORKSPACE_ROOT } from "./env.js";
import { MAINNET_DEMO_CONFIRMATION, readDemoNetwork } from "./network.js";

const NETWORK = readDemoNetwork();
const DEFAULT_MERCHANT_SEED_HEX =
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const MERCHANT_PUBLIC_KEY =
  process.env.SPLIT402_MERCHANT_PUBLIC_KEY ??
  deriveEd25519PublicKey(
    hexToBytes(process.env.SPLIT402_SERVICE_SEED_HEX ?? DEFAULT_MERCHANT_SEED_HEX)
  );
const MERCHANT_ORIGIN =
  process.env.SPLIT402_MERCHANT_ORIGIN ?? "http://127.0.0.1:4021";
const EXPECTED_VALID_COMMISSION_BPS = Number.parseInt(
  process.env.SPLIT402_COMMISSION_BPS ?? "2000",
  10
);
const outputPath = process.argv[2];
const stdoutChunks: string[] = [];

try {
  await main();
  writeOutputFile();
} catch (error) {
  console.error(errorMessage(error));
  writeOutputFile();
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const runInvalidClaimStep = NETWORK.cluster !== "mainnet";
  if (NETWORK.cluster === "mainnet") {
    if (
      process.env.SPLIT402_MAINNET_CANARY_CONFIRM !== MAINNET_DEMO_CONFIRMATION
    ) {
      throw new Error(
        `refusing the paid suite on Solana Mainnet: set SPLIT402_MAINNET_CANARY_CONFIRM=${MAINNET_DEMO_CONFIRMATION} to acknowledge a mainnet canary run`
      );
    }
    writeStdout(
      "mainnet canary mode: running one valid paid request only; the invalid-claim step is skipped\n"
    );
  }

  const merchant = startMerchant();
  try {
    await waitForHealth(MERCHANT_ORIGIN, 20_000);
    writeStdout(`merchant ready at ${MERCHANT_ORIGIN}\n`);

    await runStep("preflight", "apps/demo-agent/dist/preflight.js", baseEnv());

    const receiptsBefore = await getReceipts(MERCHANT_ORIGIN);
    await runStep("valid paid request", "apps/demo-agent/dist/index.js", {
      ...baseEnv(),
      SPLIT402_USE_INVALID_CLAIM: ""
    });
    const validReceipt = newestReceiptSince(
      receiptsBefore.length,
      await getReceipts(MERCHANT_ORIGIN)
    );
    assertReceipt(
      validReceipt,
      EXPECTED_VALID_COMMISSION_BPS,
      "valid claim receipt"
    );

    let invalidReceipt: Split402ReceiptV1 | undefined;
    if (runInvalidClaimStep) {
      await runStep("invalid-claim paid request", "apps/demo-agent/dist/index.js", {
        ...baseEnv(),
        SPLIT402_USE_INVALID_CLAIM: "true"
      });
      invalidReceipt = newestReceiptSince(
        receiptsBefore.length + 1,
        await getReceipts(MERCHANT_ORIGIN)
      );
      assertReceipt(invalidReceipt, 0, "invalid claim receipt");
    }

    writeStdout(
      JSON.stringify(
        {
          paidSuitePassed: true,
          network: NETWORK.networkId,
          validReceipt: summarizeReceipt(validReceipt),
          invalidClaimSkipped: !runInvalidClaimStep,
          invalidReceipt:
            invalidReceipt === undefined
              ? undefined
              : summarizeReceipt(invalidReceipt)
        },
        null,
        2
      ) + "\n"
    );
  } finally {
    await stopMerchant(merchant);
  }
}

function startMerchant(): ChildProcessWithoutNullStreams {
  const origin = new URL(MERCHANT_ORIGIN);
  const port = origin.port || (origin.protocol === "https:" ? "443" : "80");
  const child = spawn(process.execPath, [path.join(WORKSPACE_ROOT, "apps/demo-merchant/dist/index.js")], {
    cwd: WORKSPACE_ROOT,
    env: {
      ...baseEnv(),
      PORT: port,
      SPLIT402_MERCHANT_ORIGIN: MERCHANT_ORIGIN
    },
    windowsHide: true
  });
  child.stdout.on("data", (chunk: Buffer) => {
    writeStdout(`[merchant] ${chunk.toString()}`);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    process.stderr.write(`[merchant] ${chunk.toString()}`);
  });
  return child;
}

async function runStep(
  label: string,
  scriptPath: string,
  env: NodeJS.ProcessEnv
): Promise<void> {
  writeStdout(`\n--- ${label} ---\n`);
  const result = await runNode(scriptPath, env);
  if (result.stdout.length > 0) {
    writeStdout(result.stdout);
  }
  if (result.stderr.length > 0) {
    process.stderr.write(result.stderr);
  }
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed with exit code ${result.exitCode}`);
  }
}

async function runNode(
  scriptPath: string,
  env: NodeJS.ProcessEnv
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(WORKSPACE_ROOT, scriptPath)], {
      cwd: WORKSPACE_ROOT,
      env,
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr
      });
    });
  });
}

async function waitForHealth(origin: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${origin}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      await delay(250);
      continue;
    }
    await delay(250);
  }
  throw new Error(`merchant did not become healthy within ${timeoutMs}ms`);
}

async function getReceipts(origin: string): Promise<Split402ReceiptV1[]> {
  const response = await fetch(`${origin}/debug/receipts`);
  if (!response.ok) {
    throw new Error(`/debug/receipts returned ${response.status}`);
  }
  const body = await response.json();
  const records = asRecord(body).receipts;
  if (!Array.isArray(records)) {
    throw new Error("/debug/receipts did not return a receipts array");
  }
  return records.map((record) => Split402ReceiptV1Schema.parse(record));
}

function newestReceiptSince(
  previousCount: number,
  receipts: Split402ReceiptV1[]
): Split402ReceiptV1 {
  if (receipts.length <= previousCount) {
    throw new Error(`expected a new receipt after index ${previousCount}`);
  }
  const receipt = receipts.at(-1);
  if (receipt === undefined) {
    throw new Error("missing newest receipt");
  }
  return receipt;
}

function assertReceipt(
  receipt: Split402ReceiptV1,
  expectedCommissionBps: number,
  label: string
): void {
  const verification = verifySplit402Receipt(receipt, MERCHANT_PUBLIC_KEY);
  if (!verification.ok) {
    throw new Error(`${label} failed verification: ${verification.errors.join("; ")}`);
  }
  if (receipt.commissionBps !== expectedCommissionBps) {
    throw new Error(
      `${label} commissionBps ${receipt.commissionBps} did not equal ${expectedCommissionBps}`
    );
  }
}

function summarizeReceipt(receipt: Split402ReceiptV1): Record<string, unknown> {
  return {
    receiptId: receipt.receiptId,
    paymentId: receipt.paymentId,
    commissionBps: receipt.commissionBps,
    commissionAmountAtomic: receipt.commissionAmountAtomic,
    referrerCreditAtomic: receipt.referrerCreditAtomic,
    settlementTxSignature: receipt.settlementTxSignature,
    routeId: receipt.routeId
  };
}

async function stopMerchant(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }
  child.kill();
  await Promise.race([
    new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
    }),
    delay(5_000)
  ]);
}

function baseEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    SPLIT402_MERCHANT_ORIGIN: MERCHANT_ORIGIN
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("expected object");
  }
  return value as Record<string, unknown>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function writeStdout(text: string): void {
  stdoutChunks.push(text);
  process.stdout.write(text);
}

function writeOutputFile(): void {
  if (outputPath === undefined || outputPath.trim().length === 0) {
    return;
  }
  const resolvedOutputPath = isAbsolute(outputPath)
    ? outputPath
    : resolve(process.env.INIT_CWD ?? WORKSPACE_ROOT, outputPath);
  mkdirSync(dirname(resolvedOutputPath), { recursive: true });
  writeFileSync(resolvedOutputPath, stdoutChunks.join(""), "utf8");
}
