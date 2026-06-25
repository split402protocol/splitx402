export interface Phase6SignerSmokeReviewInput {
  reviewId: string;
  reviewDate: string;
  reviewers: string;
  stagingEnvironment: string;
  smokeStatus: string;
  smokeService: string;
  signerReference: string;
  network: string;
  requestsTotal: string;
  signedTotal: string;
  rejectedTotal: string;
  healthReadyMetricsEvidence: string;
  endpointSecretExposureEvidence: string;
  auditLogSecretExposureEvidence: string;
  reviewDecision?: string;
  reviewNotes?: string;
}

export function createPhase6SignerSmokeReviewRecord(
  input: Phase6SignerSmokeReviewInput,
): string {
  const record = {
    review_id: assertRequired(input.reviewId, "reviewId"),
    review_date: assertRequired(input.reviewDate, "reviewDate"),
    reviewers: assertRequired(input.reviewers, "reviewers"),
    staging_environment: assertRequired(
      input.stagingEnvironment,
      "stagingEnvironment",
    ),
    smoke_status: assertSmokeStatus(input.smokeStatus),
    smoke_service: assertSmokeService(input.smokeService),
    signer_reference: assertRequired(input.signerReference, "signerReference"),
    network: assertSolanaNetwork(input.network),
    requests_total: assertNonNegativeInteger(input.requestsTotal, "requestsTotal"),
    signed_total: assertNonNegativeInteger(input.signedTotal, "signedTotal"),
    rejected_total: assertNonNegativeInteger(input.rejectedTotal, "rejectedTotal"),
    health_ready_metrics_evidence: assertRequired(
      input.healthReadyMetricsEvidence,
      "healthReadyMetricsEvidence",
    ),
    endpoint_secret_exposure_evidence: assertNoExposureEvidence(
      input.endpointSecretExposureEvidence,
      "endpointSecretExposureEvidence",
    ),
    audit_log_secret_exposure_evidence: assertNoExposureEvidence(
      input.auditLogSecretExposureEvidence,
      "auditLogSecretExposureEvidence",
    ),
    review_decision: input.reviewDecision ?? "no-go",
    review_notes: input.reviewNotes ?? "",
  };

  return `${Object.entries(record)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n")}\n`;
}

export function assertSmokeStatus(value: string): string {
  const normalized = assertRequired(value, "smokeStatus").toLowerCase();
  if (normalized !== "ok") {
    throw new Error("smokeStatus must be ok");
  }
  return normalized;
}

export function assertSmokeService(value: string): string {
  const trimmed = assertRequired(value, "smokeService");
  if (trimmed !== "split402-payout-signer") {
    throw new Error("smokeService must be split402-payout-signer");
  }
  return trimmed;
}

export function assertSolanaNetwork(value: string): string {
  const trimmed = assertRequired(value, "network");
  if (!trimmed.startsWith("solana:")) {
    throw new Error("network must start with solana:");
  }
  return trimmed;
}

export function assertNonNegativeInteger(value: string, fieldName: string): string {
  const trimmed = assertRequired(value, fieldName);
  if (!/^(0|[1-9][0-9]*)$/u.test(trimmed)) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }
  return trimmed;
}

export function assertNoExposureEvidence(value: string, fieldName: string): string {
  const trimmed = assertRequired(value, fieldName);
  const normalized = trimmed.toLowerCase();
  if (
    !normalized.includes("no secret") &&
    !normalized.includes("no shared secret") &&
    !normalized.includes("no private key") &&
    !normalized.includes("no transaction bytes")
  ) {
    throw new Error(
      `${fieldName} must mention no secret, no private key, or no transaction bytes`,
    );
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
