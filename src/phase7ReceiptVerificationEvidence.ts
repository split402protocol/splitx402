import { decodeArtifactText } from "./artifactEncoding.js";

export interface Phase7ReceiptVerificationEvidenceInput {
  paidSuiteLogPath: string;
  outputPath: string;
  readArtifact: (path: string) => Uint8Array | string;
  writeArtifact: (path: string, text: string) => void;
  now?: string;
}

export interface Phase7ReceiptVerificationEvidence {
  schema: "split402.phase7_receipt_verification_evidence.v1";
  generatedAt: string;
  sourceLogPath: string;
  receiptId: string;
  verificationStatus: "verified";
  split402ReceiptVerified: true;
  errors: [];
  validReceipt: Phase7PaidSuiteReceiptSummary;
  invalidClaimReceipt: Phase7PaidSuiteReceiptSummary;
}

export interface Phase7PaidSuiteReceiptSummary {
  receiptId: string;
  paymentId: string;
  commissionBps: number;
  commissionAmountAtomic: string;
  referrerCreditAtomic: string;
  settlementTxSignature: string;
  routeId?: string;
}

export function derivePhase7ReceiptVerificationEvidence(
  input: Phase7ReceiptVerificationEvidenceInput,
): Phase7ReceiptVerificationEvidence {
  const text = readArtifactText(input.readArtifact(input.paidSuiteLogPath));
  const summary = readPaidSuiteSummary(text);
  const validReceipt = readReceiptSummary(summary.validReceipt, "validReceipt");
  const invalidClaimReceipt = readReceiptSummary(
    summary.invalidReceipt,
    "invalidReceipt",
  );
  if (summary.paidSuitePassed !== true) {
    throw new Error("paid-suite summary did not report paidSuitePassed: true");
  }
  if (validReceipt.commissionBps <= 0) {
    throw new Error("validReceipt must be commission-bearing");
  }
  if (readPositiveAtomic(validReceipt.commissionAmountAtomic) === undefined) {
    throw new Error("validReceipt commissionAmountAtomic must be positive");
  }
  if (readPositiveAtomic(validReceipt.referrerCreditAtomic) === undefined) {
    throw new Error("validReceipt referrerCreditAtomic must be positive");
  }
  if (validReceipt.routeId === undefined || validReceipt.routeId.length === 0) {
    throw new Error("validReceipt routeId is required");
  }
  if (invalidClaimReceipt.commissionBps !== 0) {
    throw new Error("invalidReceipt commissionBps must be zero");
  }
  if (
    invalidClaimReceipt.commissionAmountAtomic !== "0" ||
    invalidClaimReceipt.referrerCreditAtomic !== "0"
  ) {
    throw new Error("invalidReceipt commission and referrer credit must be zero");
  }

  const evidence: Phase7ReceiptVerificationEvidence = {
    schema: "split402.phase7_receipt_verification_evidence.v1",
    generatedAt: input.now ?? new Date().toISOString(),
    sourceLogPath: input.paidSuiteLogPath,
    receiptId: validReceipt.receiptId,
    verificationStatus: "verified",
    split402ReceiptVerified: true,
    errors: [],
    validReceipt,
    invalidClaimReceipt,
  };
  input.writeArtifact(input.outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

function readPaidSuiteSummary(text: string): Record<string, unknown> {
  const markerIndex = text.lastIndexOf('"paidSuitePassed"');
  if (markerIndex < 0) {
    throw new Error("paid-suite log does not contain a paidSuitePassed summary");
  }
  const start = text.lastIndexOf("{", markerIndex);
  if (start < 0) {
    throw new Error("paid-suite log summary JSON object was not found");
  }
  const end = findJsonObjectEnd(text, start);
  if (end === undefined) {
    throw new Error("paid-suite log summary JSON object is incomplete");
  }
  const parsed = JSON.parse(text.slice(start, end + 1));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("paid-suite summary must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function readReceiptSummary(
  value: unknown,
  label: string,
): Phase7PaidSuiteReceiptSummary {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  const record = value as Record<string, unknown>;
  const summary = {
    receiptId: readNonEmptyString(record.receiptId, `${label}.receiptId`),
    paymentId: readNonEmptyString(record.paymentId, `${label}.paymentId`),
    commissionBps: readNonNegativeInteger(
      record.commissionBps,
      `${label}.commissionBps`,
    ),
    commissionAmountAtomic: readAtomicString(
      record.commissionAmountAtomic,
      `${label}.commissionAmountAtomic`,
    ),
    referrerCreditAtomic: readAtomicString(
      record.referrerCreditAtomic,
      `${label}.referrerCreditAtomic`,
    ),
    settlementTxSignature: readNonEmptyString(
      record.settlementTxSignature,
      `${label}.settlementTxSignature`,
    ),
    ...(typeof record.routeId === "string" && record.routeId.length > 0
      ? { routeId: record.routeId }
      : {}),
  };
  return summary;
}

function readArtifactText(value: Uint8Array | string): string {
  return decodeArtifactText(value);
}

function readNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function readNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || typeof value !== "number" || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

function readAtomicString(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/u.test(value)) {
    throw new Error(`${label} must be a non-negative atomic amount`);
  }
  return value;
}

function readPositiveAtomic(value: string): bigint | undefined {
  const parsed = BigInt(value);
  return parsed > 0n ? parsed : undefined;
}

function findJsonObjectEnd(text: string, start: number): number | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return undefined;
}
