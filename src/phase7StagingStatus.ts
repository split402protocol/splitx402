import { createHash } from "node:crypto";

import {
  PHASE7_EVIDENCE_FIELDS,
  type Phase7StagingProofValidation,
  parsePhase7ProofRecord,
  validatePhase7StagingProof,
} from "./phase7StagingProof.js";

export const PHASE7_STAGING_COMMANDS = [
  {
    gate: "evidence_workspace",
    command: "corepack pnpm phase7:staging:init",
    evidenceField: "commands_run",
  },
  {
    gate: "proof_scaffold",
    command: "corepack pnpm phase7:staging-proof",
    evidenceField: "proof_id",
  },
  {
    gate: "control_plane_read_capture",
    command: "corepack pnpm phase7:staging:collect-reads",
    evidenceField: "dashboard_summary_evidence",
  },
  {
    gate: "hosted_staging_preflight",
    command: "corepack pnpm phase7:hosted:preflight",
    evidenceField: "hosted_preflight_evidence",
  },
  {
    gate: "proof_assembly",
    command: "corepack pnpm phase7:staging:assemble",
    evidenceField: "commands_run",
  },
  {
    gate: "artifact_manifest",
    command: "corepack pnpm phase7:staging:manifest <phase7-staging-proof.txt>",
    evidenceField: "artifact_manifest_evidence",
  },
  {
    gate: "dashboard_smoke",
    command: "corepack pnpm dashboard",
    evidenceField: "dashboard_url",
  },
  {
    gate: "mcp_bundle",
    command: "corepack pnpm demo:mcp-bundle",
    evidenceField: "mcp_bundle_evidence",
  },
  {
    gate: "mcp_gateway",
    command: "corepack pnpm phase7:staging:collect-mcp-gateway",
    evidenceField: "mcp_gateway_evidence",
  },
  {
    gate: "agent_paid_suite",
    command: "corepack pnpm demo:paid-suite",
    evidenceField: "paid_request_evidence",
  },
  {
    gate: "control_plane_reads",
    command:
      "curl the Phase 7 control-plane read APIs from docs/PHASE_7.md and attach responses",
    evidenceField: "dashboard_summary_evidence",
  },
  {
    gate: "funding_balance",
    command:
      "run the payout-obligations read with SPLIT402_FUNDING_BALANCE_PROVIDER=solana-rpc and attach covered/deficit evidence",
    evidenceField: "funding_balance_evidence",
  },
  {
    gate: "proof_validation",
    command: "corepack pnpm phase7:staging:status <phase7-staging-proof.txt>",
    evidenceField: "approval_decision",
  },
] as const;

export interface Phase7StagingStatusReport {
  schema: "split402.phase7_staging_status.v1";
  readyForPublicAlphaDemo: boolean;
  proofChecked: boolean;
  commands: typeof PHASE7_STAGING_COMMANDS;
  gateStatuses: Phase7StagingGateStatus[];
  artifactStatuses: Phase7StagingArtifactStatus[];
  manifestStatus: Phase7StagingManifestStatus;
  hostedPreflightStatus: Phase7HostedPreflightStatus;
  fundingBalanceStatus: Phase7FundingBalanceStatus;
  mcpBundleStatus: Phase7McpBundleStatus;
  mcpGatewayStatus: Phase7McpGatewayStatus;
  validation?: Phase7StagingProofValidation;
  nextActions: string[];
}

export interface Phase7StagingGateStatus {
  gate: (typeof PHASE7_STAGING_COMMANDS)[number]["gate"];
  evidenceField: (typeof PHASE7_STAGING_COMMANDS)[number]["evidenceField"];
  status: "not_checked" | "ready" | "missing" | "placeholder" | "invalid";
  blockers: string[];
}

export interface Phase7StagingStatusOptions {
  artifactBaseDir?: string;
  artifactExists?: (path: string) => boolean;
  readArtifact?: (path: string) => Uint8Array;
  resolveArtifactPath?: (path: string, baseDir: string) => string;
}

export interface Phase7StagingArtifactStatus {
  evidenceField: (typeof PHASE7_EVIDENCE_FIELDS)[number];
  reference?: string;
  artifactPath?: string;
  status: "not_checked" | "remote" | "present" | "missing" | "not_applicable";
  blockers: string[];
}

export interface Phase7StagingManifestStatus {
  status: "not_checked" | "not_applicable" | "valid" | "invalid";
  blockers: string[];
}

export interface Phase7HostedPreflightStatus {
  status: "not_checked" | "not_applicable" | "valid" | "invalid";
  blockers: string[];
}

export interface Phase7FundingBalanceStatus {
  status: "not_checked" | "not_applicable" | "valid" | "invalid";
  blockers: string[];
}

export interface Phase7McpBundleStatus {
  status: "not_checked" | "not_applicable" | "valid" | "invalid";
  blockers: string[];
}

export interface Phase7McpGatewayStatus {
  status: "not_checked" | "not_applicable" | "valid" | "invalid";
  blockers: string[];
}

