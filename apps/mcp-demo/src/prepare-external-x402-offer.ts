#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildOfferSigningBytes,
  bytesToHex,
  hashProtocolObject,
  Split402OfferV1Schema,
  type Split402OfferV1
} from "@split402/protocol";

type UnsignedSplit402OfferV1 = Omit<Split402OfferV1, "signature">;

export interface PrepareExternalX402OfferInput {
  campaignTerms: unknown;
  unsignedOffer: unknown;
}

export interface PrepareExternalX402OfferResult {
  ok: boolean;
  errors: string[];
  campaignTermsHash: `sha256:${string}`;
  offerToSign?: UnsignedSplit402OfferV1;
  offerSigningBytesHex?: string;
}

interface PrepareExternalX402OfferCliInput {
  campaignTermsFile?: string;
  unsignedOfferFile?: string;
  outputDir?: string;
}

const CAMPAIGN_TERMS_HASH_PLACEHOLDER =
  "sha256:<hash of finalized campaignTermsTemplate canonical JSON>";

export function prepareExternalX402Offer(
  input: PrepareExternalX402OfferInput
): PrepareExternalX402OfferResult {
  const errors: string[] = [];
  const campaignTermsHash = hashProtocolObject(input.campaignTerms);
  if (!isRecord(input.unsignedOffer)) {
    return {
      ok: false,
      errors: ["unsignedOffer must be an object"],
      campaignTermsHash
    };
  }
  if ("signature" in input.unsignedOffer) {
    errors.push("unsignedOffer must not include signature");
  }

  const preparedOffer = {
    ...input.unsignedOffer,
    campaignTermsHash
  };
  const parsedOffer = Split402OfferV1Schema.safeParse({
    ...preparedOffer,
    signature: "placeholder-signature"
  });
  if (!parsedOffer.success) {
    errors.push(
      ...parsedOffer.error.issues.map(
        (issue) => `offer.${issue.path.join(".") || "root"}: ${issue.message}`
      )
    );
  }

  errors.push(
    ...validateOfferMatchesCampaignTerms(
      preparedOffer,
      input.campaignTerms,
      campaignTermsHash
    )
  );

  if (errors.length > 0 || !parsedOffer.success) {
    return {
      ok: false,
      errors,
      campaignTermsHash
    };
  }

  const offerToSign = omitSignature(parsedOffer.data);
  return {
    ok: true,
    errors: [],
    campaignTermsHash,
    offerToSign,
    offerSigningBytesHex: bytesToHex(buildOfferSigningBytes(offerToSign))
  };
}

export function parsePrepareExternalX402OfferArgs(
  argv: readonly string[]
): PrepareExternalX402OfferCliInput | { help: true } {
  if (argv.includes("--help") || argv.includes("-h")) {
    return { help: true };
  }
  const input: PrepareExternalX402OfferCliInput = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const value = readFollowingArg(argv, index, arg);
    if (arg === "--campaign-terms-file") {
      input.campaignTermsFile = value;
    } else if (arg === "--unsigned-offer-file") {
      input.unsignedOfferFile = value;
    } else if (arg === "--output-dir") {
      input.outputDir = value;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
    index += 1;
  }
  return input;
}

export async function runPrepareExternalX402OfferCli(
  argv: readonly string[]
): Promise<number> {
  const parsed = parsePrepareExternalX402OfferArgs(argv);
  if ("help" in parsed) {
    console.log(PREPARE_EXTERNAL_X402_OFFER_USAGE);
    return 0;
  }
  const result = prepareExternalX402Offer({
    campaignTerms: readJson(
      required(parsed.campaignTermsFile, "--campaign-terms-file")
    ),
    unsignedOffer: readJson(
      required(parsed.unsignedOfferFile, "--unsigned-offer-file")
    )
  });
  if (parsed.outputDir !== undefined) {
    writePreparedOfferOutput(parsed.outputDir, result);
  }
  console.log(JSON.stringify(result, null, 2));
  return result.ok ? 0 : 2;
}

export const PREPARE_EXTERNAL_X402_OFFER_USAGE = `Usage:
  corepack pnpm demo:prepare-external-x402-offer -- \\
    --campaign-terms-file campaign-terms.json \\
    --unsigned-offer-file unsigned-offer.json \\
    [--output-dir prepared-offer]

This no-secret helper computes campaignTermsHash from finalized public campaign
terms, inserts it into the unsigned Split402 offer, and emits exact offer
signing bytes. It never needs merchant private keys, bearer tokens, raw payment
payloads, or facilitator secrets. Sign the emitted bytes outside this tool, set
the base64url signature on the offer, then validate with
demo:validate-external-x402-artifacts.`;

