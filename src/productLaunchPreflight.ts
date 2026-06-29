import { join } from "node:path";

import { toDisplayPath } from "./displayPath.js";
import { createPhase6EvidenceAssemblyEnvMappings } from "./phase6EvidenceAssemblyEnv.js";
import { createSplit402ProductEvidenceWorkspace } from "./productEvidenceWorkspace.js";

export interface Split402LaunchPreflightInput {
  currentSourceCommit?: string;
  directory?: string;
  exists: (path: string) => boolean;
  readText: (path: string) => string;
}

export interface Split402LaunchPreflightReport {
  schema: "split402.launch_preflight.v1";
  product: "Split402";
  repository: "split402protocol/splitx402";
  directory: string;
  readyToCollectEvidence: boolean;
  readyForMainnet: false;
  checks: Split402LaunchPreflightCheck[];
  nextActions: string[];
}

export interface Split402LaunchPreflightCheck {
  id: string;
  label: string;
  ok: boolean;
  severity: "required" | "advisory";
  details: string[];
}

export interface Split402LaunchPreflightCliArgs {
  brief: boolean;
  directory?: string;
  help: boolean;
}

export const PRODUCT_LAUNCH_PREFLIGHT_USAGE =
  "Usage: corepack pnpm product:launch-preflight [--brief] [--workspace directory] [directory]";

export function parseSplit402LaunchPreflightCliArgs(
  args: readonly string[],
): Split402LaunchPreflightCliArgs {
  const positionalArgs: string[] = [];
  let brief = false;
  let help = false;
  let workspaceDirectory: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--brief") {
      brief = true;
    } else if (arg === "--workspace") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new Error(
          `${PRODUCT_LAUNCH_PREFLIGHT_USAGE}\n--workspace requires a directory.`,
        );
      }
      workspaceDirectory = value;
      index += 1;
    } else if (arg.startsWith("--workspace=")) {
      const value = arg.slice("--workspace=".length);
      if (value.trim().length === 0) {
        throw new Error(
          `${PRODUCT_LAUNCH_PREFLIGHT_USAGE}\n--workspace requires a directory.`,
        );
      }
      workspaceDirectory = value;
    } else if (arg.startsWith("-")) {
      throw new Error(
        `${PRODUCT_LAUNCH_PREFLIGHT_USAGE}\nUnknown option: ${arg}`,
      );
    } else {
      positionalArgs.push(arg);
    }
  }

  if (workspaceDirectory !== undefined && positionalArgs.length > 0) {
    throw new Error(
      `${PRODUCT_LAUNCH_PREFLIGHT_USAGE}\nDo not pass a directory path with --workspace.`,
    );
  }
  if (positionalArgs.length > 1) {
    throw new Error(PRODUCT_LAUNCH_PREFLIGHT_USAGE);
  }
  const directory = workspaceDirectory ?? positionalArgs[0];

  return {
    brief,
    ...(help || directory === undefined ? {} : { directory }),
    help,
  };
}

const REQUIRED_PHASE7_HOSTED_ENV_KEYS = [
  "SPLIT402_PHASE7_PROOF_ID",
  "SPLIT402_PHASE7_PROOF_REVIEWERS",
  "SPLIT402_PHASE7_STAGING_ENVIRONMENT",
  "SPLIT402_PHASE7_CONTROL_PLANE_URL",
  "SPLIT402_PHASE7_DASHBOARD_URL",
  "SPLIT402_PHASE7_DEMO_MERCHANT_URL",
  "SPLIT402_PHASE7_WEBHOOK_RECEIVER_URL",
  "SPLIT402_PHASE7_CONTROL_PLANE_TOKEN",
  "SPLIT402_PHASE7_MERCHANT_ID",
  "SPLIT402_PHASE7_REFERRER_WALLET",
] as const;

const REQUIRED_MCP_LIVE_ENV_KEYS = [
  "SPLIT402_MCP_CONTROL_PLANE_URL",
  "SPLIT402_MCP_CONTROL_PLANE_TOKEN",
  "SPLIT402_MCP_CAPABILITY",
] as const;

const REQUIRED_PHASE7_HOSTED_URL_ENV_KEYS = [
  "SPLIT402_PHASE7_CONTROL_PLANE_URL",
  "SPLIT402_PHASE7_DASHBOARD_URL",
  "SPLIT402_PHASE7_DEMO_MERCHANT_URL",
  "SPLIT402_PHASE7_WEBHOOK_RECEIVER_URL",
] as const;