export function createPhase7StagingStatusReport(
  proofText?: string,
  options: Phase7StagingStatusOptions = {},
): Phase7StagingStatusReport {
  const validation =
    proofText === undefined ? undefined : validatePhase7StagingProof(proofText);
  const artifactStatuses = createArtifactStatuses(proofText, options);
  const manifestStatus = createManifestStatus(proofText, options);
  const hostedPreflightStatus = createHostedPreflightStatus(proofText, options);
  const fundingBalanceStatus = createFundingBalanceStatus(proofText, options);
  const mcpBundleStatus = createMcpBundleStatus(proofText, options);
  const mcpGatewayStatus = createMcpGatewayStatus(proofText, options);
  const artifactBlockers = artifactStatuses.flatMap((status) => status.blockers);
  const manifestBlockers = manifestStatus.blockers;
  const hostedPreflightBlockers = hostedPreflightStatus.blockers;
  const fundingBalanceBlockers = fundingBalanceStatus.blockers;
  const mcpBundleBlockers = mcpBundleStatus.blockers;
  const mcpGatewayBlockers = mcpGatewayStatus.blockers;
  const readyForPublicAlphaDemo =
    (validation?.approved ?? false) &&
    artifactBlockers.length === 0 &&
    manifestBlockers.length === 0 &&
    hostedPreflightBlockers.length === 0 &&
    fundingBalanceBlockers.length === 0 &&
    mcpBundleBlockers.length === 0 &&
    mcpGatewayBlockers.length === 0;

  return {
    schema: "split402.phase7_staging_status.v1",
    readyForPublicAlphaDemo,
    proofChecked: validation !== undefined,
    commands: PHASE7_STAGING_COMMANDS,
    gateStatuses: createGateStatuses(
      validation,
      artifactStatuses,
      manifestBlockers,
      hostedPreflightBlockers,
      fundingBalanceBlockers,
      mcpBundleBlockers,
      mcpGatewayBlockers,
    ),
    artifactStatuses,
    manifestStatus,
    hostedPreflightStatus,
    fundingBalanceStatus,
    mcpBundleStatus,
    mcpGatewayStatus,
    validation,
    nextActions: createNextActions(validation, [
      ...artifactBlockers,
      ...manifestBlockers,
      ...hostedPreflightBlockers,
      ...fundingBalanceBlockers,
      ...mcpBundleBlockers,
      ...mcpGatewayBlockers,
    ]),
  };
}

function createGateStatuses(
  validation: Phase7StagingProofValidation | undefined,
  artifactStatuses: readonly Phase7StagingArtifactStatus[],
  manifestBlockers: readonly string[],
  hostedPreflightBlockers: readonly string[],
  fundingBalanceBlockers: readonly string[],
  mcpBundleBlockers: readonly string[],
  mcpGatewayBlockers: readonly string[],
): Phase7StagingGateStatus[] {
  return PHASE7_STAGING_COMMANDS.map((command) => {
    if (validation === undefined) {
      return {
        gate: command.gate,
        evidenceField: command.evidenceField,
        status: "not_checked",
        blockers: [],
      };
    }

    const invalidBlockers = validation.invalidFields.filter((field) =>
      field.startsWith(`${command.evidenceField} `),
    );
    const artifactBlockers = artifactStatuses
      .filter((status) => status.evidenceField === command.evidenceField)
      .flatMap((status) => status.blockers);
    const gateArtifactBlockers = createGateArtifactBlockers(
      command.evidenceField,
      artifactBlockers,
      manifestBlockers,
      hostedPreflightBlockers,
      fundingBalanceBlockers,
      mcpBundleBlockers,
      mcpGatewayBlockers,
    );
    if (validation.missingFields.includes(command.evidenceField)) {
      return {
        gate: command.gate,
        evidenceField: command.evidenceField,
        status: "missing",
        blockers: [`${command.evidenceField} is missing`],
      };
    }
    if (validation.placeholderFields.includes(command.evidenceField)) {
      return {
        gate: command.gate,
        evidenceField: command.evidenceField,
        status: "placeholder",
        blockers: [`${command.evidenceField} is a placeholder`],
      };
    }
    if (invalidBlockers.length > 0) {
      return {
        gate: command.gate,
        evidenceField: command.evidenceField,
        status: "invalid",
        blockers: invalidBlockers,
      };
    }
    if (gateArtifactBlockers.length > 0) {
      return {
        gate: command.gate,
        evidenceField: command.evidenceField,
        status: "invalid",
        blockers: gateArtifactBlockers,
      };
    }
    return {
      gate: command.gate,
      evidenceField: command.evidenceField,
      status: "ready",
      blockers: [],
    };
  });
}

function createGateArtifactBlockers(
  evidenceField: Phase7StagingGateStatus["evidenceField"],
  artifactBlockers: readonly string[],
  manifestBlockers: readonly string[],
  hostedPreflightBlockers: readonly string[],
  fundingBalanceBlockers: readonly string[],
  mcpBundleBlockers: readonly string[],
  mcpGatewayBlockers: readonly string[],
): string[] {
  if (evidenceField === "artifact_manifest_evidence") {
    return [...artifactBlockers, ...manifestBlockers];
  }
  if (evidenceField === "hosted_preflight_evidence") {
    return [...artifactBlockers, ...hostedPreflightBlockers];
  }
  if (evidenceField === "funding_balance_evidence") {
    return [...artifactBlockers, ...fundingBalanceBlockers];
  }
  if (evidenceField === "mcp_bundle_evidence") {
    return [...artifactBlockers, ...mcpBundleBlockers];
  }
  if (evidenceField === "mcp_gateway_evidence") {
    return [...artifactBlockers, ...mcpGatewayBlockers];
  }
  return [...artifactBlockers];
}

