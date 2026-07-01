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
  offer?: unknown;
  paymentRequiredExtension?: unknown;
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
  routeMetadataFile?: string;
  merchantPublicKey?: string;
  offerFile?: string;
  paymentRequiredExtensionFile?: string;
  receiptFile?: string;
  campaignTermsFile?: string;
}

interface ExternalX402RouteMetadataInput {
  merchantOrigin?: string;
  operationId?: string;
  network?: string;
  asset?: string;
  payToWallet?: string;
  requiredAmountAtomic?: string;
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
  const resolvedOffer = resolveOfferForValidation(input);
  errors.push(...resolvedOffer.errors);
  const parsedOffer = Split402OfferV1Schema.safeParse(resolvedOffer.offer);
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
    } else if (arg === "--route-metadata-file") {
      input.routeMetadataFile = value;
    } else if (arg === "--merchant-public-key") {
      input.merchantPublicKey = value;
    } else if (arg === "--offer-file") {
      input.offerFile = value;
    } else if (arg === "--payment-required-extension-file") {
      input.paymentRequiredExtensionFile = value;
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
  const routeMetadata =
    parsed.routeMetadataFile === undefined
      ? {}
      : readExternalX402RouteMetadata(parsed.routeMetadataFile);
  const result = validateExternalX402Artifacts({
    merchantOrigin: readRouteValue(
      parsed.merchantOrigin,
      routeMetadata.merchantOrigin,
      "--merchant-origin"
    ),
    operationId: readRouteValue(
      parsed.operationId,
      routeMetadata.operationId,
      "--operation-id"
    ),
    network: readRouteValue(parsed.network, routeMetadata.network, "--network"),
    asset: readRouteValue(parsed.asset, routeMetadata.asset, "--asset"),
    payToWallet: readRouteValue(
      parsed.payToWallet,
      routeMetadata.payToWallet,
      "--pay-to-wallet"
    ),
    requiredAmountAtomic: readRouteValue(
      parsed.requiredAmountAtomic,
      routeMetadata.requiredAmountAtomic,
      "--required-amount-atomic"
    ),
    merchantPublicKey: required(
      parsed.merchantPublicKey,
      "--merchant-public-key"
    ),
    ...(parsed.offerFile === undefined
      ? {}
      : { offer: readJson(parsed.offerFile) }),
    ...(parsed.paymentRequiredExtensionFile === undefined
      ? {}
      : {
          paymentRequiredExtension: readJson(
            parsed.paymentRequiredExtensionFile
          )
        }),
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
    [--route-metadata-file route-metadata.json] \\
    [--merchant-origin <origin>] \\
    [--operation-id <operationId>] \\
    [--network <network>] \\
    [--asset <asset>] \\
    [--pay-to-wallet <wallet-or-address>] \\
    [--required-amount-atomic <amount>] \\
    --merchant-public-key <base58-public-key> \\
    [--offer-file offer.json] \\
    [--payment-required-extension-file payment-required-extension.json] \\
    [--campaign-terms-file campaign-terms.json] \\
    [--receipt-file receipt.json]

This validates public Split402 artifacts against the external x402 route
metadata. Provide either a signed offer JSON or a payment-required extension
wrapper containing extensions.split402.info. When campaign terms are supplied,
it recomputes the canonical terms hash and compares it to the signed offer and
optional receipt. It never needs merchant private keys, bearer tokens, raw
payment payloads, or facilitator secrets.`;

function resolveOfferForValidation(input: ValidateExternalX402ArtifactsInput): {
  offer: unknown;
  errors: string[];
} {
  if (input.paymentRequiredExtension === undefined) {
    if (input.offer === undefined) {
      return {
        offer: undefined,
        errors: ["offer or paymentRequiredExtension is required"]
      };
    }
    return { offer: input.offer, errors: [] };
  }
  const extensionOffer = readSplit402InfoFromPaymentRequiredExtension(
    input.paymentRequiredExtension
  );
  if (input.offer === undefined || extensionOffer.offer === undefined) {
    return extensionOffer;
  }
  if (JSON.stringify(input.offer) !== JSON.stringify(extensionOffer.offer)) {
    return {
      offer: input.offer,
      errors: [
        "offer conflicts with paymentRequiredExtension.extensions.split402.info"
      ]
    };
  }
  return { offer: input.offer, errors: extensionOffer.errors };
}

function readSplit402InfoFromPaymentRequiredExtension(value: unknown): {
  offer: unknown;
  errors: string[];
} {
  if (typeof value !== "object" || value === null) {
    return {
      offer: undefined,
      errors: ["paymentRequiredExtension must be an object"]
    };
  }
  const record = value as Record<string, unknown>;
  const extensions = readRecord(record.extensions);
  const split402 = readRecord(extensions?.split402);
  if (split402?.info === undefined) {
    return {
      offer: undefined,
      errors: [
        "paymentRequiredExtension.extensions.split402.info is required"
      ]
    };
  }
  return { offer: split402.info, errors: [] };
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readExternalX402RouteMetadata(
  path: string
): ExternalX402RouteMetadataInput {
  const value = readJson(path);
  if (typeof value !== "object" || value === null) {
    throw new Error("--route-metadata-file must contain a JSON object");
  }
  const record = value as Record<string, unknown>;
  const metadata: ExternalX402RouteMetadataInput = {};
  setOptionalRouteMetadataValue(
    metadata,
    "merchantOrigin",
    record.merchantOrigin
  );
  setOptionalRouteMetadataValue(metadata, "operationId", record.operationId);
  setOptionalRouteMetadataValue(metadata, "network", record.network);
  setOptionalRouteMetadataValue(metadata, "asset", record.asset);
  setOptionalRouteMetadataValue(metadata, "payToWallet", record.payToWallet);
  setOptionalRouteMetadataValue(
    metadata,
    "requiredAmountAtomic",
    record.requiredAmountAtomic
  );
  return metadata;
}

function readRouteValue(
  flagValue: string | undefined,
  metadataValue: string | undefined,
  flag: string
): string {
  if (
    flagValue !== undefined &&
    metadataValue !== undefined &&
    flagValue !== metadataValue
  ) {
    throw new Error(
      `${flag} conflicts with --route-metadata-file: expected ${metadataValue}, got ${flagValue}`
    );
  }
  return required(flagValue ?? metadataValue, flag);
}

function readOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`route metadata ${label} must be a non-empty string`);
  }
  return value;
}

function setOptionalRouteMetadataValue(
  metadata: ExternalX402RouteMetadataInput,
  key: keyof ExternalX402RouteMetadataInput,
  value: unknown
): void {
  const parsed = readOptionalString(value, key);
  if (parsed !== undefined) {
    metadata[key] = parsed;
  }
}

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
