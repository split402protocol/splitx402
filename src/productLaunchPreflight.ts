import { join } from "node:path";

import dotenv from "dotenv";

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

const EXPECTED_PHASE7_MCP_CAPABILITY = "solana.wallet-risk";

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
  "SPLIT402_PHASE6_EVIDENCE_REVIEWERS",
  "SPLIT402_PHASE6_EVIDENCE_STAGING_ENVIRONMENT",
  "SPLIT402_PHASE6_EVIDENCE_FUNDING_WALLET",
  "SPLIT402_PHASE6_EVIDENCE_NETWORK",
  "SPLIT402_PHASE6_EVIDENCE_APPROVAL_NOTES",
] as const;

const EXPECTED_PHASE6_EVIDENCE_NETWORK = "solana:devnet";

const PRE_COLLECTION_APPROVAL_ENV_KEYS = [
  {
    key: "SPLIT402_PHASE6_EVIDENCE_APPROVAL_DECISION",
    envLabel: "Phase 6 custody",
  },
  {
    key: "SPLIT402_PHASE7_APPROVAL_DECISION",
    envLabel: "Phase 7 hosted proof",
  },
] as const;

export function createSplit402LaunchPreflightReport(
  input: Split402LaunchPreflightInput,
): Split402LaunchPreflightReport {
  const workspace = createSplit402ProductEvidenceWorkspace({
    directory: input.directory ?? "split402-launch-evidence",
  });
  const requiredFiles = [
    join(workspace.directory, workspace.readmeFileName),
    join(workspace.directory, workspace.githubSettingsReviewFileName),
    join(workspace.directory, workspace.phase6EvidenceFileName),
    join(workspace.directory, workspace.phase6EnvFileName),
    join(workspace.directory, workspace.phase7ProofFileName),
    join(workspace.directory, workspace.phase7EnvFileName),
    join(workspace.phase7.directory, workspace.phase7.readmeFileName),
  ];
  const missingRequiredFiles = requiredFiles.filter((path) => !input.exists(path));
  const existingRequiredFiles = requiredFiles.filter((path) => input.exists(path));
  const githubSettingsReviewPath = join(
    workspace.directory,
    workspace.githubSettingsReviewFileName,
  );
  const githubSettingsReviewText = input.exists(githubSettingsReviewPath)
    ? input.readText(githubSettingsReviewPath)
    : "";
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
    githubSettingsReviewPath,
    githubSettingsReviewText,
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
  const invalidPhase6NetworkDetails = createPhase6NetworkDetails({
    env: phase6Env,
    envPath: phase6EnvPath,
  });
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
  const invalidMcpCapabilityDetails = createMcpCapabilityDetails({
    env: phase7Env,
    envPath: phase7EnvPath,
  });
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
    ...createMissingMcpKeyDetails({
      keys: missingMcpKeys,
      envPath: phase7EnvPath,
    }),
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
    ...invalidMcpCapabilityDetails,
    ...invalidMcpUrlDetails,
  ];
  const mcpHostedMismatchDetails = createMcpHostedMismatchDetails({
    env: phase7Env,
    envPath: phase7EnvPath,
  });
  const prematureApprovalDetails = createPrematureApprovalDetails({
    phase6Env,
    phase6EnvPath,
    phase7Env,
    phase7EnvPath,
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
      ok:
        missingPhase6DirectKeys.length === 0 &&
        invalidPhase6NetworkDetails.length === 0,
      severity: "required",
      details:
        missingPhase6DirectKeys.length === 0 &&
        invalidPhase6NetworkDetails.length === 0
          ? ["Required Phase 6 custody env values are configured."]
          : [
              ...createMissingPhase6KeyDetails({
                keys: missingPhase6DirectKeys,
                envPath: phase6EnvPath,
              }),
              ...invalidPhase6NetworkDetails,
            ],
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
        invalidMcpCapabilityDetails.length === 0 &&
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
      id: "pre_collection_approval_decisions",
      label: "Launch approval decisions remain no-go before evidence collection",
      ok: prematureApprovalDetails.length === 0,
      severity: "required",
      details:
        prematureApprovalDetails.length === 0
          ? ["Approval decisions are unset or no-go before evidence collection."]
          : prematureApprovalDetails,
    },
    {
      id: "phase6_redacted_env_summary",
      label: "Phase 6 custody env redacted summary",
      ok: true,
      severity: "advisory",
      details: createPhase6RedactedEnvSummary({
        env: phase6Env,
        envPath: phase6EnvPath,
      }),
    },
    {
      id: "phase7_redacted_env_summary",
      label: "Phase 7 hosted env redacted summary",
      ok: true,
      severity: "advisory",
      details: createPhase7RedactedEnvSummary({
        env: phase7Env,
        envPath: phase7EnvPath,
      }),
    },
    {
      id: "public_private_license_review",
      label: "Public/private and license review is queued",
      ok: true,
      severity: "advisory",
      details: [
        createPublicPrivateLicenseReviewAction({
          directory: workspace.directory,
          fileName: workspace.githubSettingsReviewFileName,
        }),
        "Keep the public repository as the Apache-2.0 protocol foundation.",
        "Keep hosted operations, provider strategy, custody evidence, private URLs, live transaction bytes, and partner-identifying details private unless intentionally sanitized.",
        "Do not reintroduce MIT in README, package metadata, GitHub About text, release notes, or package manifests.",
      ],
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

  const requiredActions = checks
    .filter((check) => check.severity === "required" && !check.ok)
    .flatMap((check) => createCheckNextActions(check))
    .filter(
      (detail) =>
        detail.startsWith("Run ") ||
        detail.startsWith("Fill ") ||
        detail.startsWith("Set ") ||
        detail.startsWith("Regenerate "),
    );
  if (requiredActions.length > 0) {
    return requiredActions;
  }

  return checks
    .filter((check) => check.id === "public_private_license_review")
    .flatMap((check) => check.details)
    .filter((detail) => detail.startsWith("Run "));
}

function createPublicPrivateLicenseReviewAction(input: {
  directory: string;
  fileName: string;
}): string {
  return `Run corepack pnpm product:github-settings-review --template > ${input.directory}/${input.fileName}, verify the live GitHub About/profile/branch-protection/release settings, then run corepack pnpm product:github-settings-review and keep the output at ${input.directory}/${input.fileName}.`;
}

function createCheckNextActions(check: Split402LaunchPreflightCheck): string[] {
  switch (check.id) {
    case "phase6_evidence_env_values":
      return createGroupedEnvActions("Fill Phase 6 custody env values", check.details);
    case "phase7_hosted_env_values":
      return createGroupedEnvActions("Fill Phase 7 hosted proof env values", check.details);
    case "phase7_mcp_live_execution_env":
      return createGroupedEnvActions(
        "Fill Phase 7 MCP live execution env values",
        check.details,
      );
    default:
      return check.details;
  }
}

function createGroupedEnvActions(
  label: string,
  details: readonly string[],
): string[] {
  const groupedByPath = new Map<string, string[]>();
  const ungrouped: string[] = [];

  for (const detail of details) {
    const fillMatch = /^Fill (.+) in (.+)\.$/u.exec(detail);
    if (fillMatch?.[1] !== undefined && fillMatch[2] !== undefined) {
      addGroupedEnvItem(groupedByPath, fillMatch[2], fillMatch[1]);
      continue;
    }
    const setMatch = /^Set (.+) in (.+?) for .+\.$/u.exec(detail);
    if (setMatch?.[1] !== undefined && setMatch[2] !== undefined) {
      addGroupedEnvItem(groupedByPath, setMatch[2], setMatch[1]);
      continue;
    }
    ungrouped.push(detail);
  }

  const groupedActions = [...groupedByPath].map(
    ([path, items]) => `${label} in ${path}: ${items.join(", ")}.`,
  );
  return [...groupedActions, ...ungrouped];
}

function addGroupedEnvItem(
  groupedByPath: Map<string, string[]>,
  path: string,
  item: string,
): void {
  const currentItems = groupedByPath.get(path) ?? [];
  currentItems.push(item);
  groupedByPath.set(path, currentItems);
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
  return new Map(Object.entries(dotenv.parse(text)));
}

function createSourceCommitBlockers(input: {
  currentSourceCommit?: string;
  githubSettingsReviewPath: string;
  githubSettingsReviewText: string;
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
  const githubSettingsReviewSourceCommit = parseRecordField(
    input.githubSettingsReviewText,
    "source_commit",
  );
  const blockers: string[] = [];
  for (const item of [
    {
      label: "GitHub settings review",
      path: input.githubSettingsReviewPath,
      sourceCommit: githubSettingsReviewSourceCommit,
    },
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
    } else if (!gitShasMatch(item.sourceCommit, currentSourceCommit)) {
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

function createMissingPhase6KeyDetails(input: {
  keys: readonly string[];
  envPath: string;
}): string[] {
  return input.keys.map((key) =>
    key === "SPLIT402_PHASE6_EVIDENCE_NETWORK"
      ? `Set SPLIT402_PHASE6_EVIDENCE_NETWORK=${EXPECTED_PHASE6_EVIDENCE_NETWORK} in ${toDisplayPath(input.envPath)} for launch evidence collection.`
      : `Fill ${key} in ${toDisplayPath(input.envPath)}.`,
  );
}

function createPhase6NetworkDetails(input: {
  env: ReadonlyMap<string, string>;
  envPath: string;
}): string[] {
  const network = input.env.get("SPLIT402_PHASE6_EVIDENCE_NETWORK")?.trim();
  if (
    network === undefined ||
    network.length === 0 ||
    isPlaceholderEnvValue(network) ||
    network === EXPECTED_PHASE6_EVIDENCE_NETWORK
  ) {
    return [];
  }
  return [
    `Set SPLIT402_PHASE6_EVIDENCE_NETWORK=${EXPECTED_PHASE6_EVIDENCE_NETWORK} in ${toDisplayPath(input.envPath)} for launch evidence collection; launch evidence remains devnet-only until separate mainnet approval.`,
  ];
}

function createMissingMcpKeyDetails(input: {
  keys: readonly string[];
  envPath: string;
}): string[] {
  return input.keys.map((key) =>
    key === "SPLIT402_MCP_CAPABILITY"
      ? `Set SPLIT402_MCP_CAPABILITY=${EXPECTED_PHASE7_MCP_CAPABILITY} in ${toDisplayPath(input.envPath)} for the Phase 7 public-alpha MCP proof.`
      : `Fill ${key} in ${toDisplayPath(input.envPath)}.`,
  );
}

function createMcpCapabilityDetails(input: {
  env: ReadonlyMap<string, string>;
  envPath: string;
}): string[] {
  const capability = input.env.get("SPLIT402_MCP_CAPABILITY")?.trim();
  if (
    capability === undefined ||
    capability.length === 0 ||
    isPlaceholderEnvValue(capability) ||
    capability === EXPECTED_PHASE7_MCP_CAPABILITY
  ) {
    return [];
  }
  return [
    `Set SPLIT402_MCP_CAPABILITY=${EXPECTED_PHASE7_MCP_CAPABILITY} in ${toDisplayPath(input.envPath)} for the Phase 7 public-alpha MCP proof.`,
  ];
}

function createPrematureApprovalDetails(input: {
  phase6Env: ReadonlyMap<string, string>;
  phase6EnvPath: string;
  phase7Env: ReadonlyMap<string, string>;
  phase7EnvPath: string;
}): string[] {
  return PRE_COLLECTION_APPROVAL_ENV_KEYS.flatMap((item) => {
    const env =
      item.key === "SPLIT402_PHASE6_EVIDENCE_APPROVAL_DECISION"
        ? input.phase6Env
        : input.phase7Env;
    const envPath =
      item.key === "SPLIT402_PHASE6_EVIDENCE_APPROVAL_DECISION"
        ? input.phase6EnvPath
        : input.phase7EnvPath;
    const value = env.get(item.key)?.trim().toLowerCase();
    if (value === undefined || value.length === 0 || value === "no-go") {
      return [];
    }
    return [
      `Set ${item.key}=no-go in ${toDisplayPath(envPath)} until ${item.envLabel} status gates pass.`,
    ];
  });
}

function createPhase7RedactedEnvSummary(input: {
  env: ReadonlyMap<string, string>;
  envPath: string;
}): string[] {
  return [
    `Env file: ${toDisplayPath(input.envPath)}`,
    ...REQUIRED_PHASE7_HOSTED_ENV_KEYS.map((key) =>
      describePhase7EnvValue(input.env, key),
    ),
    ...REQUIRED_MCP_LIVE_ENV_KEYS.map((key) =>
      describePhase7EnvValue(input.env, key),
    ),
    `${MCP_LIVE_EXECUTION_ENV_KEY}: ${
      hasTruthyEnvValue(input.env, MCP_LIVE_EXECUTION_ENV_KEY)
        ? "enabled"
        : "missing or disabled"
    }`,
    `SPLIT402_MCP_SVM_PRIVATE_KEY/SVM_PRIVATE_KEY: ${describeBuyerKeyStatus(
      input.env,
    )}`,
  ];
}

function createPhase6RedactedEnvSummary(input: {
  env: ReadonlyMap<string, string>;
  envPath: string;
}): string[] {
  return [
    `Env file: ${toDisplayPath(input.envPath)}`,
    ...REQUIRED_PHASE6_DIRECT_ENV_KEYS.map((key) =>
      describePhase6EnvValue(input.env, key),
    ),
    `SPLIT402_PHASE6_EVIDENCE_APPROVAL_DECISION: ${describeOptionalDecision(
      input.env,
      "SPLIT402_PHASE6_EVIDENCE_APPROVAL_DECISION",
    )}`,
  ];
}

function describePhase6EnvValue(
  env: ReadonlyMap<string, string>,
  key: string,
): string {
  return hasConfiguredEnvValue(env, key) ? `${key}: configured` : `${key}: missing`;
}

function describeOptionalDecision(
  env: ReadonlyMap<string, string>,
  key: string,
): string {
  return hasConfiguredEnvValue(env, key) ? "configured" : "unset";
}

function describePhase7EnvValue(
  env: ReadonlyMap<string, string>,
  key: string,
): string {
  if (!hasConfiguredEnvValue(env, key)) {
    return `${key}: missing`;
  }
  if (isSecretEnvKey(key)) {
    return `${key}: configured (redacted)`;
  }
  if (key.endsWith("_URL")) {
    return `${key}: ${redactUrlForSummary(env.get(key))}`;
  }
  return `${key}: configured`;
}

function describeBuyerKeyStatus(env: ReadonlyMap<string, string>): string {
  if (hasConfiguredEnvValue(env, "SPLIT402_MCP_SVM_PRIVATE_KEY")) {
    return "configured via SPLIT402_MCP_SVM_PRIVATE_KEY (redacted)";
  }
  if (hasConfiguredEnvValue(env, "SVM_PRIVATE_KEY")) {
    return "configured via SVM_PRIVATE_KEY (redacted)";
  }
  return "missing";
}

function isSecretEnvKey(key: string): boolean {
  return key.includes("TOKEN") || key.includes("PRIVATE_KEY");
}

function redactUrlForSummary(value: string | undefined): string {
  if (value === undefined) {
    return "missing";
  }
  try {
    const url = new URL(value);
    const port = url.port.length === 0 ? "" : `:${url.port}`;
    return `configured (${url.protocol}//${url.hostname}${port})`;
  } catch {
    return "configured (invalid URL redacted)";
  }
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

function gitShasMatch(left: string, right: string): boolean {
  const normalizedLeft = left.trim().toLowerCase();
  const normalizedRight = right.trim().toLowerCase();
  if (
    !/^[0-9a-f]{7,40}$/u.test(normalizedLeft) ||
    !/^[0-9a-f]{7,40}$/u.test(normalizedRight)
  ) {
    return false;
  }
  return (
    normalizedLeft.startsWith(normalizedRight) ||
    normalizedRight.startsWith(normalizedLeft)
  );
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
  return value !== undefined && !isPlaceholderEnvValue(value);
}

function hasTruthyEnvValue(env: ReadonlyMap<string, string>, key: string): boolean {
  const value = env.get(key)?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function isPlaceholderEnvValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.length === 0 ||
    normalized === "todo" ||
    normalized === "tbd" ||
    normalized === "pending" ||
    normalized === "replace-me" ||
    normalized.startsWith("<") ||
    normalized.includes("...") ||
    normalized.includes("replace-with") ||
    normalized.includes("yyyy")
  );
}

function phase7AttachmentEnvName(field: string): string {
  return `SPLIT402_PHASE7_ASSEMBLE_${field.toUpperCase()}`;
}