const REQUIRED_MCP_LIVE_URL_ENV_KEYS = [
  "SPLIT402_MCP_CONTROL_PLANE_URL",
] as const;

const MCP_LIVE_EXECUTION_ENV_KEY = "SPLIT402_PHASE7_MCP_GATEWAY_EXECUTE";

const REQUIRED_PHASE6_DIRECT_ENV_KEYS = [
  "SPLIT402_PHASE6_EVIDENCE_REVIEW_ID",
  "SPLIT402_PHASE6_EVIDENCE_STAGING_ENVIRONMENT",
] as const;

export function createSplit402LaunchPreflightReport(
  input: Split402LaunchPreflightInput,
): Split402LaunchPreflightReport {
  const workspace = createSplit402ProductEvidenceWorkspace({
    directory: input.directory ?? "split402-launch-evidence",
  });
  const requiredFiles = [
    join(workspace.directory, workspace.readmeFileName),
    join(workspace.directory, workspace.phase6EvidenceFileName),
    join(workspace.directory, workspace.phase6EnvFileName),
    join(workspace.directory, workspace.phase7ProofFileName),
    join(workspace.directory, workspace.phase7EnvFileName),
    join(workspace.phase7.directory, workspace.phase7.readmeFileName),
  ];
  const missingRequiredFiles = requiredFiles.filter((path) => !input.exists(path));
  const existingRequiredFiles = requiredFiles.filter((path) => input.exists(path));
  const phase6EvidencePath = join(
    workspace.directory,
    workspace.phase6EvidenceFileName,
  );
  const phase6EvidenceText = input.exists(phase6EvidencePath)
    ? input.readText(phase6EvidencePath)
    : "";
  const phase7ProofPath = join(workspace.directory, workspace.phase7ProofFileName);
  const phase7ProofText = input.exists(phase7ProofPath)
    ? input.readText(phase7ProofPath)
    : "";
  const sourceCommitBlockers = createSourceCommitBlockers({
    currentSourceCommit: input.currentSourceCommit,
    phase6EvidencePath,
    phase6EvidenceText,
    phase7ProofPath,
    phase7ProofText,
  });
  const phase7EnvPath = join(workspace.directory, workspace.phase7EnvFileName);
  const phase7EnvText = input.exists(phase7EnvPath)
    ? input.readText(phase7EnvPath)
    : "";
  const phase7Env = parseEnvText(phase7EnvText);
  const phase6EnvPath = join(workspace.directory, workspace.phase6EnvFileName);
  const phase6EnvText = input.exists(phase6EnvPath)
    ? input.readText(phase6EnvPath)
    : "";
  const phase6Env = parseEnvText(phase6EnvText);
  const missingPhase6DirectKeys = REQUIRED_PHASE6_DIRECT_ENV_KEYS.filter(
    (key) => !hasConfiguredEnvValue(phase6Env, key),
  );
  const missingPhase6Mappings = createPhase6EvidenceAssemblyEnvMappings({
    directory: workspace.directory,
  }).filter(
    (mapping) => phase6Env.get(mapping.envName) !== mapping.path,
  );
  const missingAttachmentMappings = workspace.phase7.artifacts
    .map((artifact) => ({
      key: phase7AttachmentEnvName(artifact.field),
      expectedPath: `${workspace.phase7.directory}/${artifact.fileName}`,
    }))
    .filter(
      (attachment) =>
        phase7Env.get(attachment.key) !== attachment.expectedPath,
    );
  const missingHostedKeys = REQUIRED_PHASE7_HOSTED_ENV_KEYS.filter(
    (key) => !hasConfiguredEnvValue(phase7Env, key),
  );
  const invalidHostedUrlDetails = createHttpUrlEnvDetails({
    env: phase7Env,
    envPath: phase7EnvPath,
    keys: REQUIRED_PHASE7_HOSTED_URL_ENV_KEYS,
  });
  const missingMcpKeys = REQUIRED_MCP_LIVE_ENV_KEYS.filter(
    (key) => !hasConfiguredEnvValue(phase7Env, key),
  );
  const invalidMcpUrlDetails = createHttpUrlEnvDetails({
    env: phase7Env,
    envPath: phase7EnvPath,
    keys: REQUIRED_MCP_LIVE_URL_ENV_KEYS,
  });
  const liveExecutionEnabled = hasTruthyEnvValue(
    phase7Env,
    MCP_LIVE_EXECUTION_ENV_KEY,
  );
  const missingBuyerKey =
    !hasConfiguredEnvValue(phase7Env, "SPLIT402_MCP_SVM_PRIVATE_KEY") &&
    !hasConfiguredEnvValue(phase7Env, "SVM_PRIVATE_KEY");
  const missingMcpDetails = [
    ...missingMcpKeys.map(
      (key) => `Fill ${key} in ${toDisplayPath(phase7EnvPath)}.`,
    ),
    ...(liveExecutionEnabled
      ? []
      : [
          `Set ${MCP_LIVE_EXECUTION_ENV_KEY}=1 in ${toDisplayPath(phase7EnvPath)} for live router execution.`,
        ]),
    ...(missingBuyerKey
      ? [
          `Fill SPLIT402_MCP_SVM_PRIVATE_KEY or SVM_PRIVATE_KEY in ${toDisplayPath(phase7EnvPath)}.`,
        ]
      : []),
    ...invalidMcpUrlDetails,
  ];
  const mcpHostedMismatchDetails = createMcpHostedMismatchDetails({
    env: phase7Env,
    envPath: phase7EnvPath,
  });

  const checks: Split402LaunchPreflightCheck[] = [
    {
      id: "launch_workspace_files",
      label: "Launch evidence scaffold files exist",
      ok: missingRequiredFiles.length === 0,
      severity: "required",
      details:
        missingRequiredFiles.length === 0
          ? ["Launch evidence workspace scaffold is present."]
          : createLaunchWorkspaceMissingDetails({
              missingRequiredFiles,
              existingRequiredFiles,
            }),
    },
    {
      id: "phase6_evidence_env_values",
      label: "Phase 6 custody env values are filled",
      ok: missingPhase6DirectKeys.length === 0,
      severity: "required",
      details:
        missingPhase6DirectKeys.length === 0
          ? ["Required Phase 6 custody env values are configured."]
          : missingPhase6DirectKeys.map(
              (key) => `Fill ${key} in ${toDisplayPath(phase6EnvPath)}.`,
            ),
    },
    {
      id: "launch_workspace_source_commit",
      label: "Launch evidence source commit matches checkout",
      ok: sourceCommitBlockers.length === 0,
      severity: "required",
      details:
        sourceCommitBlockers.length === 0
          ? ["Launch evidence source_commit values match the current checkout."]
          : sourceCommitBlockers,
    },
    {
      id: "phase6_evidence_env_mappings",
      label: "Phase 6 custody record paths are configured",
      ok: missingPhase6Mappings.length === 0,
      severity: "required",
      details:
        missingPhase6Mappings.length === 0
          ? ["Phase 6 custody record env paths point at the launch workspace."]
          : missingPhase6Mappings.map(
              (mapping) => `Set ${mapping.envName}=${mapping.path}`,
            ),
    },
    {
      id: "phase7_attachment_env_mappings",
      label: "Phase 7 attachment paths are configured",
      ok: missingAttachmentMappings.length === 0,
      severity: "required",
      details:
        missingAttachmentMappings.length === 0
          ? ["Phase 7 attachment env mappings point at the launch workspace."]
          : missingAttachmentMappings.map(
              (attachment) =>
                `Set ${attachment.key}=${attachment.expectedPath}`,
            ),
    },
    {
      id: "phase7_hosted_env_values",
      label: "Phase 7 hosted proof env values are filled",
      ok: missingHostedKeys.length === 0 && invalidHostedUrlDetails.length === 0,
      severity: "required",
      details:
        missingHostedKeys.length === 0 && invalidHostedUrlDetails.length === 0
          ? ["Required hosted proof values are configured."]
          : [
              ...missingHostedKeys.map(
                (key) => `Fill ${key} in ${toDisplayPath(phase7EnvPath)}.`,
              ),
              ...invalidHostedUrlDetails,
            ],
    },
    {
      id: "phase7_mcp_live_execution_env",
      label: "Phase 7 MCP live execution env values are filled",
      ok:
        missingMcpKeys.length === 0 &&
        liveExecutionEnabled &&
        !missingBuyerKey &&
        invalidMcpUrlDetails.length === 0,
      severity: "required",
      details:
        missingMcpDetails.length === 0
          ? ["Required MCP live execution values are configured."]
          : missingMcpDetails,
    },
    {
      id: "phase7_mcp_matches_hosted_env",
      label: "Phase 7 MCP live execution targets the hosted proof environment",
      ok: mcpHostedMismatchDetails.length === 0,
      severity: "required",
      details:
        mcpHostedMismatchDetails.length === 0
          ? ["MCP live execution control-plane values match the hosted proof environment."]
          : mcpHostedMismatchDetails,
    },
    {
      id: "mainnet_not_ready",
      label: "Mainnet approval remains outside local preflight",
      ok: true,
      severity: "advisory",
      details: [
        "Preflight does not approve production custody, public-alpha launch, or mainnet use.",
      ],
    },
  ];
  const readyToCollectEvidence = checks
    .filter((check) => check.severity === "required")
    .every((check) => check.ok);

  return {
    schema: "split402.launch_preflight.v1",
    product: "Split402",
    repository: "split402protocol/splitx402",
    directory: workspace.directory,
    readyToCollectEvidence,
    readyForMainnet: false,
    checks,
    nextActions: createNextActions(checks),
  };
}