function createManifestStatus(
  proofText: string | undefined,
  options: Phase7StagingStatusOptions,
): Phase7StagingManifestStatus {
  if (proofText === undefined) {
    return { status: "not_checked", blockers: [] };
  }

  const fields = parsePhase7ProofRecord(proofText);
  const manifestReference = fields.get("artifact_manifest_evidence");
  if (manifestReference === undefined || manifestReference.length === 0) {
    return { status: "not_applicable", blockers: [] };
  }
  if (isHttpUrl(manifestReference)) {
    return { status: "not_checked", blockers: [] };
  }

  const manifestArtifactPath = readAttachedArtifactPath(manifestReference);
  if (manifestArtifactPath === undefined) {
    return { status: "not_applicable", blockers: [] };
  }
  if (options.artifactBaseDir === undefined || options.readArtifact === undefined) {
    return { status: "not_checked", blockers: [] };
  }

  const manifestPath = resolveArtifactPath(manifestArtifactPath, options);
  const blockers: string[] = [];
  let manifest: Phase7ArtifactManifest | undefined;
  try {
    const manifestBytes = options.readArtifact(manifestPath);
    manifest = JSON.parse(
      new TextDecoder().decode(manifestBytes),
    ) as Phase7ArtifactManifest;
  } catch (error) {
    blockers.push(
      `artifact_manifest_evidence artifact could not be read: ${formatError(error)}`,
    );
  }

  if (manifest === undefined) {
    return { status: "invalid", blockers };
  }
  if (manifest.schema !== "split402.phase7_artifact_manifest.v1") {
    blockers.push("artifact_manifest_evidence schema is invalid");
  }
  if (!Array.isArray(manifest.artifacts)) {
    blockers.push("artifact_manifest_evidence artifacts must be an array");
    return { status: "invalid", blockers };
  }

  const manifestEntries = new Map<string, Phase7ArtifactManifestEntry>();
  for (const entry of manifest.artifacts) {
    if (isManifestEntry(entry)) {
      manifestEntries.set(entry.evidenceField, entry);
    }
  }
  if (manifestEntries.has("artifact_manifest_evidence")) {
    blockers.push("artifact_manifest_evidence must not list itself");
  }

  for (const field of PHASE7_EVIDENCE_FIELDS) {
    if (field === "artifact_manifest_evidence") {
      continue;
    }
    const reference = fields.get(field);
    if (reference === undefined || reference.length === 0) {
      continue;
    }

    const entry = manifestEntries.get(field);
    if (entry === undefined) {
      blockers.push(`${field} is missing from artifact manifest`);
      continue;
    }
    if (entry.reference !== reference) {
      blockers.push(`${field} manifest reference does not match proof`);
    }
    if (isHttpUrl(reference)) {
      if (entry.kind !== "remote") {
        blockers.push(`${field} manifest entry must be remote`);
      }
      continue;
    }

    const artifactPath = readAttachedArtifactPath(reference);
    if (artifactPath === undefined) {
      continue;
    }
    if (entry.kind !== "local") {
      blockers.push(`${field} manifest entry must be local`);
      continue;
    }
    const resolvedPath = resolveArtifactPath(artifactPath, options);
    try {
      const artifactBytes = options.readArtifact(resolvedPath);
      const artifactSha256 = sha256(artifactBytes);
      if (entry.sha256 !== artifactSha256) {
        blockers.push(`${field} artifact hash does not match manifest`);
      }
      if (entry.sizeBytes !== artifactBytes.byteLength) {
        blockers.push(`${field} artifact size does not match manifest`);
      }
    } catch (error) {
      blockers.push(`${field} artifact could not be read: ${formatError(error)}`);
    }
  }

  return blockers.length === 0
    ? { status: "valid", blockers: [] }
    : { status: "invalid", blockers };
}

function createHostedPreflightStatus(
  proofText: string | undefined,
  options: Phase7StagingStatusOptions,
): Phase7HostedPreflightStatus {
  if (proofText === undefined) {
    return { status: "not_checked", blockers: [] };
  }

  const fields = parsePhase7ProofRecord(proofText);
  const reference = fields.get("hosted_preflight_evidence");
  if (reference === undefined || reference.length === 0) {
    return { status: "not_applicable", blockers: [] };
  }
  if (isHttpUrl(reference)) {
    return {
      status: "invalid",
      blockers: [
        "hosted_preflight_evidence must be an attached local artifact for status validation",
      ],
    };
  }

  const artifactPath = readAttachedArtifactPath(reference);
  if (artifactPath === undefined) {
    return { status: "not_applicable", blockers: [] };
  }
  if (options.artifactBaseDir === undefined || options.readArtifact === undefined) {
    return { status: "not_checked", blockers: [] };
  }

  const resolvedPath = resolveArtifactPath(artifactPath, options);
  const blockers: string[] = [];
  let preflight: Phase7HostedPreflightArtifact | undefined;
  try {
    const artifactBytes = options.readArtifact(resolvedPath);
    preflight = JSON.parse(
      new TextDecoder().decode(artifactBytes),
    ) as Phase7HostedPreflightArtifact;
  } catch (error) {
    blockers.push(
      `hosted_preflight_evidence artifact could not be read: ${formatError(error)}`,
    );
  }

  if (preflight === undefined) {
    return { status: "invalid", blockers };
  }
  if (preflight.schema !== "split402.phase7_hosted_staging_preflight.v1") {
    blockers.push("hosted_preflight_evidence schema is invalid");
  }
  const proofControlPlaneUrl = fields.get("control_plane_url");
  const proofDashboardUrl = fields.get("dashboard_url");
  if (typeof preflight.controlPlaneUrl !== "string") {
    blockers.push("hosted_preflight_evidence controlPlaneUrl is missing");
  } else if (
    proofControlPlaneUrl !== undefined &&
    normalizeHttpUrl(preflight.controlPlaneUrl) !== normalizeHttpUrl(proofControlPlaneUrl)
  ) {
    blockers.push("hosted_preflight_evidence controlPlaneUrl does not match proof");
  }
  if (typeof preflight.dashboardUrl !== "string") {
    blockers.push("hosted_preflight_evidence dashboardUrl is missing");
  } else if (
    proofDashboardUrl !== undefined &&
    normalizeHttpUrl(preflight.dashboardUrl) !== normalizeHttpUrl(proofDashboardUrl)
  ) {
    blockers.push("hosted_preflight_evidence dashboardUrl does not match proof");
  }
  if (!Array.isArray(preflight.checks)) {
    blockers.push("hosted_preflight_evidence checks must be an array");
    return { status: "invalid", blockers };
  }
  const failedChecks = preflight.checks.filter(
    (check) =>
      !isHostedPreflightCheck(check) ||
      check.ok !== true ||
      check.status !== check.expectedStatus,
  );
  if (failedChecks.length > 0) {
    blockers.push(
      `hosted_preflight_evidence has ${failedChecks.length} failed checks`,
    );
  }
  const checkNames = new Set(
    preflight.checks
      .filter(isHostedPreflightCheck)
      .map((check) => check.name),
  );
  for (const requiredCheck of [
    "control_plane_health",
    "dashboard_health",
    "dashboard_session",
    "dashboard_config_without_viewer",
    "dashboard_config_with_viewer",
  ]) {
    if (!checkNames.has(requiredCheck)) {
      blockers.push(`hosted_preflight_evidence missing ${requiredCheck}`);
    }
  }

  return blockers.length === 0
    ? { status: "valid", blockers: [] }
    : { status: "invalid", blockers };
}

