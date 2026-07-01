#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  hashProtocolObject,
  Split402OfferV1Schema,
  Split402ReceiptV1Schema,
  verifySplit402Offer,
  verifySplit402Receipt,
  type Split402OfferV1,
  type Split402ReceiptV1
} from "@split402/protocol";

export interface ValidateExternalX402ArtifactsInput {
  merchantOrigin: string;
  operationId: string;
  network: string;
  asset: string;
  payToWallet: string;
  requiredAmountAtomic: string;
  merchantPublicKey: string;
  offer: unknown;
  receipt?: unknown;
  campaignTerms?: unknown;
}

export interface ValidateExternalX402ArtifactsResult {
  ok: boolean;
  errors: string[];
  checks: {
    offerSchema: boolean;
    offerSignature: boolean;
    offerMatchesPayment: boolean;
    campaignTermsHash?: boolean;
    receiptSchema?: boolean;
    receiptSignatureAndArithmetic?: boolean;
    receiptMatchesOfferAndPayment?: boolean;
  };
}

interface ValidateExternalX402ArtifactsCliInput {
  merchantOrigin?: string;
  operationId?: string;
  network?: string;
  asset?: string;
  payToWallet?: string;
  requiredAmountAtomic?: string;
  merchantPublicKey?: string;
  offerFile?: string;
  receiptFile?: string;
  campaignTermsFile?: string;
}

