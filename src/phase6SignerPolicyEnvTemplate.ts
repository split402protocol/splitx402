import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import { parsePhase7ProofRecord } from "./phase7StagingProof.js";

const SPL_TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

type JsonRecord = Record<string, unknown>;
type RpcFetch = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
  },
) => Promise<{ json(): Promise<unknown> }>;

export interface Phase6SignerPolicyEnvTemplateInput {
  phase7ProofPath?: string;
  phase7ProofText?: string;
  sourceTokenAccount?: string;
  readFile?: (path: string) => string;
  exists?: (path: string) => boolean;
  now?: Date;
}

export interface Phase6SignerPolicyEnvTemplateDerivations {
  network?: string;
  fundingWallet?: string;
  sourceTokenAccount?: string;
  mint?: string;
  maxTransactionAmountAtomic?: string;
  maxBatchAmountAtomic?: string;
}

export interface ResolveSolanaSourceTokenAccountInput {
  rpcUrl: string;
  fundingWallet: string;
  mint: string;
  fetch?: RpcFetch;
}

export interface ResolveSolanaSourceTokenAccountResult {
  ok: boolean;
  sourceTokenAccount?: string;
  errors: string[];
}

export function createPhase6SignerPolicyEnvTemplate(
  input: Phase6SignerPolicyEnvTemplateInput = {},
): string {
  const derivations = derivePhase6SignerPolicyValues(input);
  const reviewDate = isoDate(input.now ?? new Date());
  const reviewId = `phase6-signer-policy-${reviewDate}`;

  return [
    "# Split402 Phase 6 signer policy environment",
    "#",
    "# Generated from Phase 7 evidence where possible. Review every value before",
    "# running `corepack pnpm phase6:signer-policy`. Leave approval as no-go until",
    "# a human custody review approves the deployed signer policy.",
    "",
    `SPLIT402_PHASE6_SIGNER_POLICY_REVIEW_ID=${reviewId}`,
    `SPLIT402_PHASE6_SIGNER_POLICY_REVIEW_DATE=${reviewDate}`,
    "SPLIT402_PHASE6_SIGNER_POLICY_REVIEWERS=Split402 security, operations",
    "SPLIT402_PHASE6_SIGNER_POLICY_REVIEW_DECISION=no-go",
    'SPLIT402_PHASE6_SIGNER_POLICY_REVIEW_NOTES="Derived from Phase 7 evidence; source token account, destination hash, and signer reference require operator custody review."',
    "",
    `SPLIT402_SIGNER_POLICY_NETWORK=${derivations.network ?? ""}`,
    `SPLIT402_SIGNER_POLICY_FUNDING_WALLET=${derivations.fundingWallet ?? ""}`,
    derivations.sourceTokenAccount === undefined
      ? "# Fill from the actual payout funding token account controlled by the signer."
      : "# Resolved from Solana RPC; review that this token account is controlled by the deployed signer.",
    `SPLIT402_SIGNER_POLICY_SOURCE_TOKEN_ACCOUNT=${derivations.sourceTokenAccount ?? ""}`,
    `SPLIT402_SIGNER_POLICY_MINT=${derivations.mint ?? ""}`,
    `SPLIT402_SIGNER_POLICY_ALLOWED_TOKEN_PROGRAM_IDS=${SPL_TOKEN_PROGRAM_ID}`,
    `SPLIT402_SIGNER_POLICY_MAX_TRANSACTION_AMOUNT_ATOMIC=${derivations.maxTransactionAmountAtomic ?? ""}`,
    `SPLIT402_SIGNER_POLICY_MAX_BATCH_AMOUNT_ATOMIC=${derivations.maxBatchAmountAtomic ?? ""}`,
    "# Fill from the approved payout plan destination/amount list hash.",
    "SPLIT402_SIGNER_POLICY_EXPECTED_DESTINATION_AMOUNT_LIST_HASH=",
    "SPLIT402_SIGNER_POLICY_REQUIRE_SUCCESSFUL_SIMULATION=true",
    "# Example: kms:split402-devnet-payout, hsm:..., or local-dev:<dev-only-ref>.",
    "SPLIT402_SIGNER_POLICY_SIGNER_REFERENCE=",
    "",
  ].join("\n");
}

