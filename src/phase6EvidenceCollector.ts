import {
  PHASE6_ATTACHMENT_ENV,
  PHASE6_RECORD_EXTRACTION_ENV_ENTRIES,
} from "./phase6EvidenceAssemblyEnv.js";

export interface Phase6EvidenceCollectorInput {
  env: Record<string, string | undefined>;
  force?: boolean;
  exists: (path: string) => boolean;
  runCommand: (
    file: string,
    args: readonly string[],
  ) => Phase6EvidenceCollectorCommandResult;
  writeText: (path: string, text: string) => void;
}

export interface Phase6EvidenceCollectorCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface Phase6EvidenceCollectorItem {
  name: Phase6EvidenceRecordName;
  command: string;
  envName: string;
  outputPath?: string;
  status: "written" | "blocked";
  detail: string;
}

export interface Phase6EvidenceCollectorReport {
  schema: "split402.phase6_evidence_collector.v1";
  ok: boolean;
  generated: number;
  blocked: number;
  items: Phase6EvidenceCollectorItem[];
  nextActions: string[];
}

type Phase6EvidenceRecordName =
  | "image_provenance"
  | "signer_policy"
  | "network_policy"
  | "signer_smoke"
  | "reconciliation_drill"
  | "rotation_drill"
  | "emergency_revocation_drill"
  | "key_custody"
  | "incident_drill"
  | "rollback_drill"
  | "rpc_failover";

interface RecordCommandSpec {
  name: Phase6EvidenceRecordName;
  envName: string;
  script: string;
}

export const PHASE6_EVIDENCE_COLLECTOR_RECORDS: readonly RecordCommandSpec[] = [
  {
    name: "image_provenance",
    envName: "SPLIT402_PHASE6_ASSEMBLE_IMAGE_PROVENANCE_RECORD",
    script: "phase6:image-provenance",
  },
  {
    name: "signer_policy",
    envName: "SPLIT402_PHASE6_ASSEMBLE_SIGNER_POLICY_RECORD",
    script: "phase6:signer-policy",
  },
  {
    name: "network_policy",
    envName: "SPLIT402_PHASE6_ASSEMBLE_NETWORK_POLICY_RECORD",
    script: "phase6:network-policy",
  },
  {
    name: "signer_smoke",
    envName: "SPLIT402_PHASE6_ASSEMBLE_SMOKE_CHECK_OUTPUT",
    script: "phase6:signer-smoke",
  },
  {
    name: "reconciliation_drill",
    envName: "SPLIT402_PHASE6_ASSEMBLE_UNKNOWN_OUTCOME_RECONCILIATION_RECORD",
    script: "phase6:reconciliation-drill",
  },
  {
    name: "rotation_drill",
    envName: "SPLIT402_PHASE6_ASSEMBLE_ROTATION_DRILL_RECORD",
    script: "phase6:rotation-drill",
  },
  {
    name: "emergency_revocation_drill",
    envName: "SPLIT402_PHASE6_ASSEMBLE_EMERGENCY_REVOCATION_DRILL_RECORD",
    script: "phase6:emergency-revocation",
  },
  {
    name: "key_custody",
    envName: "SPLIT402_PHASE6_ASSEMBLE_KEY_CUSTODY_RECORD",
    script: "phase6:key-custody",
  },
  {
    name: "incident_drill",
    envName: "SPLIT402_PHASE6_ASSEMBLE_INCIDENT_DRILL_RECORD",
    script: "phase6:incident-drill",
  },
  {
    name: "rollback_drill",
    envName: "SPLIT402_PHASE6_ASSEMBLE_ROLLBACK_DRILL_RECORD",
    script: "phase6:rollback-drill",
  },
  {
    name: "rpc_failover",
    envName: "SPLIT402_PHASE6_ASSEMBLE_RPC_FAILOVER_RECORD",
    script: "phase6:rpc-failover",
  },
] as const;

const knownCollectorEnvNames = new Set<string>([
  ...PHASE6_RECORD_EXTRACTION_ENV_ENTRIES.map((entry) => entry.envName),
  ...PHASE6_ATTACHMENT_ENV.map((entry) => entry.envName),
]);

export function collectPhase6EvidenceRecords(
  input: Phase6EvidenceCollectorInput,
): Phase6EvidenceCollectorReport {
  const items = PHASE6_EVIDENCE_COLLECTOR_RECORDS.map((record) =>
    collectRecord(input, record),
  );
  const blocked = items.filter((item) => item.status === "blocked").length;
  const generated = items.length - blocked;

  return {
    schema: "split402.phase6_evidence_collector.v1",
    ok: blocked === 0,
    generated,
    blocked,
    items,
    nextActions: createNextActions(blocked),
  };
}

function collectRecord(
  input: Phase6EvidenceCollectorInput,
  record: RecordCommandSpec,
): Phase6EvidenceCollectorItem {
  const outputPath = readOutputPath(input.env, record.envName);
  const command = `corepack pnpm ${record.script}`;
  if (outputPath === undefined) {
    return {
      name: record.name,
      command,
      envName: record.envName,
      status: "blocked",
      detail: `${record.envName} is not configured in the Phase 6 evidence env file.`,
    };
  }

  if (!knownCollectorEnvNames.has(record.envName)) {
    return {
      name: record.name,
      command,
      envName: record.envName,
      outputPath,
      status: "blocked",
      detail: `${record.envName} is not a recognized Phase 6 evidence output mapping.`,
    };
  }

  if (input.exists(outputPath) && input.force !== true) {
    return {
      name: record.name,
      command,
      envName: record.envName,
      outputPath,
      status: "blocked",
      detail: `${outputPath} already exists; pass --force only when intentionally replacing private evidence.`,
    };
  }

  const result = input.runCommand("corepack", ["pnpm", record.script]);
  if (result.exitCode !== 0) {
    return {
      name: record.name,
      command,
      envName: record.envName,
      outputPath,
      status: "blocked",
      detail: formatFailure(result),
    };
  }

  input.writeText(outputPath, ensureTrailingNewline(result.stdout));
  return {
    name: record.name,
    command,
    envName: record.envName,
    outputPath,
    status: "written",
    detail: `${outputPath} written from ${command}.`,
  };
}

function readOutputPath(
  env: Record<string, string | undefined>,
  envName: string,
): string | undefined {
  const value = env[envName];
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  return value.trim();
}

function formatFailure(result: Phase6EvidenceCollectorCommandResult): string {
  const stderr = result.stderr.trim();
  const stdout = result.stdout.trim();
  const details = stderr.length > 0 ? stderr : stdout;
  return details.length === 0
    ? `generator exited with code ${result.exitCode}`
    : `generator exited with code ${result.exitCode}: ${details}`;
}

function ensureTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

function createNextActions(blocked: number): string[] {
  if (blocked > 0) {
    return [
      "Fill the required generator environment values, preserve existing private evidence files, then rerun with --force only when intentionally replacing them.",
      "After all records are written, run corepack pnpm phase6:evidence:assemble --evidence-env-file split402-launch-evidence/phase6-evidence.env split402-launch-evidence/phase6-custody-evidence.txt.",
    ];
  }

  return [
    "Run corepack pnpm phase6:evidence:assemble --evidence-env-file split402-launch-evidence/phase6-evidence.env split402-launch-evidence/phase6-custody-evidence.txt.",
    "Then run corepack pnpm phase6:evidence:status --brief split402-launch-evidence/phase6-custody-evidence.txt.",
  ];
}
