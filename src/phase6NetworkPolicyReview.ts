export interface Phase6NetworkPolicyReviewInput {
  reviewId: string;
  reviewDate: string;
  reviewers: string;
  stagingEnvironment: string;
  policyName: string;
  signerPodSelector: string;
  allowedIngressSelector: string;
  allowedPort: string;
  serviceType: string;
  appliedPolicyEvidence: string;
  deniedPublicIngressEvidence: string;
  clusterOrMeshEvidence: string;
  reviewDecision?: string;
  reviewNotes?: string;
}

export function createPhase6NetworkPolicyReviewRecord(
  input: Phase6NetworkPolicyReviewInput,
): string {
  const record = {
    review_id: assertRequired(input.reviewId, "reviewId"),
    review_date: assertRequired(input.reviewDate, "reviewDate"),
    reviewers: assertRequired(input.reviewers, "reviewers"),
    staging_environment: assertRequired(
      input.stagingEnvironment,
      "stagingEnvironment",
    ),
    policy_name: assertRequired(input.policyName, "policyName"),
    signer_pod_selector: assertSignerSelector(input.signerPodSelector),
    allowed_ingress_selector: assertControlPlaneSelector(
      input.allowedIngressSelector,
    ),
    allowed_port: assertAllowedPort(input.allowedPort),
    service_type: assertPrivateServiceType(input.serviceType),
    applied_policy_evidence: assertRequired(
      input.appliedPolicyEvidence,
      "appliedPolicyEvidence",
    ),
    denied_public_ingress_evidence: assertDeniedEvidence(
      input.deniedPublicIngressEvidence,
    ),
    cluster_or_mesh_evidence: assertRequired(
      input.clusterOrMeshEvidence,
      "clusterOrMeshEvidence",
    ),
    review_decision: input.reviewDecision ?? "no-go",
    review_notes: input.reviewNotes ?? "",
  };

  return `${Object.entries(record)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n")}\n`;
}

export function assertSignerSelector(value: string): string {
  const trimmed = assertRequired(value, "signerPodSelector");
  if (!trimmed.includes("split402-payout-signer")) {
    throw new Error("signerPodSelector must select split402-payout-signer pods");
  }
  return trimmed;
}

export function assertControlPlaneSelector(value: string): string {
  const trimmed = assertRequired(value, "allowedIngressSelector");
  if (!trimmed.includes("split402-control-plane")) {
    throw new Error(
      "allowedIngressSelector must restrict ingress to split402-control-plane",
    );
  }
  return trimmed;
}

export function assertAllowedPort(value: string): string {
  const trimmed = assertRequired(value, "allowedPort");
  if (!/^[1-9][0-9]*$/u.test(trimmed)) {
    throw new Error("allowedPort must be a positive TCP port");
  }

  const port = Number(trimmed);
  if (port > 65535) {
    throw new Error("allowedPort must be a valid TCP port");
  }
  return trimmed;
}

export function assertPrivateServiceType(value: string): string {
  const trimmed = assertRequired(value, "serviceType");
  if (trimmed !== "ClusterIP" && trimmed !== "private-service-mesh") {
    throw new Error("serviceType must be ClusterIP or private-service-mesh");
  }
  return trimmed;
}

export function assertDeniedEvidence(value: string): string {
  const trimmed = assertRequired(value, "deniedPublicIngressEvidence");
  const normalized = trimmed.toLowerCase();
  if (
    !normalized.includes("denied") &&
    !normalized.includes("blocked") &&
    !normalized.includes("rejected")
  ) {
    throw new Error(
      "deniedPublicIngressEvidence must mention denied, blocked, or rejected ingress",
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