export function derivePhase6SignerPolicyValues(
  input: Phase6SignerPolicyEnvTemplateInput = {},
): Phase6SignerPolicyEnvTemplateDerivations {
  const proofPath = input.phase7ProofPath ?? "split402-launch-evidence/phase7-staging-proof.txt";
  const readFile = input.readFile ?? ((path: string) => readFileSync(path, "utf8"));
  const exists = input.exists ?? existsSync;
  const proofText =
    input.phase7ProofText ?? (exists(proofPath) ? readFile(proofPath) : "");
  const proofFields = parsePhase7ProofRecord(proofText);
  const proofDir = dirname(proofPath);
  const paidRequest = readAttachedArtifact({
    value: proofFields.get("paid_request_evidence"),
    proofDir,
    readFile,
    exists,
  });
  const payoutObligation = readAttachedArtifact({
    value: proofFields.get("payout_obligation_evidence"),
    proofDir,
    readFile,
    exists,
  });

  const paidObject = parseFirstJsonObject(paidRequest);
  const payoutObject = parseJsonObject(payoutObligation);
  const network = readFirstString([
    readPathString(paidObject, ["network"]),
    readPathString(paidObject, ["merchant", "body", "network"]),
    readPathString(paidObject, ["x402", "accepts", 0, "network"]),
  ]);
  const fundingWallet = readFirstString([
    readPathString(paidObject, ["merchant", "body", "merchantPayTo"]),
    readPathString(paidObject, ["merchantSettlement", "payToWallet"]),
    readPathString(paidObject, ["x402", "offer", "payToWallet"]),
    readPathString(paidObject, ["x402", "accepts", 0, "payTo"]),
  ]);
  const mint = readFirstString([
    readPathString(paidObject, ["merchant", "body", "paymentAsset"]),
    readPathString(paidObject, ["merchantSettlement", "paymentAsset"]),
    readPathString(paidObject, ["x402", "offer", "asset"]),
    readPathString(paidObject, ["x402", "accepts", 0, "asset"]),
    readPathString(payoutObject, ["summary", "assets", 0, "asset"]),
  ]);
  const payoutAsset = readMatchingPayoutAsset(payoutObject, mint);
  const maxAmount = readFirstPositiveAtomic([
    readPathString(payoutAsset, ["outstandingAmountAtomic"]),
    readPathString(payoutAsset, ["totalAccruedAmountAtomic"]),
    readPathString(paidObject, ["merchant", "body", "requiredAmountAtomic"]),
    readPathString(paidObject, ["x402", "offer", "requiredAmountAtomic"]),
    readPathString(paidObject, ["x402", "accepts", 0, "amount"]),
  ]);

  return {
    network,
    fundingWallet,
    sourceTokenAccount: input.sourceTokenAccount,
    mint,
    maxTransactionAmountAtomic: maxAmount,
    maxBatchAmountAtomic: maxAmount,
  };
}

export async function resolveSolanaSourceTokenAccount(
  input: ResolveSolanaSourceTokenAccountInput,
): Promise<ResolveSolanaSourceTokenAccountResult> {
  const fetchImpl = input.fetch ?? fetch;
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "getTokenAccountsByOwner",
    params: [
      input.fundingWallet,
      { mint: input.mint },
      { encoding: "jsonParsed", commitment: "confirmed" },
    ],
  };
  let response: unknown;
  try {
    response = await (
      await fetchImpl(input.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    ).json();
  } catch (error) {
    return {
      ok: false,
      errors: [`Solana RPC token-account lookup failed: ${readError(error)}`],
    };
  }

  const values = readPathArray(response, ["result", "value"]);
  if (values === undefined) {
    const rpcError = readPathString(response, ["error", "message"]);
    return {
      ok: false,
      errors: [
        rpcError === undefined
          ? "Solana RPC token-account lookup did not return result.value"
          : `Solana RPC token-account lookup failed: ${rpcError}`,
      ],
    };
  }

  const accounts = values
    .map(asRecord)
    .filter((record) => record !== undefined)
    .filter(
      (record) =>
        readPathString(record, ["account", "owner"]) === SPL_TOKEN_PROGRAM_ID &&
        readPathString(record, [
          "account",
          "data",
          "parsed",
          "info",
          "owner",
        ]) === input.fundingWallet &&
        readPathString(record, [
          "account",
          "data",
          "parsed",
          "info",
          "mint",
        ]) === input.mint &&
        readPathString(record, [
          "account",
          "data",
          "parsed",
          "info",
          "state",
        ]) === "initialized",
    );

  if (accounts.length !== 1) {
    return {
      ok: false,
      errors: [
        accounts.length === 0
          ? "No initialized SPL token account found for funding wallet and mint"
          : `Expected exactly one funding token account, found ${accounts.length}`,
      ],
    };
  }

  const sourceTokenAccount = readPathString(accounts[0], ["pubkey"]);
  if (sourceTokenAccount === undefined) {
    return {
      ok: false,
      errors: ["Resolved SPL token account is missing pubkey"],
    };
  }

  return { ok: true, sourceTokenAccount, errors: [] };
}

