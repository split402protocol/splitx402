export interface Phase6ImageProvenanceInput {
  reviewId: string;
  reviewDate: string;
  reviewers: string;
  sourceCommit: string;
  signerImageDigest: string;
  controlPlaneImageDigest: string;
  signerImageBuildCommand?: string;
  dependencyInstallCommand?: string;
  dependencyAuditCommand?: string;
  dependencyAuditOutput: string;
  buildLogRecord: string;
  sbomRecord: string;
  reviewDecision?: string;
  reviewNotes?: string;
}

export function createPhase6ImageProvenanceRecord(
  input: Phase6ImageProvenanceInput,
): string {
  const record = {
    review_id: assertRequired(input.reviewId, "reviewId"),
    review_date: assertRequired(input.reviewDate, "reviewDate"),
    reviewers: assertRequired(input.reviewers, "reviewers"),
    source_commit: assertGitSha(input.sourceCommit, "sourceCommit"),
    signer_image_digest: assertImageDigest(
      input.signerImageDigest,
      "signerImageDigest",
    ),
    control_plane_image_digest: assertImageDigest(
      input.controlPlaneImageDigest,
      "controlPlaneImageDigest",
    ),
    signer_image_build_command:
      input.signerImageBuildCommand ??
      "docker build -f apps/payout-signer/Dockerfile -t ghcr.io/split402protocol/splitx402/payout-signer:<digest> .",
    dependency_install_command:
      input.dependencyInstallCommand ?? "corepack pnpm install --frozen-lockfile",
    dependency_audit_command:
      input.dependencyAuditCommand ?? "corepack pnpm audit --audit-level high",
    dependency_audit_output: assertRequired(
      input.dependencyAuditOutput,
      "dependencyAuditOutput",
    ),
    build_log_record: assertRequired(input.buildLogRecord, "buildLogRecord"),
    sbom_record: assertRequired(input.sbomRecord, "sbomRecord"),
    review_decision: input.reviewDecision ?? "no-go",
    review_notes: input.reviewNotes ?? "",
  };

  return `${Object.entries(record)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n")}\n`;
}

export function assertImageDigest(value: string, fieldName: string): string {
  const trimmed = assertRequired(value, fieldName);
  if (!/^sha256:[a-f0-9]{64}$/u.test(trimmed)) {
    throw new Error(`${fieldName} must be an immutable sha256 digest`);
  }
  return trimmed;
}

function assertGitSha(value: string, fieldName: string): string {
  const trimmed = assertRequired(value, fieldName);
  if (!/^[a-f0-9]{7,40}$/u.test(trimmed)) {
    throw new Error(`${fieldName} must be a git SHA`);
  }
  return trimmed;
}

function assertRequired(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${fieldName} is required`);
  }
  return trimmed;
}
