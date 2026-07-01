#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildReceiptSigningBytes,
  bytesToHex,
  calculateCommission,
  Split402OfferV1Schema,
  Split402ReceiptV1Schema,
  verifyReceiptArithmetic,
  type Split402OfferV1,
  type Split402ReceiptV1
} from "@split402/protocol";

type UnsignedSplit402ReceiptV1 = Omit<Split402ReceiptV1, "signature">;

export interface PrepareExternalX402ReceiptInput {
  offer: unknown;
  unsignedReceipt: unknown;
}

export interface PrepareExternalX402ReceiptResult {
  ok: boolean;
  errors: string[];
  receiptToSign?: UnsignedSplit402ReceiptV1;
  receiptSigningBytesHex?: string;
}

interface PrepareExternalX402ReceiptCliInput {
  offerFile?: string;
  unsignedReceiptFile?: string;
  outputDir?: string;
}

export function prepareExternalX402Receipt(
  input: PrepareExternalX402ReceiptInput
): PrepareExternalX402ReceiptResult {
  const errors: string[] = [];
  const parsedOffer = Split402OfferV1Schema.safeParse(input.offer);
  if (!parsedOffer.success) {
    errors.push(
      ...parsedOffer.error.issues.map(
        (issue) => `offer.${issue.path.join(".") || "root"}: ${issue.message}`
      )
    );
  }
  if (!isRecord(input.unsignedReceipt)) {
    return {
      ok: false,
      errors: [...errors, "unsignedReceipt must be an object"]
    };
  }
  if ("signature" in input.unsignedReceipt) {
    errors.push("unsignedReceipt must not include signature");
  }
  if (!parsedOffer.success) {
    return { ok: false, errors };
  }

  const receiptDraft = prepareReceiptDraft(input.unsignedReceipt, parsedOffer.data);
  const parsedReceipt = Split402ReceiptV1Schema.safeParse({
    ...receiptDraft,
    signature: "placeholder-signature"
  });
  if (!parsedReceipt.success) {
    errors.push(
      ...parsedReceipt.error.issues.map(
        (issue) => `receipt.${issue.path.join(".") || "root"}: ${issue.message}`
      )
    );
  }
  if (parsedReceipt.success) {
    errors.push(...verifyReceiptArithmetic(parsedReceipt.data).errors);
  }
  if (errors.length > 0 || !parsedReceipt.success) {
    return { ok: false, errors };
  }

  const receiptToSign = omitSignature(parsedReceipt.data);
  return {
    ok: true,
    errors: [],
    receiptToSign,
    receiptSigningBytesHex: bytesToHex(buildReceiptSigningBytes(receiptToSign))
  };
}

export function parsePrepareExternalX402ReceiptArgs(
  argv: readonly string[]
): PrepareExternalX402ReceiptCliInput | { help: true } {
  if (argv.includes("--help") || argv.includes("-h")) {
    return { help: true };
  }
  const input: PrepareExternalX402ReceiptCliInput = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const value = readFollowingArg(argv, index, arg);
    if (arg === "--offer-file") {
      input.offerFile = value;
    } else if (arg === "--unsigned-receipt-file") {
      input.unsignedReceiptFile = value;
    } else if (arg === "--output-dir") {
      input.outputDir = value;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
    index += 1;
  }
  return input;
}

export async function runPrepareExternalX402ReceiptCli(
  argv: readonly string[]
): Promise<number> {
  const parsed = parsePrepareExternalX402ReceiptArgs(argv);
  if ("help" in parsed) {
    console.log(PREPARE_EXTERNAL_X402_RECEIPT_USAGE);
    return 0;
  }
  const result = prepareExternalX402Receipt({
    offer: readJson(required(parsed.offerFile, "--offer-file")),
    unsignedReceipt: readJson(
      required(parsed.unsignedReceiptFile, "--unsigned-receipt-file")
    )
  });
  if (parsed.outputDir !== undefined) {
    writePreparedReceiptOutput(parsed.outputDir, result);
  }
  console.log(JSON.stringify(result, null, 2));
  return result.ok ? 0 : 2;
}

