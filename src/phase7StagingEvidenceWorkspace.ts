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
        "MCP gateway stdio transcript showing router-backed discovery, execution, and receipt lookup.",
    },
    {
      field: "artifact_manifest_evidence",
      fileName: "artifact-manifest.json",
      purpose: "SHA-256 manifest for the reviewed local evidence files.",
    },
    {
      field: "commands_run",
      fileName: "commands.log",
      purpose:
        "Command transcript containing Phase 7 evidence commands and the full validation suite.",
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
    "# Uncomment and fill direct SPLIT402_PHASE7_* proof fields for this run.",
    "# SPLIT402_PHASE7_PROOF_ID=phase7-staging-YYYY-MM-DD",
    "# SPLIT402_PHASE7_PROOF_REVIEWERS=Split402 operators",
    "# SPLIT402_PHASE7_STAGING_ENVIRONMENT=hosted-devnet-public-alpha",
    "# SPLIT402_PHASE7_CONTROL_PLANE_URL=http://localhost:4021",
    "# SPLIT402_PHASE7_DASHBOARD_URL=http://localhost:4027",
    "# SPLIT402_PHASE7_DEMO_MERCHANT_URL=http://localhost:4023",
    "# SPLIT402_PHASE7_WEBHOOK_RECEIVER_URL=http://localhost:4040",
    "# SPLIT402_PHASE7_SOURCE_COMMIT defaults to git rev-parse HEAD when omitted.",
    "#",
    "# Runtime variables used by hosted proof collectors.",
    "# Keep filled tokens, private keys, and private URLs local; do not commit them.",
    "# SPLIT402_PHASE7_SEED_CONFIRM=seed-hosted-staging",
    "# SPLIT402_DATABASE_URL=postgresql://split402:split402@localhost:5432/split402",
    "# DATABASE_URL=postgresql://split402:split402@localhost:5432/split402",
    "# SPLIT402_PHASE7_CONTROL_PLANE_TOKEN=<merchant-session-token>",
    "# SPLIT402_PHASE7_MERCHANT_ID=<seed-output-merchant-id>",
    "# SPLIT402_PHASE7_REFERRER_WALLET=<seed-output-referrer-wallet>",
    "# SPLIT402_DASHBOARD_MERCHANT_ID=<seed-output-merchant-id>",
    "# SPLIT402_DASHBOARD_REFERRER_WALLET=<seed-output-referrer-wallet>",
    "# SPLIT402_DASHBOARD_VIEWER_TOKEN=<dashboard-viewer-token>",
    "# SPLIT402_MERCHANT_ORIGIN=http://localhost:4023",
    "# SPLIT402_MERCHANT_PUBLIC_KEY=<seed-output-service-public-key>",
    "#",
    "# Hosted control-plane funding evidence variables.",
    "# SPLIT402_FUNDING_BALANCE_PROVIDER=solana-rpc",
    "# SPLIT402_FUNDING_BALANCE_SOLANA_RPC_URL=https://api.devnet.solana.com",
    "# SPLIT402_FUNDING_BALANCE_SOLANA_RPC_URLS=<comma-separated-rpc-urls>",
    "# SPLIT402_FUNDING_BALANCE_TOKEN_PROGRAM_ID=<optional-token-program-id>",
    "#",
    "# MCP gateway hosted proof variables.",
    "# SPLIT402_MCP_CONTROL_PLANE_URL=http://localhost:4021",
    "# SPLIT402_MCP_CONTROL_PLANE_TOKEN=<merchant-session-token>",
    "# SPLIT402_MCP_CAPABILITY=solana.wallet-risk",
    "# SPLIT402_MCP_WALLET=<wallet-to-score>",
    "# SPLIT402_MCP_MAX_AMOUNT_ATOMIC=50000",
    "# SPLIT402_MCP_RESOURCE_ORIGIN=http://localhost:4023",
    "# SPLIT402_MCP_OPERATION_ID=wallet-risk-score",
    "# SPLIT402_MCP_DISCOVERY_LIMIT=10",
    "# SPLIT402_PHASE7_MCP_GATEWAY_EXECUTE=1",
    "# SPLIT402_MCP_SVM_PRIVATE_KEY=<funded-devnet-buyer-private-key>",
    "# SVM_PRIVATE_KEY=<funded-devnet-buyer-private-key>",
    "# The status checker will fail until each attached artifact file exists.",
    `SPLIT402_PHASE7_EVIDENCE_DIR=${directory}`,
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
    "git rev-parse HEAD",
    "git status --short --branch",
    "SPLIT402_PHASE7_SEED_CONFIRM=seed-hosted-staging corepack pnpm phase7:staging:seed",
    "corepack pnpm phase7:staging-proof > phase7-staging-proof.txt",
    "corepack pnpm phase7:hosted:preflight",
    "# Confirm hosted control plane has SPLIT402_FUNDING_BALANCE_PROVIDER=solana-rpc.",
    "corepack pnpm phase7:staging:collect-reads",
    "# Fill SPLIT402_MCP_* hosted proof variables and use a funded buyer key.",
    "SPLIT402_PHASE7_MCP_GATEWAY_EXECUTE=1 corepack pnpm phase7:staging:collect-mcp-gateway",
    "corepack pnpm demo:mcp-gateway:smoke",
    `corepack pnpm demo:mcp-bundle > ${directory}/mcp-bundle.json`,
    `corepack pnpm demo:paid-suite > ${directory}/paid-suite.log`,
    "corepack pnpm phase7:staging:derive-receipt-verification",
    `corepack pnpm phase7:staging:manifest phase7-staging-proof.txt > ${directory}/artifact-manifest.json`,
    `corepack pnpm phase7:staging:assemble > phase7-staging-proof.txt`,
    `corepack pnpm phase7:staging:status phase7-staging-proof.txt`,
    "```",
    "",
    "Record the commands above plus lint, typecheck, test, build,",
    "vectors:check, and audit in `commands.log`. The MCP gateway collector",
    "report should include providerId, maxAmountAtomic, providerAmountAtomic,",
    "providerPayToWallet, payToWallet, amountPaidAtomic, receiptId,",
    "receiptVerificationStatus, referrerCreditAtomic, routeId, commissionBps,",
    "protocolFeeBpsOfCommission, commissionAmountAtomic, and protocolFeeAtomic.",
    "The transcript should include the selected provider payToWallet and a",
    "matching receipt payToWallet.",
    "The staging seed prints `proofEnv`; copy those values into",
    "`phase7-staging.env` before running hosted collectors.",
    "The proof remains no-go until",
    "all artifacts are real hosted staging evidence from the same source commit.",
    "`phase7:staging-proof` and `phase7:staging:assemble` fill `source_commit`",
    "from `SPLIT402_PHASE7_SOURCE_COMMIT` when set, otherwise from the current",
    "git commit.",
    "`phase7:hosted:preflight` writes `hosted-preflight.json` into",
    "`SPLIT402_PHASE7_HOSTED_PREFLIGHT_OUTPUT_DIR`, `SPLIT402_PHASE7_EVIDENCE_DIR`,",
    "or the default evidence directory.",
    "Funding-balance evidence requires the hosted control plane to run with",
    "`SPLIT402_FUNDING_BALANCE_PROVIDER=solana-rpc`; otherwise the read",
    "collector will reject unresolved funding status.",
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
