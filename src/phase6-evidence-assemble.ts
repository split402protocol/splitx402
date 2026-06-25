import { readFileSync } from "node:fs";

import {
  assemblePhase6CustodyEvidenceBundle,
  type Phase6EvidenceAssemblyInput,
} from "./phase6EvidenceAssembly.js";
import {
  PHASE6_CUSTODY_REQUIRED_FIELDS,
} from "./phase6CustodyReview.js";
import {
  phase6CustodyEvidenceEnvName,
  type Phase6CustodyEvidenceBundleValues,
} from "./phase6CustodyBundle.js";

const env = process.env;

try {
  const values = readDirectValues();
  const input: Phase6EvidenceAssemblyInput = {
    values,
    records: {
      imageProvenance: readOptionalFile(
        "SPLIT402_PHASE6_ASSEMBLE_IMAGE_PROVENANCE_RECORD",
      ),
      signerPolicy: readOptionalFile(
        "SPLIT402_PHASE6_ASSEMBLE_SIGNER_POLICY_RECORD",
      ),
    },
    attachments: readAttachmentPaths(),
  };

  console.log(assemblePhase6CustodyEvidenceBundle(input));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(
    [
      "Usage: corepack pnpm phase6:evidence:assemble",
      "Direct field override environment:",
      "  SPLIT402_PHASE6_EVIDENCE_<FIELD_NAME>",
      "Record extraction environment:",
      "  SPLIT402_PHASE6_ASSEMBLE_IMAGE_PROVENANCE_RECORD",
      "  SPLIT402_PHASE6_ASSEMBLE_SIGNER_POLICY_RECORD",
      "Attachment path environment:",
      "  SPLIT402_PHASE6_ASSEMBLE_NETWORK_POLICY_RECORD",
      "  SPLIT402_PHASE6_ASSEMBLE_SMOKE_CHECK_OUTPUT",
      "  SPLIT402_PHASE6_ASSEMBLE_ROTATION_DRILL_RECORD",
      "  SPLIT402_PHASE6_ASSEMBLE_EMERGENCY_REVOCATION_DRILL_RECORD",
      "  SPLIT402_PHASE6_ASSEMBLE_KEY_CUSTODY_RECORD",
      "  SPLIT402_PHASE6_ASSEMBLE_INCIDENT_DRILL_RECORD",
      "  SPLIT402_PHASE6_ASSEMBLE_ROLLBACK_DRILL_RECORD",
      "  SPLIT402_PHASE6_ASSEMBLE_RPC_FAILOVER_RECORD",
    ].join("\n"),
  );
  process.exitCode = 1;
}

function readDirectValues(): Phase6CustodyEvidenceBundleValues {
  const values: Phase6CustodyEvidenceBundleValues = {};
  for (const field of PHASE6_CUSTODY_REQUIRED_FIELDS) {
    const value = env[phase6CustodyEvidenceEnvName(field)];
    if (value !== undefined && value.trim().length > 0) {
      values[field] = value.trim();
    }
  }
  return values;
}

function readAttachmentPaths(): NonNullable<Phase6EvidenceAssemblyInput["attachments"]> {
  const attachmentEnv: ReadonlyArray<readonly [string, string]> = [
    [
      "network_policy_record",
      "SPLIT402_PHASE6_ASSEMBLE_NETWORK_POLICY_RECORD",
    ],
    [
      "signer_policy_record",
      "SPLIT402_PHASE6_ASSEMBLE_SIGNER_POLICY_RECORD",
    ],
    ["smoke_check_output", "SPLIT402_PHASE6_ASSEMBLE_SMOKE_CHECK_OUTPUT"],
    [
      "rotation_drill_record",
      "SPLIT402_PHASE6_ASSEMBLE_ROTATION_DRILL_RECORD",
    ],
    [
      "emergency_revocation_drill_record",
      "SPLIT402_PHASE6_ASSEMBLE_EMERGENCY_REVOCATION_DRILL_RECORD",
    ],
    ["key_custody_record", "SPLIT402_PHASE6_ASSEMBLE_KEY_CUSTODY_RECORD"],
    ["incident_drill_record", "SPLIT402_PHASE6_ASSEMBLE_INCIDENT_DRILL_RECORD"],
    ["rollback_drill_record", "SPLIT402_PHASE6_ASSEMBLE_ROLLBACK_DRILL_RECORD"],
    ["rpc_failover_record", "SPLIT402_PHASE6_ASSEMBLE_RPC_FAILOVER_RECORD"],
  ];

  return Object.fromEntries(
    attachmentEnv
      .map(([field, envName]) => [field, readOptionalEnv(envName)])
      .filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

function readOptionalFile(envName: string): string | undefined {
  const path = readOptionalEnv(envName);
  if (path === undefined) {
    return undefined;
  }
  return readFileSync(path, "utf8");
}

function readOptionalEnv(envName: string): string | undefined {
  const value = env[envName];
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  return value.trim();
}