function writePreparedOfferOutput(
  outputDir: string,
  result: PrepareExternalX402OfferResult
): void {
  const resolvedOutputDir = resolveOutputPath(outputDir);
  mkdirSync(resolvedOutputDir, { recursive: true });
  writeFileSync(
    join(resolvedOutputDir, "prepare-result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8"
  );
  writeFileSync(
    join(resolvedOutputDir, "campaign-terms.hash.txt"),
    `${result.campaignTermsHash}\n`,
    "utf8"
  );
  if (result.offerToSign !== undefined) {
    writeFileSync(
      join(resolvedOutputDir, "offer-to-sign.json"),
      `${JSON.stringify(result.offerToSign, null, 2)}\n`,
      "utf8"
    );
  }
  if (result.offerSigningBytesHex !== undefined) {
    writeFileSync(
      join(resolvedOutputDir, "offer-signing-bytes.hex"),
      `${result.offerSigningBytesHex}\n`,
      "utf8"
    );
  }
  writeFileSync(
    join(resolvedOutputDir, "README.md"),
    [
      "# Split402 Offer Signing Inputs",
      "",
      "These files contain public signing inputs only.",
      "",
      "- `campaign-terms.hash.txt`: canonical hash of finalized campaign terms.",
      "- `offer-to-sign.json`: unsigned offer with the computed campaign terms hash inserted.",
      "- `offer-signing-bytes.hex`: exact domain-separated bytes to sign with the merchant offer_receipt key.",
      "",
      "After signing, set the base64url signature on the offer and run `demo:validate-external-x402-artifacts`.",
      "",
      "Do not place private keys, bearer tokens, raw payment payloads, facilitator secrets, or private settlement evidence in this directory.",
      ""
    ].join("\n"),
    "utf8"
  );
}

function validateOfferMatchesCampaignTerms(
  offer: Record<string, unknown>,
  campaignTerms: unknown,
  campaignTermsHash: string
): string[] {
  const errors: string[] = [];
  if (!isRecord(campaignTerms)) {
    return ["campaignTerms must be an object"];
  }
  compare(errors, "offer.campaignTermsHash", readString(offer.campaignTermsHash), campaignTermsHash);
  const originalHash = readString(offer.campaignTermsHash);
  if (
    originalHash !== undefined &&
    originalHash !== CAMPAIGN_TERMS_HASH_PLACEHOLDER &&
    originalHash !== campaignTermsHash
  ) {
    errors.push(
      `unsignedOffer.campaignTermsHash mismatch: expected ${campaignTermsHash}, got ${originalHash}`
    );
  }
  compare(errors, "offer.campaignId", readString(offer.campaignId), readString(campaignTerms.campaignId));
  compare(
    errors,
    "offer.campaignVersion",
    readNumber(offer.campaignVersion),
    readNumber(campaignTerms.campaignVersion)
  );
  compare(errors, "offer.merchantId", readString(offer.merchantId), readString(campaignTerms.merchantId));
  compare(
    errors,
    "offer.resourceOrigin",
    readString(offer.resourceOrigin),
    readString(campaignTerms.resourceOrigin)
  );
  compare(errors, "offer.network", readString(offer.network), readString(campaignTerms.network));
  compare(errors, "offer.asset", readString(offer.asset), readString(campaignTerms.asset));
  compare(
    errors,
    "offer.requiredAmountAtomic",
    readString(offer.requiredAmountAtomic),
    readString(campaignTerms.requiredAmountAtomic)
  );
  compare(
    errors,
    "offer.payToWallet",
    readString(offer.payToWallet),
    readString(campaignTerms.payToWallet)
  );
  compare(
    errors,
    "offer.commissionBps",
    readNumber(offer.commissionBps),
    readNumber(campaignTerms.commissionBps)
  );
  compare(
    errors,
    "offer.protocolFeeBpsOfCommission",
    readNumber(offer.protocolFeeBpsOfCommission),
    readNumber(campaignTerms.protocolFeeBpsOfCommission)
  );
  compare(
    errors,
    "offer.commissionBase",
    readString(offer.commissionBase),
    readString(campaignTerms.commissionBase)
  );
  compare(
    errors,
    "offer.settlementMode",
    readString(offer.settlementMode),
    readString(campaignTerms.settlementMode)
  );
  compare(
    errors,
    "offer.attributionRequired",
    readBoolean(offer.attributionRequired),
    readBoolean(campaignTerms.attributionRequired)
  );
  compare(
    errors,
    "offer.allowSelfReferral",
    readBoolean(offer.allowSelfReferral),
    readBoolean(campaignTerms.allowSelfReferral)
  );
  const operationIds = campaignTerms.operationIds;
  if (Array.isArray(operationIds)) {
    const operationId = readString(offer.operationId);
    if (
      operationId !== undefined &&
      !operationIds.includes(operationId) &&
      !operationIds.includes("*")
    ) {
      errors.push(
        `offer.operationId mismatch: expected one of ${operationIds.join(", ")}, got ${operationId}`
      );
    }
  }
  return errors;
}

function omitSignature(offer: Split402OfferV1): UnsignedSplit402OfferV1 {
  const copy: Partial<Split402OfferV1> = { ...offer };
  delete copy.signature;
  return copy as UnsignedSplit402OfferV1;
}

function compare<T>(
  errors: string[],
  label: string,
  actual: T | undefined,
  expected: T | undefined
): void {
  if (actual !== undefined && expected !== undefined && actual !== expected) {
    errors.push(`${label} mismatch: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
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

function resolveOutputPath(outputPath: string): string {
  return isAbsolute(outputPath)
    ? outputPath
    : resolve(process.env.INIT_CWD ?? process.cwd(), outputPath);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await runPrepareExternalX402OfferCli(
      process.argv.slice(2)
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