function createFundingBalanceStatus(
  proofText: string | undefined,
  options: Phase7StagingStatusOptions,
): Phase7FundingBalanceStatus {
  if (proofText === undefined) {
    return { status: "not_checked", blockers: [] };
  }

  const fields = parsePhase7ProofRecord(proofText);
  const reference = fields.get("funding_balance_evidence");
  if (reference === undefined || reference.length === 0) {
    return { status: "not_applicable", blockers: [] };
  }
  if (isHttpUrl(reference)) {
    return {
      status: "invalid",
      blockers: [
        "funding_balance_evidence must be an attached local artifact for status validation",
      ],
    };
  }

  const artifactPath = readAttachedArtifactPath(reference);
  if (artifactPath === undefined) {
    return { status: "not_applicable", blockers: [] };
  }
  if (options.artifactBaseDir === undefined || options.readArtifact === undefined) {
    return { status: "not_checked", blockers: [] };
  }

  const resolvedPath = resolveArtifactPath(artifactPath, options);
  const blockers: string[] = [];
  let artifact: unknown;
  try {
    const artifactBytes = options.readArtifact(resolvedPath);
    artifact = JSON.parse(new TextDecoder().decode(artifactBytes));
  } catch (error) {
    blockers.push(
      `funding_balance_evidence artifact could not be read: ${formatError(error)}`,
    );
  }

  if (artifact === undefined) {
    return { status: "invalid", blockers };
  }

  const summary = readMerchantObligationSummary(artifact);
  if (summary === undefined) {
    blockers.push(
      "funding_balance_evidence must contain a merchant obligation summary",
    );
    return { status: "invalid", blockers };
  }
  if (summary.schema !== "split402.merchant_obligation_summary.v1") {
    blockers.push("funding_balance_evidence summary schema is invalid");
  }
  if (!Array.isArray(summary.assets)) {
    blockers.push("funding_balance_evidence summary assets must be an array");
    return { status: "invalid", blockers };
  }
  if (summary.assets.length === 0) {
    blockers.push("funding_balance_evidence summary must include at least one asset");
  }

  let hasCoveredOrDeficit = false;
  for (const [index, asset] of summary.assets.entries()) {
    if (typeof asset !== "object" || asset === null) {
      blockers.push(`funding_balance_evidence assets[${index}] is invalid`);
      continue;
    }
    const record = asset as Record<string, unknown>;
    const assetName =
      typeof record.asset === "string" && record.asset.trim().length > 0
        ? record.asset
        : `assets[${index}]`;
    const fundingStatus = record.fundingStatus;
    if (fundingStatus === "unknown") {
      blockers.push(
        `funding_balance_evidence ${assetName} fundingStatus is unknown`,
      );
      continue;
    }
    if (fundingStatus !== "covered" && fundingStatus !== "deficit") {
      blockers.push(
        `funding_balance_evidence ${assetName} fundingStatus must be covered or deficit`,
      );
      continue;
    }

    hasCoveredOrDeficit = true;
    const fundingAmount = readNonNegativeAtomicString(record.fundingAmountAtomic);
    if (fundingAmount === undefined) {
      blockers.push(
        `funding_balance_evidence ${assetName} fundingAmountAtomic must be a non-negative atomic amount`,
      );
    }
    const fundingDeficit = readNonNegativeAtomicString(
      record.fundingDeficitAtomic,
    );
    if (fundingDeficit === undefined) {
      blockers.push(
        `funding_balance_evidence ${assetName} fundingDeficitAtomic must be a non-negative atomic amount`,
      );
      continue;
    }
    if (fundingStatus === "covered" && fundingDeficit !== 0n) {
      blockers.push(
        `funding_balance_evidence ${assetName} covered status must have zero deficit`,
      );
    }
    if (fundingStatus === "deficit" && fundingDeficit <= 0n) {
      blockers.push(
        `funding_balance_evidence ${assetName} deficit status must report a positive deficit`,
      );
    }
  }

  if (!hasCoveredOrDeficit) {
    blockers.push(
      "funding_balance_evidence must include at least one asset with covered or deficit funding status",
    );
  }

  return blockers.length === 0
    ? { status: "valid", blockers: [] }
    : { status: "invalid", blockers };
}

