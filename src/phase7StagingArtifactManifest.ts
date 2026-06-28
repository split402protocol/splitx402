import { createHash } from "node:crypto";

import {
  PHASE7_EVIDENCE_FIELDS,
  parsePhase7ProofRecord,
} from "./phase7StagingProof.js";

export interface Phase7StagingArtifactManifestOptions {
  artifactBaseDir: string;
  readArtifact: (path: string) => Uint8Array;
  resolveArtifactPath?: (path: string, baseDir: string) => string;
}

export interface Phase7StagingArtifactManifest {
  schema: "split402.phase7_artifact_manifest.v1";
  generatedAt: string;
  artifactBaseDir: string;
  artifacts: Phase7StagingArtifactManifestEntry[];
}

export interface Phase7StagingArtifactManifestEntry {
  evidenceField: Phase7ManifestEvidenceField;
  reference: string;
  kind: "local" | "remote";
  artifactPath?: string;
  sizeBytes?: number;
  sha256?: string;
}

export type Phase7ManifestEvidenceField = Exclude<
  (typeof PHASE7_EVIDENCE_FIELDS)[number],
  "artifact_manifest_evidence"
>;

const MANIFEST_EVIDENCE_FIELDS = PHASE7_EVIDENCE_FIELDS.filter(
  (field): field is Phase7ManifestEvidenceField =>
    field !== "artifact_manifest_evidence",
);

const LOCAL_ONLY_MANIFEST_EVIDENCE_FIELDS = new Set<Phase7ManifestEvidenceField>([
  "hosted_preflight_evidence",
  "paid_request_evidence",
  "receipt_verification_evidence",
  "referrer_balance_evidence",
  "dashboard_summary_evidence",
  "webhook_delivery_evidence",
  "payout_obligation_evidence",
  "funding_balance_evidence",
  "mcp_bundle_evidence",
  "mcp_gateway_evidence",
  "commands_run",
]);

export function createPhase7StagingArtifactManifest(
  proofText: string,
  options: Phase7StagingArtifactManifestOptions,
): Phase7StagingArtifactManifest {
  const fields = parsePhase7ProofRecord(proofText);
  return {
    schema: "split402.phase7_artifact_manifest.v1",
    generatedAt: new Date().toISOString(),
    artifactBaseDir: options.artifactBaseDir,
    artifacts: MANIFEST_EVIDENCE_FIELDS.flatMap((field) => {
      const reference = fields.get(field);
      if (reference === undefined || reference.length === 0) {
        return [];
      }
      return [createArtifactManifestEntry(field, reference, options)];
    }),
  };
}

function createArtifactManifestEntry(
  field: Phase7ManifestEvidenceField,
  reference: string,
  options: Phase7StagingArtifactManifestOptions,
): Phase7StagingArtifactManifestEntry {
  if (isHttpUrl(reference)) {
    if (LOCAL_ONLY_MANIFEST_EVIDENCE_FIELDS.has(field)) {
      throw new Error(`${field} must be an attached local artifact`);
    }
    return {
      evidenceField: field,
      reference,
      kind: "remote",
    };
  }

  const artifactPath = readAttachedArtifactPath(reference);
  if (artifactPath === undefined) {
    throw new Error(`${field} must be an attached artifact or http(s) URL`);
  }
  const resolvedPath =
    options.resolveArtifactPath === undefined
      ? `${options.artifactBaseDir}/${artifactPath}`
      : options.resolveArtifactPath(artifactPath, options.artifactBaseDir);
  const bytes = options.readArtifact(resolvedPath);
  return {
    evidenceField: field,
    reference,
    kind: "local",
    artifactPath: resolvedPath,
    sizeBytes: bytes.byteLength,
    sha256: sha256(bytes),
  };
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

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
