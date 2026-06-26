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

export function createPhase7StagingStatusReport(
  proofText?: string,
  options: Phase7StagingStatusOptions = {},
): Phase7StagingStatusReport {
  const validation =
    proofText === undefined ? undefined : validatePhase7StagingProof(proofText);
  const artifactStatuses = createArtifactStatuses(proofText, options);
  const manifestStatus = createManifestStatus(proofText, options);
  const hostedPreflightStatus = createHostedPreflightStatus(proofText, options);
  const artifactBlockers = artifactStatuses.flatMap((status) => status.blockers);
  const manifestBlockers = manifestStatus.blockers;
  const hostedPreflightBlockers = hostedPreflightStatus.blockers;
  const readyForPublicAlphaDemo =
    (validation?.approved ?? false) &&
    artifactBlockers.length === 0 &&
    manifestBlockers.length === 0 &&
    hostedPreflightBlockers.length === 0;

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
    ),
    artifactStatuses,
    manifestStatus,
    hostedPreflightStatus,
    validation,
    nextActions: createNextActions(validation, [
      ...artifactBlockers,
      ...manifestBlockers,
      ...hostedPreflightBlockers,
    ]),
  };
}

function createGateStatuses(
  validation: Phase7StagingProofValidation | undefined,
  artifactStatuses: readonly Phase7StagingArtifactStatus[],
  manifestBlockers: readonly string[],
  hostedPreflightBlockers: readonly string[],
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
): string[] {
  if (evidenceField === "artifact_manifest_evidence") {
    return [...artifactBlockers, ...manifestBlockers];
  }
  if (evidenceField === "hosted_preflight_evidence") {
    return [...artifactBlockers, ...hostedPreflightBlockers];
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
