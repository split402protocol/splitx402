import { describe, expect, it } from "vitest";

import {
  assertAllowedPort,
  assertControlPlaneSelector,
  assertDeniedEvidence,
  assertPrivateServiceType,
  assertSignerSelector,
  createPhase6NetworkPolicyReviewRecord,
} from "../src/phase6NetworkPolicyReview.js";

const VALID_REVIEW = {
  reviewId: "phase6-network-policy-001",
  reviewDate: "2026-06-26",
  reviewers: "security, operations",
  stagingEnvironment: "split402-staging",
  policyName: "split402-payout-signer-private-ingress",
  signerPodSelector: "app.kubernetes.io/name=split402-payout-signer",
  allowedIngressSelector: "app.kubernetes.io/name=split402-control-plane",
  allowedPort: "4022",
  serviceType: "ClusterIP",
  appliedPolicyEvidence: "attached: kubectl-get-networkpolicy.yaml",
  deniedPublicIngressEvidence: "attached: public ingress denied from test pod",
  clusterOrMeshEvidence: "attached: cluster-network-policy-enforcement.md",
};

describe("Phase 6 network policy review", () => {
  it("creates a network policy review record", () => {
    expect(createPhase6NetworkPolicyReviewRecord(VALID_REVIEW)).toContain(
      "policy_name: split402-payout-signer-private-ingress\n",
    );
  });

  it("requires the signer pod selector to target the signer", () => {
    expect(() => assertSignerSelector("app.kubernetes.io/name=api")).toThrow(
      "signerPodSelector must select split402-payout-signer pods",
    );
  });

  it("requires ingress to be restricted to the control plane", () => {
    expect(() => assertControlPlaneSelector("app=public-client")).toThrow(
      "allowedIngressSelector must restrict ingress to split402-control-plane",
    );
  });

  it("requires a valid TCP port", () => {
    expect(() => assertAllowedPort("0")).toThrow(
      "allowedPort must be a positive TCP port",
    );
    expect(() => assertAllowedPort("70000")).toThrow(
      "allowedPort must be a valid TCP port",
    );
  });

  it("requires a private service type", () => {
    expect(() => assertPrivateServiceType("LoadBalancer")).toThrow(
      "serviceType must be ClusterIP or private-service-mesh",
    );
  });

  it("requires public ingress denial evidence", () => {
    expect(() => assertDeniedEvidence("attached: curl succeeded")).toThrow(
      "deniedPublicIngressEvidence must mention denied, blocked, or rejected ingress",
    );
  });
});
