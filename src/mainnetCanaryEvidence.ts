import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import {
  MAINNET_CANARY_MAX_GROSS_AMOUNT_ATOMIC,
  MAINNET_CANARY_NETWORK,
  MAINNET_CANARY_NON_ATOMIC_ACKNOWLEDGEMENT,
} from "./mainnetCanaryPlan.js";

export type MainnetCanaryEvidenceKind = "dry_run" | "rollback_plan";

export interface MainnetCanaryEvidenceVerificationResult {
  ok: boolean;
  errors: string[];
  path?: string;
}

export interface VerifyMainnetCanaryEvidenceAttachmentInput {
  kind: MainnetCanaryEvidenceKind;
  value?: string;
  expectedScope?: MainnetCanaryEvidenceExpectedScope;
  workspaceDirectory?: string;
  exists?: (path: string) => boolean;
  readText?: (path: string) => string;
}

export interface MainnetCanaryEvidenceExpectedScope {
  merchantId?: string;
  campaignId?: string;
  routeId?: string;
  payerWallet?: string;
  maxGrossAmountAtomic?: string;
}

const DRY_RUN_SCHEMA = "split402.mainnet_canary_dry_run.v1";
const ROLLBACK_SCHEMA = "split402.mainnet_canary_rollback_plan.v1";

const COMMON_REQUIRED_FIELDS = [
  "canary_id",
  "review_date",
  "source_commit",
  "network",
  "merchant_id",
  "campaign_id",
  "route_id",
  "payer_wallet",
  "max_gross_amount_atomic",
  "non_atomic_acknowledgement",
] as const;

const DRY_RUN_PASS_FIELDS = [
  "dry_run_status",
  "receipt_verification",
  "economic_policy_verification",
  "chain_verification",
  "payout_dry_run",
  "signer_byte_verification",
] as const;

const ROLLBACK_REQUIRED_FIELDS = [
  "stop_loss_amount_atomic",
  "rollback_owner",
  "rollback_steps",
  "reconciliation_owner",
  "reviewer",
] as const;

export function createMainnetCanaryDryRunEvidenceTemplate(input: {
  sourceCommit?: string;
  reviewDate?: string;
} = {}): string {
  return [
    `schema: ${DRY_RUN_SCHEMA}`,
    "canary_id: mainnet-canary-001",
    `review_date: ${input.reviewDate ?? "YYYY-MM-DD"}`,
    `source_commit: ${input.sourceCommit ?? "0000000"}`,
    `network: ${MAINNET_CANARY_NETWORK}`,
    "merchant_id:",
    "campaign_id:",
    "route_id:",
    "payer_wallet:",
    `max_gross_amount_atomic: ${MAINNET_CANARY_MAX_GROSS_AMOUNT_ATOMIC}`,
    `non_atomic_acknowledgement: ${MAINNET_CANARY_NON_ATOMIC_ACKNOWLEDGEMENT}`,
    "dry_run_status: pending",
    "receipt_verification: pending",
    "economic_policy_verification: pending",
    "chain_verification: pending",
    "payout_dry_run: pending",
    "signer_byte_verification: pending",
    "reviewer:",
    "notes: scaffold only; replace with private dry-run evidence before approval",
    "",
  ].join("\n");
}

export function createMainnetCanaryRollbackPlanTemplate(input: {
  sourceCommit?: string;
  reviewDate?: string;
} = {}): string {
  return [
    `schema: ${ROLLBACK_SCHEMA}`,
    "canary_id: mainnet-canary-001",
    `review_date: ${input.reviewDate ?? "YYYY-MM-DD"}`,
    `source_commit: ${input.sourceCommit ?? "0000000"}`,
    `network: ${MAINNET_CANARY_NETWORK}`,
    "merchant_id:",
    "campaign_id:",
    "route_id:",
    "payer_wallet:",
    `max_gross_amount_atomic: ${MAINNET_CANARY_MAX_GROSS_AMOUNT_ATOMIC}`,
    `non_atomic_acknowledgement: ${MAINNET_CANARY_NON_ATOMIC_ACKNOWLEDGEMENT}`,
    "stop_loss_amount_atomic:",
    "rollback_owner:",
    "rollback_steps:",
    "stop_conditions_reviewed: no",
    "reconciliation_owner:",
    "reviewer:",
    "notes: scaffold only; replace with private rollback evidence before approval",
    "",
  ].join("\n");
}

export function verifyMainnetCanaryEvidenceAttachment(
  input: VerifyMainnetCanaryEvidenceAttachmentInput,
): MainnetCanaryEvidenceVerificationResult {
  const parsed = parseAttachedPath(input.value);
  if (parsed === undefined) {
    return {
      ok: false,
      errors: [
        "evidence must use `attached: <path>` and must not contain a placeholder",
      ],
    };
  }

  const path = resolveEvidencePath(parsed, input.workspaceDirectory);
  const exists = input.exists ?? existsSync;
  if (!exists(path)) {
    return {
      ok: false,
      path,
      errors: [`attached evidence file does not exist: ${path}`],
    };
  }

  const readText = input.readText ?? ((candidatePath) => readFileSync(candidatePath, "utf8"));
  return verifyEvidenceText({
    expectedScope: input.expectedScope,
    kind: input.kind,
    path,
    text: readText(path),
  });
}

