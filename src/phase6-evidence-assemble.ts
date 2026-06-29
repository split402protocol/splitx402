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
import {
  PHASE6_ATTACHMENT_ENV,
  PHASE6_RECORD_EXTRACTION_ENV,
} from "./phase6EvidenceAssemblyEnv.js";
import { loadEvidenceEnvFiles } from "./evidenceEnvFile.js";

const env = process.env;

try {
  loadEvidenceEnvFiles({
    argv: process.argv.slice(2),
    defaultEnvFiles: ["split402-launch-evidence/phase6-evidence.env"],
  });
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
      "Env file options:",
      "  --evidence-env-file <path> (optional; defaults to split402-launch-evidence/phase6-evidence.env when present)",
      "  SPLIT402_ENV_FILE=<path> (optional; uses platform path separator for multiple files)",
      "Direct field override environment:",
      "  SPLIT402_PHASE6_EVIDENCE_<FIELD_NAME>",
      "Record extraction environment:",
      ...PHASE6_RECORD_EXTRACTION_ENV.map((envName) => `  ${envName}`),
      "Attachment path environment:",
      ...PHASE6_ATTACHMENT_ENV.map((entry) => `  ${entry.envName}`),
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
  return Object.fromEntries(
    PHASE6_ATTACHMENT_ENV
      .map((entry) => [entry.field, readOptionalEnv(entry.envName)])
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