function createMcpBundleStatus(
  proofText: string | undefined,
  options: Phase7StagingStatusOptions,
): Phase7McpBundleStatus {
  if (proofText === undefined) {
    return { status: "not_checked", blockers: [] };
  }

  const fields = parsePhase7ProofRecord(proofText);
  const reference = fields.get("mcp_bundle_evidence");
  if (reference === undefined || reference.length === 0) {
    return { status: "not_applicable", blockers: [] };
  }
  if (isHttpUrl(reference)) {
    return {
      status: "invalid",
      blockers: [
        "mcp_bundle_evidence must be an attached local artifact for status validation",
      ],
    };
  }

  const artifactPath = readAttachedArtifactPath(reference);
  if (artifactPath === undefined) {
    return { status: "not_applicable", blockers: [] };
  }
  if (options.artifactBaseDir === undefined || options.readArtifact === undefined) {
    return { status: "not_checked", blockers: [] };
  }

  const resolvedPath = resolveArtifactPath(artifactPath, options);
  const blockers: string[] = [];
  let bundle: unknown;
  try {
    const artifactBytes = options.readArtifact(resolvedPath);
    bundle = JSON.parse(new TextDecoder().decode(artifactBytes));
  } catch (error) {
    blockers.push(
      `mcp_bundle_evidence artifact could not be read: ${formatError(error)}`,
    );
  }

  if (bundle === undefined) {
    return { status: "invalid", blockers };
  }
  validateMcpBundleArtifact(bundle, blockers);
  return blockers.length === 0
    ? { status: "valid", blockers: [] }
    : { status: "invalid", blockers };
}

function validateMcpBundleArtifact(bundle: unknown, blockers: string[]): void {
  const record = readRecord(bundle);
  if (record === undefined) {
    blockers.push("mcp_bundle_evidence artifact must be a JSON object");
    return;
  }
  if (record.schemaVersion !== "split402.mcp-demo-bundle.v1") {
    blockers.push("mcp_bundle_evidence schemaVersion is invalid");
  }
  if (record.project !== "Split402") {
    blockers.push("mcp_bundle_evidence project must be Split402");
  }

  const mcp = readRecord(record.mcp);
  const tools = Array.isArray(mcp?.tools) ? mcp.tools : undefined;
  if (tools === undefined || tools.length === 0) {
    blockers.push("mcp_bundle_evidence must include at least one MCP tool");
    return;
  }

  const paidTool = tools
    .map((tool) => readRecord(tool))
    .find((tool) => tool?.name === "split402.walletRiskScore");
  if (paidTool === undefined) {
    blockers.push("mcp_bundle_evidence missing split402.walletRiskScore tool");
    return;
  }

  const paidHttpCall = readRecord(paidTool.paidHttpCall);
  if (paidHttpCall?.method !== "POST" || readNonEmptyString(paidHttpCall.url) === undefined) {
    blockers.push("mcp_bundle_evidence paid tool must describe a POST paidHttpCall");
  }

  const x402 = readRecord(paidTool.x402);
  if (x402?.scheme !== "exact") {
    blockers.push("mcp_bundle_evidence paid tool x402.scheme must be exact");
  }
  if (readNonEmptyString(x402?.network) === undefined) {
    blockers.push("mcp_bundle_evidence paid tool x402.network is missing");
  }
  if (readNonEmptyString(x402?.asset) === undefined) {
    blockers.push("mcp_bundle_evidence paid tool x402.asset is missing");
  }
  const amountAtomic = readPositiveAtomicString(x402?.amountAtomic);
  if (amountAtomic === undefined) {
    blockers.push(
      "mcp_bundle_evidence paid tool x402.amountAtomic must be a positive atomic amount",
    );
  }

  const split402 = readRecord(paidTool.split402);
  if (readNonEmptyString(split402?.campaignId) === undefined) {
    blockers.push("mcp_bundle_evidence paid tool split402.campaignId is missing");
  }
  if (readNonEmptyString(split402?.operationId) === undefined) {
    blockers.push("mcp_bundle_evidence paid tool split402.operationId is missing");
  }
  const commissionBps = readBasisPoints(split402?.commissionBps);
  if (commissionBps === undefined) {
    blockers.push(
      "mcp_bundle_evidence paid tool split402.commissionBps must be an integer from 0 to 10000",
    );
  }
  const protocolFeeBpsOfCommission = readBasisPoints(
    split402?.protocolFeeBpsOfCommission,
  );
  if (protocolFeeBpsOfCommission === undefined) {
    blockers.push(
      "mcp_bundle_evidence paid tool split402.protocolFeeBpsOfCommission must be an integer from 0 to 10000",
    );
  }

  const economics = readRecord(record.expectedEconomics);
  if (economics === undefined) {
    blockers.push("mcp_bundle_evidence expectedEconomics is missing");
    return;
  }
  const paymentAmount = readNonNegativeAtomicString(economics.paymentAmountAtomic);
  const commissionAmount = readNonNegativeAtomicString(
    economics.commissionAmountAtomic,
  );
  const protocolFee = readNonNegativeAtomicString(economics.protocolFeeAtomic);
  const referrerCredit = readNonNegativeAtomicString(
    economics.referrerCreditAtomic,
  );
  const merchantRetains = readNonNegativeAtomicString(
    economics.merchantRetainsAtomic,
  );

  for (const [field, value] of [
    ["paymentAmountAtomic", paymentAmount],
    ["commissionAmountAtomic", commissionAmount],
    ["protocolFeeAtomic", protocolFee],
    ["referrerCreditAtomic", referrerCredit],
    ["merchantRetainsAtomic", merchantRetains],
  ] as const) {
    if (value === undefined) {
      blockers.push(
        `mcp_bundle_evidence expectedEconomics.${field} must be a non-negative atomic amount`,
      );
    }
  }
  if (
    paymentAmount !== undefined &&
    amountAtomic !== undefined &&
    paymentAmount !== amountAtomic
  ) {
    blockers.push(
      "mcp_bundle_evidence expectedEconomics.paymentAmountAtomic must match x402.amountAtomic",
    );
  }
  if (
    commissionBps !== undefined &&
    economics.referrerCommissionBps !== commissionBps
  ) {
    blockers.push(
      "mcp_bundle_evidence expectedEconomics.referrerCommissionBps must match split402.commissionBps",
    );
  }
  if (
    protocolFeeBpsOfCommission !== undefined &&
    economics.protocolFeeBpsOfCommission !== protocolFeeBpsOfCommission
  ) {
    blockers.push(
      "mcp_bundle_evidence expectedEconomics.protocolFeeBpsOfCommission must match split402.protocolFeeBpsOfCommission",
    );
  }
  if (
    paymentAmount === undefined ||
    commissionBps === undefined ||
    protocolFeeBpsOfCommission === undefined ||
    commissionAmount === undefined ||
    protocolFee === undefined ||
    referrerCredit === undefined ||
    merchantRetains === undefined
  ) {
    return;
  }

  const expectedCommission = (paymentAmount * BigInt(commissionBps)) / 10_000n;
  const expectedProtocolFee =
    (expectedCommission * BigInt(protocolFeeBpsOfCommission)) / 10_000n;
  const expectedReferrerCredit = expectedCommission - expectedProtocolFee;
  const expectedMerchantRetains = paymentAmount - expectedCommission;
  if (commissionAmount !== expectedCommission) {
    blockers.push(
      "mcp_bundle_evidence expectedEconomics.commissionAmountAtomic does not match commission bps",
    );
  }
  if (protocolFee !== expectedProtocolFee) {
    blockers.push(
      "mcp_bundle_evidence expectedEconomics.protocolFeeAtomic does not match protocol fee bps",
    );
  }
  if (referrerCredit !== expectedReferrerCredit) {
    blockers.push(
      "mcp_bundle_evidence expectedEconomics.referrerCreditAtomic does not match commission minus protocol fee",
    );
  }
  if (merchantRetains !== expectedMerchantRetains) {
    blockers.push(
      "mcp_bundle_evidence expectedEconomics.merchantRetainsAtomic does not match payment minus commission",
    );
  }
}