export const PREPARE_EXTERNAL_X402_RECEIPT_USAGE = `Usage:
  corepack pnpm demo:prepare-external-x402-receipt -- \\
    --offer-file offer.json \\
    --unsigned-receipt-file unsigned-receipt.json \\
    [--output-dir prepared-receipt]

This no-secret helper binds a finalized unsigned Split402 receipt to the signed
offer, recomputes commission/protocol-fee/referrer-credit arithmetic, and emits
exact receipt signing bytes. It never needs merchant private keys, bearer
tokens, raw payment payloads, or facilitator secrets. Sign the emitted bytes
outside this tool, set the base64url signature on the receipt, then validate
with demo:validate-external-x402-artifacts.`;

function prepareReceiptDraft(
  unsignedReceipt: Record<string, unknown>,
  offer: Split402OfferV1
): Record<string, unknown> {
  const economics = calculateCommission(
    BigInt(offer.requiredAmountAtomic),
    BigInt(offer.commissionBps),
    BigInt(offer.protocolFeeBpsOfCommission)
  );
  return {
    ...unsignedReceipt,
    merchantId: offer.merchantId,
    merchantOrigin: offer.resourceOrigin,
    operationId: offer.operationId,
    campaignId: offer.campaignId,
    campaignVersion: offer.campaignVersion,
    campaignTermsHash: offer.campaignTermsHash,
    network: offer.network,
    asset: offer.asset,
    payToWallet: offer.payToWallet,
    requiredAmountAtomic: offer.requiredAmountAtomic,
    commissionBps: offer.commissionBps,
    protocolFeeBpsOfCommission: offer.protocolFeeBpsOfCommission,
    commissionBaseAtomic: offer.requiredAmountAtomic,
    commissionAmountAtomic: economics.commission.toString(),
    protocolFeeAtomic: economics.protocolFee.toString(),
    referrerCreditAtomic: economics.referrerCredit.toString(),
    settlementMode: offer.settlementMode,
    offerNonce: offer.offerNonce,
    kid: offer.kid
  };
}

function writePreparedReceiptOutput(
  outputDir: string,
  result: PrepareExternalX402ReceiptResult
): void {
  const resolvedOutputDir = resolveOutputPath(outputDir);
  mkdirSync(resolvedOutputDir, { recursive: true });
  writeFileSync(
    join(resolvedOutputDir, "prepare-result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8"
  );
  if (result.receiptToSign !== undefined) {
    writeFileSync(
      join(resolvedOutputDir, "receipt-to-sign.json"),
      `${JSON.stringify(result.receiptToSign, null, 2)}\n`,
      "utf8"
    );
  }
  if (result.receiptSigningBytesHex !== undefined) {
    writeFileSync(
      join(resolvedOutputDir, "receipt-signing-bytes.hex"),
      `${result.receiptSigningBytesHex}\n`,
      "utf8"
    );
  }
  writeFileSync(
    join(resolvedOutputDir, "README.md"),
    [
      "# Split402 Receipt Signing Inputs",
      "",
      "These files contain public signing inputs only.",
      "",
      "- `receipt-to-sign.json`: unsigned receipt bound to the signed offer with recomputed commission arithmetic.",
      "- `receipt-signing-bytes.hex`: exact domain-separated bytes to sign with the merchant offer_receipt key.",
      "",
      "After signing, set the base64url signature on the receipt and run `demo:validate-external-x402-artifacts`.",
      "",
      "Do not place private keys, bearer tokens, raw payment payloads, facilitator secrets, or private settlement evidence in this directory.",
      ""
    ].join("\n"),
    "utf8"
  );
}

function omitSignature(receipt: Split402ReceiptV1): UnsignedSplit402ReceiptV1 {
  const copy: Partial<Split402ReceiptV1> = { ...receipt };
  delete copy.signature;
  return copy as UnsignedSplit402ReceiptV1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    process.exitCode = await runPrepareExternalX402ReceiptCli(
      process.argv.slice(2)
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
