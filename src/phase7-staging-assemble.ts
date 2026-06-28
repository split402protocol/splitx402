import { execFileSync } from "node:child_process";

import {
  PHASE7_STAGING_ATTACHMENT_FIELDS,
  assemblePhase7StagingProof,
  type Phase7StagingProofAssemblyInput,
} from "./phase7StagingProofAssembly.js";
import {
  REQUIRED_PHASE7_STAGING_FIELDS,
  phase7StagingProofEnvName,
  type Phase7StagingProofField,
  type Phase7StagingProofValues,
} from "./phase7StagingProof.js";

const env = process.env;

try {
  const values = readDirectValues();
  const input: Phase7StagingProofAssemblyInput = {
    values,
    attachments: readAttachmentPaths(),
  };

  console.log(assemblePhase7StagingProof(input));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(
    [
      "Usage: corepack pnpm phase7:staging:assemble",
      "Direct field override environment:",
      "  SPLIT402_PHASE7_* fields from .env.example",
      "  SPLIT402_PHASE7_SOURCE_COMMIT (optional; defaults to git rev-parse HEAD)",
      "Attachment path environment:",
      "  SPLIT402_PHASE7_ASSEMBLE_HOSTED_PREFLIGHT_EVIDENCE",
      "  SPLIT402_PHASE7_ASSEMBLE_AGENT_DISCOVERY_EVIDENCE",
      "  SPLIT402_PHASE7_ASSEMBLE_PAID_REQUEST_EVIDENCE",
      "  SPLIT402_PHASE7_ASSEMBLE_RECEIPT_VERIFICATION_EVIDENCE",
      "  SPLIT402_PHASE7_ASSEMBLE_REFERRER_BALANCE_EVIDENCE",
      "  SPLIT402_PHASE7_ASSEMBLE_DASHBOARD_SUMMARY_EVIDENCE",
      "  SPLIT402_PHASE7_ASSEMBLE_WEBHOOK_DELIVERY_EVIDENCE",
      "  SPLIT402_PHASE7_ASSEMBLE_PAYOUT_OBLIGATION_EVIDENCE",
      "  SPLIT402_PHASE7_ASSEMBLE_FUNDING_BALANCE_EVIDENCE",
      "  SPLIT402_PHASE7_ASSEMBLE_MCP_BUNDLE_EVIDENCE",
      "  SPLIT402_PHASE7_ASSEMBLE_MCP_GATEWAY_EVIDENCE",
      "  SPLIT402_PHASE7_ASSEMBLE_ARTIFACT_MANIFEST_EVIDENCE",
      "  SPLIT402_PHASE7_ASSEMBLE_COMMANDS_RUN",
    ].join("\n"),
  );
  process.exitCode = 1;
}

function readDirectValues(): Phase7StagingProofValues {
  const values: Phase7StagingProofValues = {};
  const fields: readonly Phase7StagingProofField[] = [
    ...REQUIRED_PHASE7_STAGING_FIELDS,
    "approval_notes",
  ];
  for (const field of fields) {
    const value = readOptionalEnv(phase7StagingProofEnvName(field));
    if (value !== undefined) {
      values[field] = value;
    }
  }
  values.source_commit ??= readCurrentGitCommit();
  return values;
}

function readAttachmentPaths(): NonNullable<
  Phase7StagingProofAssemblyInput["attachments"]
> {
  return Object.fromEntries(
    PHASE7_STAGING_ATTACHMENT_FIELDS.map((field) => [
      field,
      readOptionalEnv(phase7AttachmentEnvName(field)),
    ]).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

function phase7AttachmentEnvName(field: string): string {
  return `SPLIT402_PHASE7_ASSEMBLE_${field.toUpperCase()}`;
}

function readOptionalEnv(envName: string): string | undefined {
  const value = env[envName];
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  return value.trim();
}

function readCurrentGitCommit(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}
