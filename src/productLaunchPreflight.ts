import { join } from "node:path";

import { createPhase6EvidenceAssemblyEnvMappings } from "./phase6EvidenceAssemblyEnv.js";
import { createSplit402ProductEvidenceWorkspace } from "./productEvidenceWorkspace.js";

export interface Split402LaunchPreflightInput {
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

const REQUIRED_PHASE7_HOSTED_ENV_KEYS = [
  "SPLIT402_PHASE7_CONTROL_PLANE_URL",
  "SPLIT402_PHASE7_DASHBOARD_URL",
  "SPLIT402_PHASE7_DEMO_MERCHANT_URL",
  "SPLIT402_PHASE7_CONTROL_PLANE_TOKEN",
  "SPLIT402_PHASE7_MERCHANT_ID",
  "SPLIT402_PHASE7_REFERRER_WALLET",
] as const;

const REQUIRED_MCP_LIVE_ENV_KEYS = [
  "SPLIT402_MCP_CONTROL_PLANE_URL",
  "SPLIT402_MCP_CONTROL_PLANE_TOKEN",
  "SPLIT402_MCP_CAPABILITY",
  "SPLIT402_PHASE7_MCP_GATEWAY_EXECUTE",
] as const;

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
  const missingMcpKeys = REQUIRED_MCP_LIVE_ENV_KEYS.filter(
    (key) => !hasConfiguredEnvValue(phase7Env, key),
  );
  const missingBuyerKey =
    !hasConfiguredEnvValue(phase7Env, "SPLIT402_MCP_SVM_PRIVATE_KEY") &&
    !hasConfiguredEnvValue(phase7Env, "SVM_PRIVATE_KEY");
  const missingMcpDetails = [
    ...missingMcpKeys.map((key) => `Fill ${key} in ${phase7EnvPath}.`),
    ...(missingBuyerKey
      ? [
          `Fill SPLIT402_MCP_SVM_PRIVATE_KEY or SVM_PRIVATE_KEY in ${phase7EnvPath}.`,
        ]
      : []),
  ];

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
              (key) => `Fill ${key} in ${phase6EnvPath}.`,
            ),
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
      ok: missingHostedKeys.length === 0,
      severity: "required",
      details:
        missingHostedKeys.length === 0
          ? ["Required hosted proof values are configured."]
          : missingHostedKeys.map((key) => `Fill ${key} in ${phase7EnvPath}.`),
    },
    {
      id: "phase7_mcp_live_execution_env",
      label: "Phase 7 MCP live execution env values are filled",
      ok: missingMcpKeys.length === 0 && !missingBuyerKey,
      severity: "required",
      details:
        missingMcpDetails.length === 0
          ? ["Required MCP live execution values are configured."]
          : missingMcpDetails,
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
        detail.startsWith("Set "),
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
    ...input.missingRequiredFiles.map((path) => `Missing ${path}`),
    ...input.existingRequiredFiles.map((path) => `Existing ${path}`),
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

function hasConfiguredEnvValue(env: ReadonlyMap<string, string>, key: string): boolean {
  const value = env.get(key);
  return (
    value !== undefined &&
    value.length > 0 &&
    value !== "TODO" &&
    !/^<.*>$/u.test(value)
  );
}

function phase7AttachmentEnvName(field: string): string {
  return `SPLIT402_PHASE7_ASSEMBLE_${field.toUpperCase()}`;
}
