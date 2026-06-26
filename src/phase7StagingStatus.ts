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
  resolveArtifactPath?: (path: string, baseDir: string) => string;
}

export interface Phase7StagingArtifactStatus {
  evidenceField: (typeof PHASE7_EVIDENCE_FIELDS)[number];
  reference?: string;
  artifactPath?: string;
  status: "not_checked" | "remote" | "present" | "missing" | "not_applicable";
  blockers: string[];
}

export function createPhase7StagingStatusReport(
  proofText?: string,
  options: Phase7StagingStatusOptions = {},
): Phase7StagingStatusReport {
  const validation =
    proofText === undefined ? undefined : validatePhase7StagingProof(proofText);
  const artifactStatuses = createArtifactStatuses(proofText, options);
  const artifactBlockers = artifactStatuses.flatMap((status) => status.blockers);
  const readyForPublicAlphaDemo =
    (validation?.approved ?? false) && artifactBlockers.length === 0;

  return {
    schema: "split402.phase7_staging_status.v1",
    readyForPublicAlphaDemo,
    proofChecked: validation !== undefined,
    commands: PHASE7_STAGING_COMMANDS,
    gateStatuses: createGateStatuses(validation, artifactStatuses),
    artifactStatuses,
    validation,
    nextActions: createNextActions(validation, artifactBlockers),
  };
}

function createGateStatuses(
  validation: Phase7StagingProofValidation | undefined,
  artifactStatuses: readonly Phase7StagingArtifactStatus[],
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
    if (artifactBlockers.length > 0) {
      return {
        gate: command.gate,
        evidenceField: command.evidenceField,
        status: "invalid",
        blockers: artifactBlockers,
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
