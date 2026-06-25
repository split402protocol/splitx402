import { createPhase6NetworkPolicyReviewRecord } from "./phase6NetworkPolicyReview.js";

const env = process.env;

try {
  console.log(
    createPhase6NetworkPolicyReviewRecord({
      reviewId: readRequiredEnv("SPLIT402_PHASE6_NETWORK_POLICY_REVIEW_ID"),
      reviewDate: env.SPLIT402_PHASE6_NETWORK_POLICY_REVIEW_DATE ?? isoDate(),
      reviewers: readRequiredEnv("SPLIT402_PHASE6_NETWORK_POLICY_REVIEWERS"),
      stagingEnvironment: readRequiredEnv(
        "SPLIT402_PHASE6_NETWORK_POLICY_STAGING_ENVIRONMENT",
      ),
      policyName: readRequiredEnv("SPLIT402_PHASE6_NETWORK_POLICY_NAME"),
      signerPodSelector: readRequiredEnv(
        "SPLIT402_PHASE6_NETWORK_POLICY_SIGNER_POD_SELECTOR",
      ),
      allowedIngressSelector: readRequiredEnv(
        "SPLIT402_PHASE6_NETWORK_POLICY_ALLOWED_INGRESS_SELECTOR",
      ),
      allowedPort: readRequiredEnv("SPLIT402_PHASE6_NETWORK_POLICY_ALLOWED_PORT"),
      serviceType: readRequiredEnv("SPLIT402_PHASE6_NETWORK_POLICY_SERVICE_TYPE"),
      appliedPolicyEvidence: readRequiredEnv(
        "SPLIT402_PHASE6_NETWORK_POLICY_APPLIED_EVIDENCE",
      ),
      deniedPublicIngressEvidence: readRequiredEnv(
        "SPLIT402_PHASE6_NETWORK_POLICY_DENIED_PUBLIC_INGRESS_EVIDENCE",
      ),
      clusterOrMeshEvidence: readRequiredEnv(
        "SPLIT402_PHASE6_NETWORK_POLICY_CLUSTER_OR_MESH_EVIDENCE",
      ),
      reviewDecision:
        env.SPLIT402_PHASE6_NETWORK_POLICY_REVIEW_DECISION ?? "no-go",
      reviewNotes: env.SPLIT402_PHASE6_NETWORK_POLICY_REVIEW_NOTES ?? "",
    }),
  );
} catch (error) {
  console.error(readErrorMessage(error));
  console.error(
    [
      "Required environment:",
      "  SPLIT402_PHASE6_NETWORK_POLICY_REVIEW_ID",
      "  SPLIT402_PHASE6_NETWORK_POLICY_REVIEWERS",
      "  SPLIT402_PHASE6_NETWORK_POLICY_STAGING_ENVIRONMENT",
      "  SPLIT402_PHASE6_NETWORK_POLICY_NAME",
      "  SPLIT402_PHASE6_NETWORK_POLICY_SIGNER_POD_SELECTOR",
      "  SPLIT402_PHASE6_NETWORK_POLICY_ALLOWED_INGRESS_SELECTOR",
      "  SPLIT402_PHASE6_NETWORK_POLICY_ALLOWED_PORT",
      "  SPLIT402_PHASE6_NETWORK_POLICY_SERVICE_TYPE",
      "  SPLIT402_PHASE6_NETWORK_POLICY_APPLIED_EVIDENCE",
      "  SPLIT402_PHASE6_NETWORK_POLICY_DENIED_PUBLIC_INGRESS_EVIDENCE",
      "  SPLIT402_PHASE6_NETWORK_POLICY_CLUSTER_OR_MESH_EVIDENCE",
      "Optional environment:",
      "  SPLIT402_PHASE6_NETWORK_POLICY_REVIEW_DATE",
      "  SPLIT402_PHASE6_NETWORK_POLICY_REVIEW_DECISION",
      "  SPLIT402_PHASE6_NETWORK_POLICY_REVIEW_NOTES",
    ].join("\n"),
  );
  process.exitCode = 1;
}

function readRequiredEnv(name: string): string {
  const value = env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function isoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