function createMcpGatewayStatus(
  proofText: string | undefined,
  options: Phase7StagingStatusOptions,
): Phase7McpGatewayStatus {
  if (proofText === undefined) {
    return { status: "not_checked", blockers: [] };
  }

  const fields = parsePhase7ProofRecord(proofText);
  const reference = fields.get("mcp_gateway_evidence");
  if (reference === undefined || reference.length === 0) {
    return { status: "not_applicable", blockers: [] };
  }
  if (isHttpUrl(reference)) {
    return {
      status: "invalid",
      blockers: [
        "mcp_gateway_evidence must be an attached local artifact for status validation",
      ],
    };
  }

  const artifactPath = readAttachedArtifactPath(reference);
  if (artifactPath === undefined) {
    return { status: "not_applicable", blockers: [] };
  }
  if (options.artifactBaseDir === undefined || options.readArtifact === undefined) {
    return { status: "not_checked", blockers: [] };
  }

  const resolvedPath = resolveArtifactPath(artifactPath, options);
  const blockers: string[] = [];
  let lines: McpGatewayTranscriptLine[] = [];
  try {
    const artifactBytes = options.readArtifact(resolvedPath);
    const text = new TextDecoder().decode(artifactBytes);
    lines = parseMcpGatewayTranscript(text, blockers);
  } catch (error) {
    blockers.push(
      `mcp_gateway_evidence artifact could not be read: ${formatError(error)}`,
    );
  }

  if (blockers.length > 0) {
    return { status: "invalid", blockers };
  }
  validateMcpGatewayTranscript(lines, blockers);
  return blockers.length === 0
    ? { status: "valid", blockers: [] }
    : { status: "invalid", blockers };
}

function parseMcpGatewayTranscript(
  text: string,
  blockers: string[],
): McpGatewayTranscriptLine[] {
  const rows = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (rows.length === 0) {
    blockers.push("mcp_gateway_evidence transcript is empty");
    return [];
  }
  const lines: McpGatewayTranscriptLine[] = [];
  for (const [index, row] of rows.entries()) {
    try {
      const parsed = JSON.parse(row);
      if (isMcpGatewayTranscriptLine(parsed)) {
        lines.push(parsed);
      } else {
        blockers.push(`mcp_gateway_evidence line ${index + 1} is invalid`);
      }
    } catch (error) {
      blockers.push(
        `mcp_gateway_evidence line ${index + 1} is not valid JSON: ${formatError(error)}`,
      );
    }
  }
  return lines;
}