export function formatSplit402LaunchPreflightBrief(
  report: Split402LaunchPreflightReport,
): string {
  const checkLines = report.checks.flatMap((check) => [
    `- ${check.label}: ${check.ok ? "ok" : "missing"} (${check.severity})`,
    ...check.details.map((detail) => `  ${detail}`),
  ]);

  return [
    `Split402 launch preflight: ${report.readyToCollectEvidence ? "ready" : "not ready"}`,
    `Evidence workspace: ${report.directory}`,
    `Mainnet ready: ${report.readyForMainnet ? "yes" : "no"}`,
    "",
    ...checkLines,
    "",
    "Next actions:",
    ...(report.nextActions.length > 0
      ? report.nextActions.map((action) => `- ${action}`)
      : ["- Continue hosted Phase 7 and Phase 6 custody evidence collection."]),
  ].join("\n");
}

function createNextActions(checks: readonly Split402LaunchPreflightCheck[]): string[] {
  const missingWorkspaceCheck = checks.find(
    (check) => check.id === "launch_workspace_files" && !check.ok,
  );
  if (missingWorkspaceCheck !== undefined) {
    return missingWorkspaceCheck.details.filter((detail) =>
      detail.startsWith("Run ") || detail.startsWith("Review "),
    );
  }

  return checks
    .filter((check) => check.severity === "required" && !check.ok)
    .flatMap((check) => check.details)
    .filter(
      (detail) =>
        detail.startsWith("Run ") ||
        detail.startsWith("Fill ") ||
        detail.startsWith("Set ") ||
        detail.startsWith("Regenerate "),
    );
}