export function validateExternalX402Artifacts(
  input: ValidateExternalX402ArtifactsInput
): ValidateExternalX402ArtifactsResult {
  const errors: string[] = [];
  const checks: ValidateExternalX402ArtifactsResult["checks"] = {
    offerSchema: false,
    offerSignature: false,
    offerMatchesPayment: false
  };
  const parsedOffer = Split402OfferV1Schema.safeParse(input.offer);
  if (!parsedOffer.success) {
    errors.push(
      ...parsedOffer.error.issues.map(
        (issue) => `offer.${issue.path.join(".") || "root"}: ${issue.message}`
      )
    );
  } else {
    const offer = parsedOffer.data;
    checks.offerSchema = true;
    const offerVerification = verifySplit402Offer(
      offer,
      input.merchantPublicKey
    );
    checks.offerSignature = offerVerification.ok;
    errors.push(...prefixErrors("offer.signature", offerVerification.errors));

    const offerMatchErrors = validateOfferAgainstExternalPayment(offer, input);
    checks.offerMatchesPayment = offerMatchErrors.length === 0;
    errors.push(...offerMatchErrors);

    if (input.campaignTerms !== undefined) {
      const campaignTermsErrors = validateCampaignTermsHash(
        input.campaignTerms,
        offer,
        input.receipt
      );
      checks.campaignTermsHash = campaignTermsErrors.length === 0;
      errors.push(...campaignTermsErrors);
    }

    if (input.receipt !== undefined) {
      validateReceipt(input, offer, errors, checks);
    }
  }

  if (input.receipt !== undefined && !checks.offerSchema) {
    const parsedReceipt = Split402ReceiptV1Schema.safeParse(input.receipt);
    checks.receiptSchema = parsedReceipt.success;
    if (!parsedReceipt.success) {
      errors.push(
        ...parsedReceipt.error.issues.map(
          (issue) => `receipt.${issue.path.join(".") || "root"}: ${issue.message}`
        )
      );
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    checks
  };
}

export function parseValidateExternalX402ArtifactsArgs(
  argv: readonly string[]
): ValidateExternalX402ArtifactsCliInput | { help: true } {
  if (argv.includes("--help") || argv.includes("-h")) {
    return { help: true };
  }
  const input: ValidateExternalX402ArtifactsCliInput = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const value = readFollowingArg(argv, index, arg);
    if (arg === "--merchant-origin") {
      input.merchantOrigin = value;
    } else if (arg === "--operation-id") {
      input.operationId = value;
    } else if (arg === "--network") {
      input.network = value;
    } else if (arg === "--asset") {
      input.asset = value;
    } else if (arg === "--pay-to-wallet") {
      input.payToWallet = value;
    } else if (arg === "--required-amount-atomic") {
      input.requiredAmountAtomic = value;
    } else if (arg === "--merchant-public-key") {
      input.merchantPublicKey = value;
    } else if (arg === "--offer-file") {
      input.offerFile = value;
    } else if (arg === "--receipt-file") {
      input.receiptFile = value;
    } else if (arg === "--campaign-terms-file") {
      input.campaignTermsFile = value;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
    index += 1;
  }
  return input;
}

export async function runValidateExternalX402ArtifactsCli(
  argv: readonly string[]
): Promise<number> {
  const parsed = parseValidateExternalX402ArtifactsArgs(argv);
  if ("help" in parsed) {
    console.log(VALIDATE_EXTERNAL_X402_ARTIFACTS_USAGE);
    return 0;
  }
  const result = validateExternalX402Artifacts({
    merchantOrigin: required(parsed.merchantOrigin, "--merchant-origin"),
    operationId: required(parsed.operationId, "--operation-id"),
    network: required(parsed.network, "--network"),
    asset: required(parsed.asset, "--asset"),
    payToWallet: required(parsed.payToWallet, "--pay-to-wallet"),
    requiredAmountAtomic: required(
      parsed.requiredAmountAtomic,
      "--required-amount-atomic"
    ),
    merchantPublicKey: required(
      parsed.merchantPublicKey,
      "--merchant-public-key"
    ),
    offer: readJson(required(parsed.offerFile, "--offer-file")),
    ...(parsed.receiptFile === undefined
      ? {}
      : { receipt: readJson(parsed.receiptFile) }),
    ...(parsed.campaignTermsFile === undefined
      ? {}
      : { campaignTerms: readJson(parsed.campaignTermsFile) })
  });
  console.log(JSON.stringify(result, null, 2));
  return result.ok ? 0 : 2;
}

export const VALIDATE_EXTERNAL_X402_ARTIFACTS_USAGE = `Usage:
  corepack pnpm demo:validate-external-x402-artifacts -- \\
    --merchant-origin <origin> \\
    --operation-id <operationId> \\
    --network <network> \\
    --asset <asset> \\
    --pay-to-wallet <wallet-or-address> \\
    --required-amount-atomic <amount> \\
    --merchant-public-key <base58-public-key> \\
    --offer-file offer.json \\
    [--campaign-terms-file campaign-terms.json] \\
    [--receipt-file receipt.json]

This validates public Split402 artifacts against the external x402 route
metadata. When campaign terms are supplied, it recomputes the canonical terms
hash and compares it to the signed offer and optional receipt. It never needs
merchant private keys, bearer tokens, raw payment payloads, or facilitator
secrets.`;

function validateReceipt(
  input: ValidateExternalX402ArtifactsInput,
  offer: Split402OfferV1,
  errors: string[],
  checks: ValidateExternalX402ArtifactsResult["checks"]
): void {
  const parsedReceipt = Split402ReceiptV1Schema.safeParse(input.receipt);
  checks.receiptSchema = parsedReceipt.success;
  if (!parsedReceipt.success) {
    errors.push(
      ...parsedReceipt.error.issues.map(
        (issue) => `receipt.${issue.path.join(".") || "root"}: ${issue.message}`
      )
    );
    return;
  }
  const receipt = parsedReceipt.data;
  const receiptVerification = verifySplit402Receipt(
    receipt,
    input.merchantPublicKey
  );
  checks.receiptSignatureAndArithmetic = receiptVerification.ok;
  errors.push(
    ...prefixErrors("receipt.signature_or_arithmetic", receiptVerification.errors)
  );

  const receiptMatchErrors = validateReceiptAgainstOfferAndPayment(
    receipt,
    offer,
    input
  );
  checks.receiptMatchesOfferAndPayment = receiptMatchErrors.length === 0;
  errors.push(...receiptMatchErrors);
}

function validateCampaignTermsHash(
  campaignTerms: unknown,
  offer: Split402OfferV1,
  receipt: unknown
): string[] {
  const errors: string[] = [];
  const campaignTermsHash = hashProtocolObject(campaignTerms);
  compare(
    errors,
    "campaignTermsHash",
    campaignTermsHash,
    offer.campaignTermsHash
  );
  if (receipt !== undefined) {
    const parsedReceipt = Split402ReceiptV1Schema.safeParse(receipt);
    if (parsedReceipt.success) {
      compare(
        errors,
        "receipt.campaignTermsHash",
        parsedReceipt.data.campaignTermsHash,
        campaignTermsHash
      );
    }
  }
  return errors;
}

function validateOfferAgainstExternalPayment(
  offer: Split402OfferV1,
  input: Pick<
    ValidateExternalX402ArtifactsInput,
    | "merchantOrigin"
    | "operationId"
    | "network"
    | "asset"
    | "payToWallet"
    | "requiredAmountAtomic"
  >
): string[] {
  const errors: string[] = [];
  compare(
    errors,
    "offer.resourceOrigin",
    normalizeOrigin(offer.resourceOrigin),
    normalizeOrigin(input.merchantOrigin)
  );
  compare(errors, "offer.operationId", offer.operationId, input.operationId);
  compare(errors, "offer.network", offer.network, input.network);
  compare(errors, "offer.asset", offer.asset, input.asset);
  compare(errors, "offer.payToWallet", offer.payToWallet, input.payToWallet);
  compare(
    errors,
    "offer.requiredAmountAtomic",
    offer.requiredAmountAtomic,
    input.requiredAmountAtomic
  );
  return errors;
}

function validateReceiptAgainstOfferAndPayment(
  receipt: Split402ReceiptV1,
  offer: Split402OfferV1,
  input: Pick<
    ValidateExternalX402ArtifactsInput,
    "merchantOrigin" | "operationId" | "network" | "asset" | "payToWallet"
  >
): string[] {
  const errors: string[] = [];
  compare(
    errors,
    "receipt.merchantOrigin",
    normalizeOrigin(receipt.merchantOrigin),
    normalizeOrigin(input.merchantOrigin)
  );
  compare(errors, "receipt.operationId", receipt.operationId, input.operationId);
  compare(errors, "receipt.network", receipt.network, input.network);
  compare(errors, "receipt.asset", receipt.asset, input.asset);
  compare(errors, "receipt.payToWallet", receipt.payToWallet, input.payToWallet);
  compare(errors, "receipt.merchantId", receipt.merchantId, offer.merchantId);
  compare(errors, "receipt.campaignId", receipt.campaignId, offer.campaignId);
  compare(
    errors,
    "receipt.campaignVersion",
    String(receipt.campaignVersion),
    String(offer.campaignVersion)
  );
  compare(
    errors,
    "receipt.campaignTermsHash",
    receipt.campaignTermsHash,
    offer.campaignTermsHash
  );
  compare(
    errors,
    "receipt.requiredAmountAtomic",
    receipt.requiredAmountAtomic,
    offer.requiredAmountAtomic
  );
  compare(errors, "receipt.commissionBps", String(receipt.commissionBps), String(offer.commissionBps));
  compare(
    errors,
    "receipt.protocolFeeBpsOfCommission",
    String(receipt.protocolFeeBpsOfCommission),
    String(offer.protocolFeeBpsOfCommission)
  );
  compare(errors, "receipt.settlementMode", receipt.settlementMode, offer.settlementMode);
  compare(errors, "receipt.offerNonce", receipt.offerNonce, offer.offerNonce);
  compare(errors, "receipt.kid", receipt.kid, offer.kid);
  return errors;
}

function compare(
  errors: string[],
  label: string,
  actual: string,
  expected: string
): void {
  if (actual !== expected) {
    errors.push(`${label} mismatch: expected ${expected}, got ${actual}`);
  }
}

function prefixErrors(prefix: string, errors: string[]): string[] {
  return errors.map((error) => `${prefix}: ${error}`);
}

function normalizeOrigin(value: string): string {
  return value.replace(/\/+$/u, "");
}

function readFollowingArg(
  argv: readonly string[],
  index: number,
  flag: string
): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function required(value: string | undefined, flag: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${flag} is required`);
  }
  return value;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await runValidateExternalX402ArtifactsCli(
      process.argv.slice(2)
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
