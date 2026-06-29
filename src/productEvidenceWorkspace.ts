import {
  createPhase6CustodyEvidenceBundle,
  type Phase6CustodyEvidenceBundleValues,
} from "./phase6CustodyBundle.js";
import { createPhase6EvidenceAssemblyEnvTemplate } from "./phase6EvidenceAssemblyEnv.js";
import {
  createPhase7StagingEvidenceWorkspace,
  type Phase7StagingEvidenceWorkspace,
} from "./phase7StagingEvidenceWorkspace.js";
import { assemblePhase7StagingProof } from "./phase7StagingProofAssembly.js";

export interface Split402ProductEvidenceWorkspaceInput {
  directory?: string;
  sourceCommit?: string;
  reviewDate?: string;
}

export interface Split402ProductEvidenceWorkspace {
  directory: string;
  readmeFileName: "README.md";
  phase6EvidenceFileName: "phase6-custody-evidence.txt";
  phase6EnvFileName: "phase6-evidence.env";
  phase7ProofFileName: "phase7-staging-proof.txt";
  phase7EnvFileName: "phase7-staging.env";
  phase7: Phase7StagingEvidenceWorkspace;
  phase6EvidenceText: string;
  phase6EnvText: string;
  phase7ProofText: string;
  readmeText: string;
  nextCommands: string[];
}

export function createSplit402ProductEvidenceWorkspace(
  input: Split402ProductEvidenceWorkspaceInput = {},
): Split402ProductEvidenceWorkspace {
  const directory = input.directory ?? "split402-launch-evidence";
  const phase7 = createPhase7StagingEvidenceWorkspace({
    directory: `${directory}/phase7-staging-evidence`,
    envFilePath: `${directory}/phase7-staging.env`,
  });
  const phase6Values: Phase6CustodyEvidenceBundleValues = {
    ...(input.reviewDate === undefined ? {} : { review_date: input.reviewDate }),
    ...(input.sourceCommit === undefined ? {} : { source_commit: input.sourceCommit }),
  };
  const phase6EvidenceText = createPhase6CustodyEvidenceBundle(phase6Values);
  const phase6EvidenceFileName = "phase6-custody-evidence.txt" as const;
  const phase6EnvFileName = "phase6-evidence.env" as const;
  const phase7ProofFileName = "phase7-staging-proof.txt" as const;
  const phase7EnvFileName = "phase7-staging.env" as const;
  const phase7ProofText = createPhase7ProofText({
    directory,
    phase7,
    sourceCommit: input.sourceCommit,
    reviewDate: input.reviewDate,
  });
  const nextCommands = createNextCommands({
    directory,
    phase6EvidenceFileName,
    phase6EnvFileName,
    phase7ProofFileName,
    phase7EnvFileName,
  });

  return {
    directory,
    readmeFileName: "README.md",
    phase6EvidenceFileName,
    phase6EnvFileName,
    phase7ProofFileName,
    phase7EnvFileName,
    phase7,
    phase6EvidenceText,
    phase6EnvText: createPhase6EvidenceAssemblyEnvTemplate({
      activateRecordPathMappings: true,
      directory,
    }),
    phase7ProofText,
    readmeText: createReadmeText({
      directory,
      phase6EvidenceFileName,
      phase6EnvFileName,
      phase7ProofFileName,
      phase7EnvFileName,
      nextCommands,
    }),
    nextCommands,
  };
}

function createPhase7ProofText(input: {
  directory: string;
  phase7: Phase7StagingEvidenceWorkspace;
  sourceCommit?: string;
  reviewDate?: string;
}): string {
  return assemblePhase7StagingProof({
    values: {
      ...(input.reviewDate === undefined ? {} : { proof_date: input.reviewDate }),
      ...(input.sourceCommit === undefined ? {} : { source_commit: input.sourceCommit }),
      approval_decision: "no-go",
      approval_notes:
        "scaffold only; replace with real hosted evidence before approval",
    },
    attachments: Object.fromEntries(
      input.phase7.artifacts.map((artifact) => [
        artifact.field,
        `${relativePhase7EvidenceDirectory(input.directory, input.phase7.directory)}/${artifact.fileName}`,
      ]),
    ),
  });
}