function validateMcpGatewayTranscript(
  lines: readonly McpGatewayTranscriptLine[],
  blockers: string[],
): void {
  const initializeRequest = findRequest(lines, (message) => message.method === "initialize");
  if (initializeRequest === undefined) {
    blockers.push("mcp_gateway_evidence missing initialize request");
  } else if (findResponse(lines, initializeRequest.message.id) === undefined) {
    blockers.push("mcp_gateway_evidence missing initialize response");
  }

  const toolsRequest = findRequest(lines, (message) => message.method === "tools/list");
  if (toolsRequest === undefined) {
    blockers.push("mcp_gateway_evidence missing tools/list request");
  } else if (findResponse(lines, toolsRequest.message.id) === undefined) {
    blockers.push("mcp_gateway_evidence missing tools/list response");
  }

  const searchRequest = findRequest(
    lines,
    (message) => readToolCallName(message) === "split402.searchCapabilities",
  );
  if (searchRequest === undefined) {
    blockers.push("mcp_gateway_evidence missing split402.searchCapabilities request");
  } else {
    const searchResponse = findResponse(lines, searchRequest.message.id);
    const capabilities = readStructuredArray(searchResponse, "capabilities");
    if (capabilities === undefined || capabilities.length === 0) {
      blockers.push("mcp_gateway_evidence search response has no capabilities");
    }
  }

  const executeRequest = findRequest(
    lines,
    (message) => readToolCallName(message) === "split402.execute",
  );
  if (executeRequest === undefined) {
    return;
  }

  const executeResponse = findResponse(lines, executeRequest.message.id);
  const executeContent = readStructuredContent(executeResponse);
  if (executeContent === undefined) {
    blockers.push("mcp_gateway_evidence execute response is missing structuredContent");
    return;
  }
  const receiptId = readNonEmptyString(executeContent.receiptId);
  for (const [field, value] of [
    ["providerId", executeContent.providerId],
    ["amountPaidAtomic", executeContent.amountPaidAtomic],
    ["receiptId", executeContent.receiptId],
    ["referrerCreditAtomic", executeContent.referrerCreditAtomic],
  ] as const) {
    if (readNonEmptyString(value) === undefined) {
      blockers.push(`mcp_gateway_evidence execute response missing ${field}`);
    }
  }
  if (executeContent.receiptVerificationStatus !== "verified") {
    blockers.push(
      "mcp_gateway_evidence execute response receiptVerificationStatus is not verified",
    );
  }
  if (receiptId === undefined) {
    return;
  }

  const receiptRequest = findRequest(
    lines,
    (message) =>
      readToolCallName(message) === "split402.getReceipt" &&
      readToolCallArguments(message)?.receiptId === receiptId,
  );
  if (receiptRequest === undefined) {
    blockers.push("mcp_gateway_evidence missing split402.getReceipt request");
    return;
  }
  const receiptResponse = findResponse(lines, receiptRequest.message.id);
  const receiptContent = readStructuredContent(receiptResponse);
  if (receiptContent?.receiptId !== receiptId || readRecord(receiptContent?.receipt) === undefined) {
    blockers.push("mcp_gateway_evidence getReceipt response does not match execute receiptId");
  }
}

function createArtifactStatuses(
  proofText: string | undefined,
  options: Phase7StagingStatusOptions,
): Phase7StagingArtifactStatus[] {
  if (proofText === undefined) {
    return PHASE7_EVIDENCE_FIELDS.map((field) => ({
      evidenceField: field,
      status: "not_checked",
      blockers: [],
    }));
  }

  const fields = parsePhase7ProofRecord(proofText);
  return PHASE7_EVIDENCE_FIELDS.map((field) => {
    const reference = fields.get(field);
    if (reference === undefined || reference.length === 0) {
      return {
        evidenceField: field,
        status: "not_applicable",
        blockers: [],
      };
    }
    if (isHttpUrl(reference)) {
      return {
        evidenceField: field,
        reference,
        status: "remote",
        blockers: [],
      };
    }
    const artifactPath = readAttachedArtifactPath(reference);
    if (artifactPath === undefined) {
      return {
        evidenceField: field,
        reference,
        status: "not_applicable",
        blockers: [],
      };
    }
    if (
      options.artifactBaseDir === undefined ||
      options.artifactExists === undefined
    ) {
      return {
        evidenceField: field,
        reference,
        artifactPath,
        status: "not_checked",
        blockers: [],
      };
    }
    const resolvedPath = resolveArtifactPath(artifactPath, options);
    if (options.artifactExists(resolvedPath)) {
      return {
        evidenceField: field,
        reference,
        artifactPath: resolvedPath,
        status: "present",
        blockers: [],
      };
    }
    return {
      evidenceField: field,
      reference,
      artifactPath: resolvedPath,
      status: "missing",
      blockers: [`${field} artifact is missing: ${resolvedPath}`],
    };
  });
}

function createNextActions(
  validation: Phase7StagingProofValidation | undefined,
  artifactBlockers: readonly string[],
): string[] {
  if (validation === undefined) {
    return [
      "Create the evidence workspace with corepack pnpm phase7:staging:init.",
      "Generate a proof scaffold with corepack pnpm phase7:staging-proof.",
      "Run the dashboard, MCP bundle, paid-suite, control-plane read checks, and funding-balance check against staging.",
      "Capture MCP gateway transcript evidence with corepack pnpm phase7:staging:collect-mcp-gateway.",
      "Run the hosted staging preflight with corepack pnpm phase7:hosted:preflight.",
      "Capture read API evidence with corepack pnpm phase7:staging:collect-reads.",
      "Generate artifact hashes with corepack pnpm phase7:staging:manifest <phase7-staging-proof.txt>.",
      "Attach response URLs, logs, or artifact paths with corepack pnpm phase7:staging:assemble.",
      "Run corepack pnpm phase7:staging:status <phase7-staging-proof.txt>.",
    ];
  }

  if (validation.approved) {
    if (artifactBlockers.length === 0) {
      return [
        "Phase 7 staging proof passes machine checks; proceed to launch review.",
      ];
    }
    return [...artifactBlockers];
  }

  const actions: string[] = [];
  if (validation.missingFields.length > 0) {
    actions.push(`Fill missing fields: ${validation.missingFields.join(", ")}`);
  }
  if (validation.placeholderFields.length > 0) {
    actions.push(
      `Replace placeholder fields: ${validation.placeholderFields.join(", ")}`,
    );
  }
  actions.push(...validation.invalidFields);
  actions.push(...artifactBlockers);
  return actions;
}