function createLaunchWorkspaceMissingDetails(input: {
  missingRequiredFiles: readonly string[];
  existingRequiredFiles: readonly string[];
}): string[] {
  const recoveryAction =
    input.existingRequiredFiles.length === 0
      ? "Run corepack pnpm product:evidence:init."
      : "Review the existing partial launch evidence workspace, then run corepack pnpm product:evidence:init --missing to create only absent scaffold files or --force only if intentionally replacing scaffold files.";

  return [
    recoveryAction,
    ...input.missingRequiredFiles.map((path) => `Missing ${toDisplayPath(path)}`),
    ...input.existingRequiredFiles.map((path) => `Existing ${toDisplayPath(path)}`),
  ];
}

function parseEnvText(text: string): Map<string, string> {
  const env = new Map<string, string>();
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    env.set(
      trimmed.slice(0, separatorIndex).trim(),
      trimmed.slice(separatorIndex + 1).trim(),
    );
  }
  return env;
}

function createSourceCommitBlockers(input: {
  currentSourceCommit?: string;
  phase6EvidencePath: string;
  phase6EvidenceText: string;
  phase7ProofPath: string;
  phase7ProofText: string;
}): string[] {
  const currentSourceCommit = input.currentSourceCommit?.trim();
  if (currentSourceCommit === undefined || currentSourceCommit.length === 0) {
    return [];
  }

  const phase6SourceCommit = parseRecordField(
    input.phase6EvidenceText,
    "source_commit",
  );
  const phase7SourceCommit = parseRecordField(input.phase7ProofText, "source_commit");
  const blockers: string[] = [];
  for (const item of [
    {
      label: "Phase 6 custody evidence",
      path: input.phase6EvidencePath,
      sourceCommit: phase6SourceCommit,
    },
    {
      label: "Phase 7 staging proof",
      path: input.phase7ProofPath,
      sourceCommit: phase7SourceCommit,
    },
  ] as const) {
    if (item.sourceCommit === undefined || item.sourceCommit.length === 0) {
      blockers.push(
        `${item.label} source_commit is missing in ${toDisplayPath(item.path)}.`,
      );
    } else if (item.sourceCommit !== currentSourceCommit) {
      blockers.push(
        `Regenerate ${toDisplayPath(item.path)} from checkout ${currentSourceCommit} before collecting evidence, or recollect evidence from the current checkout if real artifacts already exist; found source_commit ${item.sourceCommit}.`,
      );
    }
  }
  return blockers;
}