function relativePhase7EvidenceDirectory(
  workspaceDirectory: string,
  phase7Directory: string,
): string {
  const prefix = `${workspaceDirectory}/`;
  return phase7Directory.startsWith(prefix)
    ? phase7Directory.slice(prefix.length)
    : phase7Directory;
}

function createNextCommands(input: {
  directory: string;
  phase6EvidenceFileName: string;
  phase6EnvFileName: string;
  phase7ProofFileName: string;
  phase7EnvFileName: string;
}): string[] {
  const phase6EnvFile = `${input.directory}/${input.phase6EnvFileName}`;
  const phase7EnvFile = `${input.directory}/${input.phase7EnvFileName}`;
  const phase7EnvOption = `--evidence-env-file ${phase7EnvFile}`;
  return [
    `Fill ${phase7EnvFile} with hosted staging values.`,
    `Review generated ${phase6EnvFile} before editing; regenerate only if missing with corepack pnpm phase6:evidence:env-template ${input.directory} ${phase6EnvFile}`,
    `Generate Phase 6 custody records at the paths listed in ${phase6EnvFile}.`,
    `Fill ${input.directory}/${input.phase6EvidenceFileName} with generated Phase 6 custody records.`,
    `corepack pnpm product:launch-preflight --brief --workspace ${input.directory}`,
    "SPLIT402_PHASE7_SEED_CONFIRM=seed-hosted-staging corepack pnpm phase7:staging:seed",
    `Review ${input.directory}/${input.phase7ProofFileName} and fill direct hosted proof fields.`,
    `corepack pnpm phase7:hosted:preflight ${phase7EnvOption}`,
    `corepack pnpm phase7:staging:collect-reads ${phase7EnvOption}`,
    `SPLIT402_PHASE7_MCP_GATEWAY_EXECUTE=1 corepack pnpm phase7:staging:collect-mcp-gateway ${phase7EnvOption}`,
    "corepack pnpm demo:mcp-gateway:smoke",
    `corepack pnpm phase7:staging:commands-template ${input.directory}/phase7-staging-evidence/commands.log`,
    `corepack pnpm demo:mcp-bundle ${input.directory}/phase7-staging-evidence/mcp-bundle.json`,
    `corepack pnpm demo:paid-suite ${input.directory}/phase7-staging-evidence/paid-suite.log`,
    `corepack pnpm phase7:staging:derive-receipt-verification ${phase7EnvOption} ${input.directory}/phase7-staging-evidence/paid-suite.log ${input.directory}/phase7-staging-evidence/receipt-verification.json`,
    `corepack pnpm phase7:staging:manifest ${input.directory}/${input.phase7ProofFileName} ${input.directory}/phase7-staging-evidence/artifact-manifest.json`,
    `corepack pnpm phase7:staging:assemble ${phase7EnvOption} ${input.directory}/${input.phase7ProofFileName}`,
    `corepack pnpm phase7:staging:status ${input.directory}/${input.phase7ProofFileName}`,
    `corepack pnpm phase6:evidence:assemble --evidence-env-file ${phase6EnvFile} ${input.directory}/${input.phase6EvidenceFileName}`,
    `corepack pnpm phase6:evidence:status ${input.directory}/${input.phase6EvidenceFileName}`,
    `corepack pnpm product:status --brief --workspace ${input.directory}`,
  ];
}

function createReadmeText(input: {
  directory: string;
  phase6EvidenceFileName: string;
  phase6EnvFileName: string;
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
    `| \`${input.phase6EnvFileName}\` | Local Phase 6 custody evidence assembly environment template. |`,
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
