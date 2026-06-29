import type { Split402ProductReadinessReport } from "./productReadinessStatus.js";

export interface Split402LaunchChecklist {
  schema: "split402.launch_checklist.v1";
  product: "Split402";
  repository: "split402protocol/splitx402";
  launchDecision: "go" | "no-go";
  readyForMainnet: false;
  workspace: {
    directory: "split402-launch-evidence";
    phase6EvidenceFile: "split402-launch-evidence/phase6-custody-evidence.txt";
    phase6EnvFile: "split402-launch-evidence/phase6-evidence.env";
    phase7ProofFile: "split402-launch-evidence/phase7-staging-proof.txt";
    phase7EnvFile: "split402-launch-evidence/phase7-staging.env";
    phase7EvidenceDirectory: "split402-launch-evidence/phase7-staging-evidence";
  };
  sections: Split402LaunchChecklistSection[];
  nextCommand: string;
}

export interface Split402LaunchChecklistSection {
  title: string;
  status: "ready" | "blocked" | "not_checked";
  externalEvidenceRequired: boolean;
  commands: string[];
  notes: string[];
}

export function createSplit402LaunchChecklist(
  report: Split402ProductReadinessReport,
): Split402LaunchChecklist {
  return {
    schema: "split402.launch_checklist.v1",
    product: "Split402",
    repository: "split402protocol/splitx402",
    launchDecision: report.launchDecision,
    readyForMainnet: false,
    workspace: {
      directory: "split402-launch-evidence",
      phase6EvidenceFile: "split402-launch-evidence/phase6-custody-evidence.txt",
      phase6EnvFile: "split402-launch-evidence/phase6-evidence.env",
      phase7ProofFile: "split402-launch-evidence/phase7-staging-proof.txt",
      phase7EnvFile: "split402-launch-evidence/phase7-staging.env",
      phase7EvidenceDirectory: "split402-launch-evidence/phase7-staging-evidence",
    },
    sections: [
      createWorkspaceSection(report),
      createLocalValidationSection(report),
      createPhase7Section(report),
      createPhase6Section(report),
      createFinalStatusSection(report),
    ],
    nextCommand: report.nextActions[0] ?? "corepack pnpm product:status --brief",
  };
}

export function formatSplit402LaunchChecklistBrief(
  checklist: Split402LaunchChecklist,
): string {
  const sectionLines = checklist.sections.flatMap((section, index) => [
    `${index + 1}. ${section.title} [${section.status}]`,
    ...section.commands.map((command) => `   - ${command}`),
    ...section.notes.map((note) => `   note: ${note}`),
  ]);

  return [
    `Split402 launch checklist: ${checklist.launchDecision}`,
    `Mainnet ready: ${checklist.readyForMainnet ? "yes" : "no"}`,
    `Evidence workspace: ${checklist.workspace.directory}`,
    `Next command: ${checklist.nextCommand}`,
    "",
    ...sectionLines,
  ].join("\n");
}

function createWorkspaceSection(
  report: Split402ProductReadinessReport,
): Split402LaunchChecklistSection {
  const checked =
    report.phase6.evidenceBundleChecked || report.phase7.proofChecked;

  return {
    title: "Create launch evidence workspace",
    status: checked ? "ready" : "not_checked",
    externalEvidenceRequired: false,
    commands: [
      "corepack pnpm product:evidence:init",
      "corepack pnpm product:evidence:init --missing",
      "corepack pnpm product:evidence:init --refresh-source",
      "corepack pnpm product:evidence:init --force",
      "corepack pnpm product:launch-preflight --brief split402-launch-evidence",
    ],
    notes: [
      "Use --missing to create absent scaffold files without overwriting existing evidence.",
      "Use --refresh-source to update only stale scaffold source_commit values before evidence collection.",
      "Use --force only when intentionally replacing scaffold files.",
      "Do not commit secrets, private URLs, private keys, or private transaction bytes.",
    ],
  };
}

function createLocalValidationSection(
  report: Split402ProductReadinessReport,
): Split402LaunchChecklistSection {
  const commandEvidenceStatus = report.phase7.commandEvidenceStatus.status;
  const status =
    commandEvidenceStatus === "valid"
      ? "ready"
      : commandEvidenceStatus === "invalid"
        ? "blocked"
        : "not_checked";

  return {
    title: "Run local repository validation",
    status,
    externalEvidenceRequired: false,
    commands: [
      "corepack pnpm lint",
      "corepack pnpm typecheck",
      "corepack pnpm test",
      "corepack pnpm build",
      "corepack pnpm vectors:check",
      "corepack pnpm audit --audit-level high",
    ],
    notes: [
      "This section is marked ready only when Phase 7 commands_run evidence includes the required validation commands.",
      "If SPLIT402_TEST_DATABASE_URL is configured, also run corepack pnpm test:postgres.",
    ],
  };
}