function createMcpHostedMismatchDetails(input: {
  env: ReadonlyMap<string, string>;
  envPath: string;
}): string[] {
  const details: string[] = [];
  const hostedControlPlaneUrl = input.env.get("SPLIT402_PHASE7_CONTROL_PLANE_URL");
  const mcpControlPlaneUrl = input.env.get("SPLIT402_MCP_CONTROL_PLANE_URL");
  if (
    hasConfiguredEnvValue(input.env, "SPLIT402_PHASE7_CONTROL_PLANE_URL") &&
    hasConfiguredEnvValue(input.env, "SPLIT402_MCP_CONTROL_PLANE_URL") &&
    normalizeUrlForComparison(hostedControlPlaneUrl) !==
      normalizeUrlForComparison(mcpControlPlaneUrl)
  ) {
    details.push(
      `Set SPLIT402_MCP_CONTROL_PLANE_URL to match SPLIT402_PHASE7_CONTROL_PLANE_URL in ${toDisplayPath(input.envPath)} so MCP evidence uses the same hosted control plane.`,
    );
  }

  const hostedToken = input.env.get("SPLIT402_PHASE7_CONTROL_PLANE_TOKEN");
  const mcpToken = input.env.get("SPLIT402_MCP_CONTROL_PLANE_TOKEN");
  if (
    hasConfiguredEnvValue(input.env, "SPLIT402_PHASE7_CONTROL_PLANE_TOKEN") &&
    hasConfiguredEnvValue(input.env, "SPLIT402_MCP_CONTROL_PLANE_TOKEN") &&
    hostedToken !== mcpToken
  ) {
    details.push(
      `Set SPLIT402_MCP_CONTROL_PLANE_TOKEN to match SPLIT402_PHASE7_CONTROL_PLANE_TOKEN in ${toDisplayPath(input.envPath)} so MCP evidence uses the same hosted control-plane auth context.`,
    );
  }
  return details;
}

function createHttpUrlEnvDetails(input: {
  env: ReadonlyMap<string, string>;
  envPath: string;
  keys: readonly string[];
}): string[] {
  return input.keys.flatMap((key) => {
    if (!hasConfiguredEnvValue(input.env, key)) {
      return [];
    }
    return isHttpUrl(input.env.get(key))
      ? []
      : [`Set ${key} to an http(s) URL in ${toDisplayPath(input.envPath)}.`];
  });
}

function isHttpUrl(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeUrlForComparison(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  try {
    const url = new URL(value);
    url.pathname = url.pathname.replace(/\/+$/u, "");
    return url.toString();
  } catch {
    return value.trim().replace(/\/+$/u, "");
  }
}

function parseRecordField(text: string, fieldName: string): string | undefined {
  for (const line of text.split(/\r?\n/u)) {
    const match = /^([a-z][a-z0-9_]*):\s*(.*)$/u.exec(line);
    if (match?.[1] === fieldName) {
      return match[2]?.trim();
    }
  }
  return undefined;
}

function hasConfiguredEnvValue(env: ReadonlyMap<string, string>, key: string): boolean {
  const value = env.get(key);
  return (
    value !== undefined &&
    value.length > 0 &&
    value !== "TODO" &&
    !/^<.*>$/u.test(value)
  );
}

function hasTruthyEnvValue(env: ReadonlyMap<string, string>, key: string): boolean {
  const value = env.get(key)?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function phase7AttachmentEnvName(field: string): string {
  return `SPLIT402_PHASE7_ASSEMBLE_${field.toUpperCase()}`;
}
