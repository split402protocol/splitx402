import {
  createPhase6CustodyEvidenceBundle,
  type Phase6CustodyEvidenceBundleValues,
} from "./phase6CustodyBundle.js";
import {
  createPhase7StagingEvidenceWorkspace,
  type Phase7StagingEvidenceWorkspace,
} from "./phase7StagingEvidenceWorkspace.js";

export interface Split402ProductEvidenceWorkspaceInput {
  directory?: string;
  sourceCommit?: string;
  reviewDate?: string;
}

export interface Split402ProductEvidenceWorkspace {
  directory: string;
  readmeFileName: "README.md";
  phase6EvidenceFileName: "phase6-custody-evidence.txt";
  phase7ProofFileName: "phase7-staging-proof.txt";
  phase7EnvFileName: "phase7-staging.env";
  phase7: Phase7StagingEvidenceWorkspace;
  phase6EvidenceText: string;
  readmeText: string;
  nextCommands: string[];
}

export function createSplit402ProductEvidenceWorkspace(
  input: Split402ProductEvidenceWorkspaceInput = {},
): Split402ProductEvidenceWorkspace {
  const directory = input.directory ?? "split402-launch-evidence";
  const phase7 = createPhase7StagingEvidenceWorkspace({
    directory: `${directory}/phase7-staging-evidence`,
  });
  const phase6Values: Phase6CustodyEvidenceBundleValues = {
    ...(input.reviewDate === undefined ? {} : { review_date: input.reviewDate }),
    ...(input.sourceCommit === undefined ? {} : { source_commit: input.sourceCommit }),
  };
  const phase6EvidenceText = createPhase6CustodyEvidenceBundle(phase6Values);
  const phase6EvidenceFileName = "phase6-custody-evidence.txt" as const;
  const phase7ProofFileName = "phase7-staging-proof.txt" as const;
  const phase7EnvFileName = "phase7-staging.env" as const;
  const nextCommands = createNextCommands({
    directory,
    phase6EvidenceFileName,
    phase7ProofFileName,
    phase7EnvFileName,
  });

  return {
    directory,
    readmeFileName: "README.md",
    phase6EvidenceFileName,
    phase7ProofFileName,
    phase7EnvFileName,
    phase7,
    phase6EvidenceText,
    readmeText: createReadmeText({
      directory,
      phase6EvidenceFileName,
      phase7ProofFileName,
      phase7EnvFileName,
      nextCommands,
    }),
    nextCommands,
  };
}

function createNextCommands(input: {
  directory: string;
  phase6EvidenceFileName: string;
  phase7ProofFileName: string;
  phase7EnvFileName: string;
}): string[] {
  return [
    `Fill ${input.directory}/${input.phase7EnvFileName} with hosted staging values.`,
    `Fill ${input.directory}/${input.phase6EvidenceFileName} with generated Phase 6 custody records.`,
    "SPLIT402_PHASE7_SEED_CONFIRM=seed-hosted-staging corepack pnpm phase7:staging:seed",
    `corepack pnpm phase7:staging-proof > ${input.directory}/${input.phase7ProofFileName}`,
    "corepack pnpm phase7:hosted:preflight",
    "corepack pnpm phase7:staging:collect-reads",
    "SPLIT402_PHASE7_MCP_GATEWAY_EXECUTE=1 corepack pnpm phase7:staging:collect-mcp-gateway",
    "corepack pnpm demo:mcp-gateway:smoke",
    `corepack pnpm demo:mcp-bundle > ${input.directory}/phase7-staging-evidence/mcp-bundle.json`,
    `corepack pnpm demo:paid-suite > ${input.directory}/phase7-staging-evidence/paid-suite.log`,
    "corepack pnpm phase7:staging:derive-receipt-verification",
    `corepack pnpm phase7:staging:manifest ${input.directory}/${input.phase7ProofFileName} > ${input.directory}/phase7-staging-evidence/artifact-manifest.json`,
    `corepack pnpm phase7:staging:assemble > ${input.directory}/${input.phase7ProofFileName}`,
    `corepack pnpm phase7:staging:status ${input.directory}/${input.phase7ProofFileName}`,
    `corepack pnpm phase6:evidence:status ${input.directory}/${input.phase6EvidenceFileName}`,
    `corepack pnpm product:status --brief ${input.directory}/${input.phase6EvidenceFileName} ${input.directory}/${input.phase7ProofFileName}`,
  ];
}

function createReadmeText(input: {
  directory: string;
  phase6EvidenceFileName: string;
  phase7ProofFileName: string;
  phase7EnvFileName: string;
  nextCommands: string[];
}): string {
  return [
    "# Split402 Launch Evidence Workspace",
    "",
    "This directory is for local Phase 6 custody and Phase 7 hosted proof",
    "evidence. Do not commit secrets, private keys, private transaction bytes,",
    "or private hosted URLs.",
    "",
    "The workspace is a scaffold only. It does not prove launch readiness until",
    "real hosted staging artifacts and custody records are attached and pass the",
    "machine-checkable status commands.",
    "",
    "| Path | Purpose |",
    "| --- | --- |",
    `| \`${input.phase6EvidenceFileName}\` | Phase 6 custody evidence bundle scaffold. |`,
    `| \`${input.phase7ProofFileName}\` | Phase 7 staging proof record after assembly. |`,
    `| \`${input.phase7EnvFileName}\` | Local Phase 7 collector and attachment environment template. |`,
    "| `phase7-staging-evidence/` | Local Phase 7 artifacts parsed by the status checker. |",
    "",
    "Typical next commands:",
    "",
    "```bash",
    ...input.nextCommands,
    "```",
    "",
    "Expected current status before evidence is collected:",
    "",
    "```text",
    "Launch gates ready: 0/2 (0%)",
    "Launch gates checked: 0/2 (0%)",
    "Mainnet ready: no",
    "```",
    "",
    "The product remains `no-go` until the Phase 7 hosted proof and Phase 6",
    "custody evidence both pass.",
    "",
  ].join("\n");
}