function resolveArtifactPath(
  artifactPath: string,
  options: Phase7StagingStatusOptions,
): string {
  return options.resolveArtifactPath === undefined
    ? `${options.artifactBaseDir}/${artifactPath}`
    : options.resolveArtifactPath(artifactPath, options.artifactBaseDir ?? ".");
}

function readAttachedArtifactPath(reference: string): string | undefined {
  const attachedPrefix = "attached:";
  if (!reference.startsWith(attachedPrefix)) {
    return undefined;
  }
  const artifactPath = reference.slice(attachedPrefix.length).trim();
  return artifactPath.length === 0 ? undefined : artifactPath;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    return url.toString().replace(/\/$/u, "");
  } catch {
    return undefined;
  }
}

interface Phase7ArtifactManifest {
  schema?: unknown;
  artifacts?: unknown;
}

interface Phase7ArtifactManifestEntry {
  evidenceField: string;
  reference: string;
  kind: "local" | "remote";
  artifactPath?: string;
  sizeBytes?: number;
  sha256?: string;
}

interface Phase7HostedPreflightArtifact {
  schema?: unknown;
  controlPlaneUrl?: unknown;
  dashboardUrl?: unknown;
  checks?: unknown;
}

interface Phase7HostedPreflightCheck {
  name: string;
  status: number;
  expectedStatus: number;
  ok: boolean;
}

interface Phase7MerchantObligationSummaryArtifact {
  schema?: unknown;
  assets?: unknown;
}

interface McpGatewayTranscriptLine {
  direction: "request" | "response";
  message: {
    id?: unknown;
    method?: unknown;
    params?: unknown;
    result?: unknown;
    error?: unknown;
  };
}

function isMcpGatewayTranscriptLine(value: unknown): value is McpGatewayTranscriptLine {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    (record.direction === "request" || record.direction === "response") &&
    typeof record.message === "object" &&
    record.message !== null
  );
}

function findRequest(
  lines: readonly McpGatewayTranscriptLine[],
  predicate: (message: McpGatewayTranscriptLine["message"]) => boolean,
): McpGatewayTranscriptLine | undefined {
  return lines.find(
    (line) =>
      line.direction === "request" &&
      predicate(line.message),
  );
}

function findResponse(
  lines: readonly McpGatewayTranscriptLine[],
  id: unknown,
): McpGatewayTranscriptLine | undefined {
  return lines.find(
    (line) =>
      line.direction === "response" &&
      line.message.id === id &&
      line.message.error === undefined,
  );
}

function readToolCallName(
  message: McpGatewayTranscriptLine["message"],
): string | undefined {
  if (message.method !== "tools/call") {
    return undefined;
  }
  const params = readRecord(message.params);
  const name = params?.name;
  return typeof name === "string" ? name : undefined;
}

function readToolCallArguments(
  message: McpGatewayTranscriptLine["message"],
): Record<string, unknown> | undefined {
  if (message.method !== "tools/call") {
    return undefined;
  }
  const params = readRecord(message.params);
  return readRecord(params?.arguments);
}

function readStructuredContent(
  response: McpGatewayTranscriptLine | undefined,
): Record<string, unknown> | undefined {
  const result = readRecord(response?.message.result);
  return readRecord(result?.structuredContent);
}

function readStructuredArray(
  response: McpGatewayTranscriptLine | undefined,
  key: string,
): unknown[] | undefined {
  const structuredContent = readStructuredContent(response);
  const value = structuredContent?.[key];
  return Array.isArray(value) ? value : undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readMerchantObligationSummary(
  artifact: unknown,
): Phase7MerchantObligationSummaryArtifact | undefined {
  if (typeof artifact !== "object" || artifact === null) {
    return undefined;
  }
  const record = artifact as Record<string, unknown>;
  const candidate = record.summary ?? artifact;
  if (typeof candidate !== "object" || candidate === null) {
    return undefined;
  }
  return candidate as Phase7MerchantObligationSummaryArtifact;
}

function readNonNegativeAtomicString(value: unknown): bigint | undefined {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/u.test(value)) {
    return undefined;
  }
  return BigInt(value);
}

function readPositiveAtomicString(value: unknown): bigint | undefined {
  const parsed = readNonNegativeAtomicString(value);
  return parsed !== undefined && parsed > 0n ? parsed : undefined;
}

function readBasisPoints(value: unknown): number | undefined {
  return Number.isInteger(value) &&
    typeof value === "number" &&
    value >= 0 &&
    value <= 10_000
    ? value
    : undefined;
}

function isManifestEntry(value: unknown): value is Phase7ArtifactManifestEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.evidenceField === "string" &&
    typeof record.reference === "string" &&
    (record.kind === "local" || record.kind === "remote")
  );
}

function isHostedPreflightCheck(
  value: unknown,
): value is Phase7HostedPreflightCheck {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.name === "string" &&
    typeof record.status === "number" &&
    typeof record.expectedStatus === "number" &&
    typeof record.ok === "boolean"
  );
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
