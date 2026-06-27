import {
  PHASE7_STAGING_ATTACHMENT_FIELDS,
  type Phase7StagingAttachmentField,
} from "./phase7StagingProofAssembly.js";

export interface Phase7StagingEvidenceArtifact {
  field: Phase7StagingAttachmentField;
  fileName: string;
  purpose: string;
}

export interface Phase7StagingEvidenceWorkspace {
  directory: string;
  envFileName: string;
  readmeFileName: string;
  artifacts: readonly Phase7StagingEvidenceArtifact[];
  envText: string;
  readmeText: string;
}

const PHASE7_STAGING_EVIDENCE_ARTIFACTS: readonly Phase7StagingEvidenceArtifact[] =
  [
    {
      field: "hosted_preflight_evidence",
      fileName: "hosted-preflight.json",
      purpose: "Hosted stack preflight proving health and dashboard viewer gate.",
    },
    {
      field: "agent_discovery_evidence",
      fileName: "agent-discovery.json",
      purpose: "Route discovery response observed by the agent or MCP client.",
    },
    {
      field: "paid_request_evidence",
      fileName: "paid-suite.log",
      purpose: "x402 paid-suite output for the same staging environment.",
    },
    {
      field: "receipt_verification_evidence",
      fileName: "receipt-verification.json",
      purpose: "Split402 receipt verification output for the paid request.",
    },
    {
      field: "referrer_balance_evidence",
      fileName: "referrer-balances.json",
      purpose: "Referrer balance or payout read proving credited earnings.",
    },
    {
      field: "dashboard_summary_evidence",
      fileName: "dashboard-summary.json",
      purpose: "Merchant dashboard summary response from staging.",
    },
    {
      field: "webhook_delivery_evidence",
      fileName: "webhook-events.json",
      purpose: "Webhook delivery feed showing accepted staging events.",
    },
    {
      field: "payout_obligation_evidence",
      fileName: "payout-obligations.json",
      purpose: "Merchant payout-obligation response from staging.",
    },
    {
      field: "funding_balance_evidence",
      fileName: "funding-balance.json",
      purpose: "Payout obligations showing Solana RPC covered/deficit status.",
    },
    {
      field: "mcp_bundle_evidence",
      fileName: "mcp-bundle.json",
      purpose: "MCP demo bundle output for the paid tool card.",
    },
    {
      field: "mcp_gateway_evidence",
      fileName: "mcp-gateway.jsonl",
      purpose:
        "MCP gateway stdio transcript showing router-backed discovery or execution.",
    },
    {
      field: "artifact_manifest_evidence",
      fileName: "artifact-manifest.json",
      purpose: "SHA-256 manifest for the reviewed local evidence files.",
    },
    {
      field: "commands_run",
      fileName: "commands.log",
      purpose: "Command transcript for the staging proof run.",
    },
  ];

export function createPhase7StagingEvidenceWorkspace(input: {
  directory?: string;
} = {}): Phase7StagingEvidenceWorkspace {
  const directory = input.directory ?? "phase7-staging-evidence";
  const envFileName = "phase7-staging.env";
  const readmeFileName = "README.md";
  const envText = createEnvText(directory);
  const readmeText = createReadmeText(directory);
  return {
    directory,
    envFileName,
    readmeFileName,
    artifacts: PHASE7_STAGING_EVIDENCE_ARTIFACTS,
    envText,
    readmeText,
  };
}

function createEnvText(directory: string): string {
  return [
    "# Source this file after filling the direct SPLIT402_PHASE7_* proof fields.",
    "# The status checker will fail until each attached artifact file exists.",
    ...PHASE7_STAGING_EVIDENCE_ARTIFACTS.map(
      (artifact) =>
        `${phase7AttachmentEnvName(artifact.field)}=${directory}/${artifact.fileName}`,
    ),
    "",
  ].join("\n");
}

function createReadmeText(directory: string): string {
  return [
    "# Phase 7 Staging Evidence",
    "",
    "Capture real hosted staging outputs into this directory. Do not create",
    "placeholder artifact files just to satisfy the status checker.",
    "",
    "| File | Field | Purpose |",
    "| --- | --- | --- |",
    ...PHASE7_STAGING_EVIDENCE_ARTIFACTS.map(
      (artifact) =>
        `| \`${artifact.fileName}\` | \`${artifact.field}\` | ${artifact.purpose} |`,
    ),
    "",
    "Typical flow:",
    "",
    "```bash",
    `corepack pnpm phase7:staging:assemble > phase7-staging-proof.txt`,
    `corepack pnpm phase7:staging:status phase7-staging-proof.txt`,
    "```",
    "",
    `Expected evidence directory: \`${directory}\``,
    "",
  ].join("\n");
}

function phase7AttachmentEnvName(field: Phase7StagingAttachmentField): string {
  if (!PHASE7_STAGING_ATTACHMENT_FIELDS.includes(field)) {
    throw new Error(`unknown Phase 7 attachment field: ${field}`);
  }
  return `SPLIT402_PHASE7_ASSEMBLE_${field.toUpperCase()}`;
}