function createPhase7Section(
  report: Split402ProductReadinessReport,
): Split402LaunchChecklistSection {
  return {
    title: "Collect Phase 7 hosted public-alpha proof",
    status: report.readyForPublicAlphaDemo
      ? "ready"
      : report.phase7.proofChecked
        ? "blocked"
        : "not_checked",
    externalEvidenceRequired: true,
    commands: [
      "Fill split402-launch-evidence/phase7-staging.env with hosted staging values.",
      "SPLIT402_PHASE7_SEED_CONFIRM=seed-hosted-staging corepack pnpm phase7:staging:seed",
      "corepack pnpm phase7:hosted:preflight --evidence-env-file split402-launch-evidence/phase7-staging.env",
      "corepack pnpm phase7:staging:collect-reads --evidence-env-file split402-launch-evidence/phase7-staging.env",
      "SPLIT402_PHASE7_MCP_GATEWAY_EXECUTE=1 corepack pnpm phase7:staging:collect-mcp-gateway --evidence-env-file split402-launch-evidence/phase7-staging.env",
      "corepack pnpm demo:mcp-gateway:smoke",
      "corepack pnpm phase7:staging:commands-template split402-launch-evidence/phase7-staging-evidence/commands.log",
      "corepack pnpm demo:mcp-bundle split402-launch-evidence/phase7-staging-evidence/mcp-bundle.json",
      "corepack pnpm demo:paid-suite > split402-launch-evidence/phase7-staging-evidence/paid-suite.log",
      "corepack pnpm phase7:staging:derive-receipt-verification --evidence-env-file split402-launch-evidence/phase7-staging.env",
      "corepack pnpm phase7:staging:manifest split402-launch-evidence/phase7-staging-proof.txt split402-launch-evidence/phase7-staging-evidence/artifact-manifest.json",
      "corepack pnpm phase7:staging:assemble --evidence-env-file split402-launch-evidence/phase7-staging.env split402-launch-evidence/phase7-staging-proof.txt",
      "corepack pnpm phase7:staging:status split402-launch-evidence/phase7-staging-proof.txt",
    ],
    notes: [
      "The proof must come from the same hosted environment and source commit.",
      "Leave approval_decision as no-go until every Phase 7 status gate is ready.",
    ],
  };
}

function createPhase6Section(
  report: Split402ProductReadinessReport,
): Split402LaunchChecklistSection {
  return {
    title: "Collect Phase 6 production custody evidence",
    status: report.readyForProductionCustody
      ? "ready"
      : report.phase6.evidenceBundleChecked
        ? "blocked"
        : "not_checked",
    externalEvidenceRequired: true,
    commands: [
      "Review generated split402-launch-evidence/phase6-evidence.env before editing; regenerate only if missing with corepack pnpm phase6:evidence:env-template split402-launch-evidence split402-launch-evidence/phase6-evidence.env",
      "Generate Phase 6 custody records at the paths listed in split402-launch-evidence/phase6-evidence.env.",
      "Fill split402-launch-evidence/phase6-custody-evidence.txt with generated Phase 6 custody records.",
      "corepack pnpm phase6:image-provenance",
      "corepack pnpm phase6:signer-policy",
      "corepack pnpm phase6:key-custody",
      "corepack pnpm phase6:network-policy",
      "corepack pnpm signer:payout:smoke",
      "corepack pnpm phase6:signer-smoke",
      "corepack pnpm phase6:emergency-revocation",
      "corepack pnpm phase6:rotation-drill",
      "corepack pnpm phase6:rollback-drill",
      "corepack pnpm phase6:incident-drill",
      "corepack pnpm phase6:reconciliation-drill",
      "corepack pnpm payout:finality:failover-drill",
      "corepack pnpm phase6:rpc-failover",
      "corepack pnpm phase6:evidence:assemble --evidence-env-file split402-launch-evidence/phase6-evidence.env split402-launch-evidence/phase6-custody-evidence.txt",
      "corepack pnpm phase6:evidence:status split402-launch-evidence/phase6-custody-evidence.txt",
    ],
    notes: [
      "Production custody approval requires real deployed signer, policy, drill, and custody records.",
      "This does not approve mainnet by itself.",
    ],
  };
}

function createFinalStatusSection(
  report: Split402ProductReadinessReport,
): Split402LaunchChecklistSection {
  const checked =
    report.phase6.evidenceBundleChecked || report.phase7.proofChecked;

  return {
    title: "Check combined launch readiness",
    status: report.launchDecision === "go" ? "ready" : checked ? "blocked" : "not_checked",
    externalEvidenceRequired: false,
    commands: ["corepack pnpm product:status --brief --workspace split402-launch-evidence"],
    notes: [
      "The combined status remains no-go until both machine-checkable gates pass.",
    ],
  };
}
