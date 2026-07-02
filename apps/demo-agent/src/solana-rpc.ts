import { SOLANA_DEVNET_USDC_MINT } from "@split402/protocol";

import { readDemoNetwork } from "./network.js";

export const DEVNET_USDC = SOLANA_DEVNET_USDC_MINT;
export const SOLANA_RPC_URL =
  process.env.SPLIT402_SOLANA_RPC_URL ?? readDemoNetwork().defaultRpcUrl;

export async function getSolLamports(address: string): Promise<string> {
  const result = asRecord(await solanaRpc("getBalance", [address]));
  const value = result.value;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("unexpected getBalance result");
  }
  return value.toString();
}

export async function getTokenAtomicBalance(
  owner: string,
  mint: string
): Promise<string> {
  return (await getTokenAccountSummary(owner, mint)).atomicBalance;
}

export async function getTokenAccountSummary(
  owner: string,
  mint: string
): Promise<{ accountCount: number; atomicBalance: string }> {
  const result = asRecord(
    await solanaRpc("getTokenAccountsByOwner", [
      owner,
      { mint },
      { encoding: "jsonParsed" }
    ])
  );
  const accounts = result.value;
  if (!Array.isArray(accounts)) {
    throw new Error("unexpected getTokenAccountsByOwner result");
  }

  let total = 0n;
  for (const account of accounts) {
    const amount = getPathString(account, [
      "account",
      "data",
      "parsed",
      "info",
      "tokenAmount",
      "amount"
    ]);
    if (amount !== undefined) {
      total += BigInt(amount);
    }
  }
  return {
    accountCount: accounts.length,
    atomicBalance: total.toString()
  };
}

export async function requestSolAirdrop(
  address: string,
  lamports: bigint
): Promise<string> {
  const signature = await solanaRpc("requestAirdrop", [address, Number(lamports)]);
  if (typeof signature !== "string") {
    throw new Error("unexpected requestAirdrop result");
  }
  return signature;
}

export async function waitForSignatureConfirmation(
  signature: string,
  timeoutMs = 30_000
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = asRecord(await solanaRpc("getSignatureStatuses", [[signature]]));
    const statuses: unknown = result.value;
    if (Array.isArray(statuses)) {
      const status: unknown = statuses[0];
      const confirmationStatus = getPathString(status, ["confirmationStatus"]);
      if (confirmationStatus === "confirmed" || confirmationStatus === "finalized") {
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`airdrop signature ${signature} was not confirmed in time`);
}

async function solanaRpc(method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(SOLANA_RPC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "split402-demo",
      method,
      params
    })
  });
  if (!response.ok) {
    throw new Error(`Solana RPC ${method} failed with HTTP ${response.status}`);
  }
  const payload = asRecord(await response.json());
  const error = payload.error;
  if (error !== undefined) {
    throw new Error(`Solana RPC ${method} returned ${JSON.stringify(error)}`);
  }
  return payload.result;
}

function getPathString(value: unknown, path: string[]): string | undefined {
  let current = value;
  for (const segment of path) {
    const record = asOptionalRecord(current);
    if (record === undefined) {
      return undefined;
    }
    current = record[segment];
  }
  return typeof current === "string" ? current : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  const record = asOptionalRecord(value);
  if (record === undefined) {
    throw new Error("expected object");
  }
  return record;
}

function asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}