function readAttachedArtifact(input: {
  value: string | undefined;
  proofDir: string;
  readFile: (path: string) => string;
  exists: (path: string) => boolean;
}): string | undefined {
  const artifactPath = parseAttachedPath(input.value);
  if (artifactPath === undefined) {
    return undefined;
  }

  const candidates = [
    artifactPath,
    isAbsolute(artifactPath) ? artifactPath : resolve(input.proofDir, artifactPath),
  ];
  const path = candidates.find((candidate) => input.exists(candidate));
  return path === undefined ? undefined : input.readFile(path);
}

function parseAttachedPath(value: string | undefined): string | undefined {
  const prefix = "attached:";
  if (value === undefined || !value.startsWith(prefix)) {
    return undefined;
  }
  const artifactPath = value.slice(prefix.length).trim();
  return artifactPath.length === 0 ? undefined : artifactPath;
}

function parseFirstJsonObject(text: string | undefined): JsonRecord | undefined {
  if (text === undefined) {
    return undefined;
  }
  const source = text;

  for (
    let start = source.indexOf("{");
    start >= 0;
    start = source.indexOf("{", start + 1)
  ) {
    const candidate = readJsonObjectCandidate(source, start);
    if (candidate === undefined) {
      continue;
    }
    try {
      return asRecord(JSON.parse(candidate));
    } catch {
      continue;
    }
  }
  return undefined;
}

function parseJsonObject(text: string | undefined): JsonRecord | undefined {
  if (text === undefined) {
    return undefined;
  }

  try {
    return asRecord(JSON.parse(text));
  } catch {
    return parseFirstJsonObject(text);
  }
}

function readJsonObjectCandidate(text: string, start: number): string | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "\"") {
        inString = false;
      }
      continue;
    }

    if (character === "\"") {
      inString = true;
      continue;
    }
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }
  return undefined;
}

function readMatchingPayoutAsset(
  payoutObject: JsonRecord | undefined,
  mint: string | undefined,
): JsonRecord | undefined {
  const assets = readPathArray(payoutObject, ["summary", "assets"]);
  if (assets === undefined) {
    return undefined;
  }
  const records = assets.map(asRecord).filter((record) => record !== undefined);
  return (
    records.find(
      (asset) => mint !== undefined && readPathString(asset, ["asset"]) === mint,
    ) ?? records[0]
  );
}

function readPathString(
  value: unknown,
  path: Array<string | number>,
): string | undefined {
  const resolved = readPath(value, path);
  return typeof resolved === "string" && resolved.trim().length > 0
    ? resolved.trim()
    : undefined;
}

function readPathArray(
  value: unknown,
  path: Array<string | number>,
): unknown[] | undefined {
  const resolved = readPath(value, path);
  return Array.isArray(resolved) ? resolved : undefined;
}

function readPath(value: unknown, path: Array<string | number>): unknown {
  let current = value;
  for (const segment of path) {
    if (typeof segment === "number") {
      if (!Array.isArray(current)) {
        return undefined;
      }
      current = current[segment];
      continue;
    }

    const record = asRecord(current);
    if (record === undefined) {
      return undefined;
    }
    current = record[segment];
  }
  return current;
}

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function readFirstString(values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function readFirstPositiveAtomic(values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && /^[1-9][0-9]*$/u.test(value.trim())) {
      return value.trim();
    }
  }
  return undefined;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