function verifyEvidenceText(input: {
  expectedScope?: MainnetCanaryEvidenceExpectedScope;
  kind: MainnetCanaryEvidenceKind;
  path: string;
  text: string;
}): MainnetCanaryEvidenceVerificationResult {
  const fields = parseRecordFields(input.text);
  const errors: string[] = [];
  const expectedSchema =
    input.kind === "dry_run" ? DRY_RUN_SCHEMA : ROLLBACK_SCHEMA;

  requireExactField(errors, fields, "schema", expectedSchema);
  for (const field of COMMON_REQUIRED_FIELDS) {
    requireFilledField(errors, fields, field);
  }
  requireExactField(errors, fields, "network", MAINNET_CANARY_NETWORK);
  requireExactField(
    errors,
    fields,
    "non_atomic_acknowledgement",
    MAINNET_CANARY_NON_ATOMIC_ACKNOWLEDGEMENT,
  );
  validateReviewDate(errors, fields.get("review_date"));
  validateSourceCommit(errors, fields.get("source_commit"));
  validateAmountCap(errors, fields.get("max_gross_amount_atomic"));
  validateExpectedScope(errors, fields, input.expectedScope);

  if (input.kind === "dry_run") {
    for (const field of DRY_RUN_PASS_FIELDS) {
      requireExactField(errors, fields, field, "passed");
    }
    requireFilledField(errors, fields, "reviewer");
  } else {
    for (const field of ROLLBACK_REQUIRED_FIELDS) {
      requireFilledField(errors, fields, field);
    }
    requireExactField(errors, fields, "stop_conditions_reviewed", "yes");
  }

  return {
    ok: errors.length === 0,
    errors,
    path: input.path,
  };
}

function parseAttachedPath(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const match = /^attached:\s*(.+)$/iu.exec(value.trim());
  const path = match?.[1]?.trim();
  if (
    path === undefined ||
    path.length === 0 ||
    path.toLowerCase() === "pending" ||
    /[<>]/u.test(path)
  ) {
    return undefined;
  }
  return path;
}

function resolveEvidencePath(path: string, workspaceDirectory: string | undefined): string {
  if (isAbsolute(path) || workspaceDirectory === undefined) {
    return path;
  }
  return join(workspaceDirectory, path);
}

function parseRecordFields(text: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of text.split(/\r?\n/u)) {
    const match = /^([a-z][a-z0-9_]*):\s*(.*)$/u.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      fields.set(match[1], match[2].trim());
    }
  }
  return fields;
}

function requireFilledField(
  errors: string[],
  fields: ReadonlyMap<string, string>,
  field: string,
): void {
  const value = fields.get(field);
  if (value === undefined || value.length === 0 || isPlaceholder(value)) {
    errors.push(`${field} must be filled`);
  }
}

function requireExactField(
  errors: string[],
  fields: ReadonlyMap<string, string>,
  field: string,
  expected: string,
): void {
  const value = fields.get(field);
  if (value !== expected) {
    errors.push(`${field} must be ${expected}`);
  }
}

function validateAmountCap(errors: string[], value: string | undefined): void {
  if (value === undefined || !/^[1-9][0-9]*$/u.test(value)) {
    errors.push("max_gross_amount_atomic must be a positive atomic amount");
    return;
  }
  if (BigInt(value) > BigInt(MAINNET_CANARY_MAX_GROSS_AMOUNT_ATOMIC)) {
    errors.push(
      `max_gross_amount_atomic must be <= ${MAINNET_CANARY_MAX_GROSS_AMOUNT_ATOMIC}`,
    );
  }
}

function validateExpectedScope(
  errors: string[],
  fields: ReadonlyMap<string, string>,
  expectedScope: MainnetCanaryEvidenceExpectedScope | undefined,
): void {
  if (expectedScope === undefined) {
    return;
  }
  const comparisons = [
    ["merchant_id", expectedScope.merchantId],
    ["campaign_id", expectedScope.campaignId],
    ["route_id", expectedScope.routeId],
    ["payer_wallet", expectedScope.payerWallet],
    ["max_gross_amount_atomic", expectedScope.maxGrossAmountAtomic],
  ] as const;
  for (const [field, expected] of comparisons) {
    if (expected !== undefined && fields.get(field) !== expected) {
      errors.push(`${field} must match approved canary scope`);
    }
  }
}

function validateReviewDate(errors: string[], value: string | undefined): void {
  if (value === undefined || !isIsoCalendarDate(value)) {
    errors.push("review_date must be a valid YYYY-MM-DD calendar date");
  }
}

function validateSourceCommit(errors: string[], value: string | undefined): void {
  if (value === undefined || !/^[a-f0-9]{7,40}$/u.test(value)) {
    errors.push("source_commit must be a git SHA");
  }
}

function isIsoCalendarDate(value: string): boolean {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/u.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isPlaceholder(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "pending" ||
    normalized === "no" ||
    normalized === "no-go" ||
    normalized === "yyyy-mm-dd" ||
    normalized === "0000000" ||
    /[<>]/u.test(value)
  );
}
