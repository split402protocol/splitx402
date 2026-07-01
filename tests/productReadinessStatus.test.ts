import { describe, expect, it } from "vitest";

import {
  createSplit402ProductReadinessReport,
  formatSplit402ProductReadinessBrief,
} from "../src/productReadinessStatus.js";

describe("Split402 product readiness status", () => {
  it("reports the product as no-go until Phase 6 and Phase 7 evidence are checked", () => {
    const report = createSplit402ProductReadinessReport();

    expect(report).toMatchObject({
      schema: "split402.product_readiness_status.v1",
      product: "Split402",
      repository: "split402protocol/splitx402",
      implementationState: "public-alpha foundation implemented",
      readiness: {
        totalLaunchGates: 3,
        checkedLaunchGates: 0,
        readyLaunchGates: 0,
        checkedLaunchGatePercent: 0,
        readyLaunchGatePercent: 0,
      },
      launchDecision: "no-go",
      readyForPublicBoundary: false,
      readyForPublicAlphaDemo: false,
      readyForProductionCustody: false,
      readyForMainnet: false,
    });
    expect(report.summary).toContain("public-alpha implementation foundation");
    expect(report.summary).toContain("Missing checked evidence");
    expect(report.nextActions).toContain(
      "Create a combined launch evidence workspace with corepack pnpm product:evidence:init.",
    );
    expect(report.nextActions).toContain(
      "Run corepack pnpm product:launch-preflight --brief --workspace split402-launch-evidence and follow its next action.",
    );
    expect(report.nextActions).toContain(
      "Run corepack pnpm product:local-proof --brief --output split402-launch-evidence/local-public-alpha-proof.json.",
    );
    expect(report.nextActions).toContain(
      "Run corepack pnpm product:github-settings-review --from-github --output split402-launch-evidence/github-settings-review.txt to generate the live no-go GitHub API snapshot; use --template only for a blank manual form.",
    );
    expect(report.nextActions).toContain(
      "Fill the generated Phase 7 and Phase 6 env files with hosted staging and custody evidence values.",
    );
    expect(report.nextActions).toContain(
      "Collect Phase 7 hosted proof and Phase 6 custody evidence from the same deployed environment and source commit.",
    );
    expect(report.nextActions).toContain(
      "Run hosted Phase 7 staging proof collection and status validation.",
    );
    expect(report.nextActions).toContain(
      "Run corepack pnpm product:status --brief --workspace split402-launch-evidence.",
    );
    expect(report.nextActions).not.toContain(
      "Create the evidence workspace with corepack pnpm phase7:staging:init.",
    );
  });

  it("reports saved local public-alpha proof without approving launch", () => {
    const report = createSplit402ProductReadinessReport({
      currentSourceCommit: "abc1234000000000000000000000000000000000",
      localProofText: createPassingLocalProofText(),
    });

    expect(report.localProof).toMatchObject({
      checked: true,
      ready: true,
      status: "passed",
      generatedAt: "2026-06-29T20:00:00.000Z",
      sourceCommit: "abc1234",
    });
    expect(report.launchDecision).toBe("no-go");
    expect(report.nextActions).not.toContain(
      "Run corepack pnpm product:local-proof --brief --output split402-launch-evidence/local-public-alpha-proof.json.",
    );
    expect(formatSplit402ProductReadinessBrief(report)).toContain(
      "Local public-alpha proof: ready",
    );
  });

  it("fails closed for invalid local proof artifacts", () => {
    const report = createSplit402ProductReadinessReport({
      localProofText: '{"schema":"wrong","status":"passed"}',
    });

    expect(report.localProof.ready).toBe(false);
    expect(report.localProof.status).toBe("failed");
    expect(report.localProof.blockers).toContain(
      "local proof schema is not split402.local_public_alpha_proof.v1",
    );
  });

  it("rejects local proof artifacts without source commit provenance", () => {
    const report = createSplit402ProductReadinessReport({
      currentSourceCommit: "abc1234000000000000000000000000000000000",
      localProofText: JSON.stringify({
        schema: "split402.local_public_alpha_proof.v1",
        status: "passed",
        launchApproval: "not_approved",
        generatedAt: "2026-06-29T20:00:00.000Z",
        checks: [
          { id: "source_worktree_clean", status: "passed" },
          { id: "repo_hygiene", status: "passed" },
          { id: "public_surface", status: "passed" },
          { id: "protocol_vectors", status: "passed" },
          { id: "router_alpha", status: "passed" },
          { id: "mcp_gateway_smoke", status: "passed" },
        ],
        notes: [],
      }),
    });

    expect(report.localProof.ready).toBe(false);
    expect(report.localProof.blockers).toContain(
      "local proof sourceCommit is missing; rerun product:local-proof",
    );
    expect(report.nextActions).toContain(
      "local proof sourceCommit is missing; rerun product:local-proof",
    );
  });

  it("rejects local proof artifacts from a different checkout", () => {
    const report = createSplit402ProductReadinessReport({
      currentSourceCommit: "def5678000000000000000000000000000000000",
      localProofText: createPassingLocalProofText(),
    });

    expect(report.localProof.ready).toBe(false);
    expect(report.localProof.blockers).toContain(
      "local proof sourceCommit does not match current checkout; rerun product:local-proof for def5678000000000000000000000000000000000",
    );
    expect(report.nextActions).toContain(
      "local proof sourceCommit does not match current checkout; rerun product:local-proof for def5678000000000000000000000000000000000",
    );
  });

  it("rejects local proof artifacts when the source worktree is dirty", () => {
    const report = createSplit402ProductReadinessReport({
      currentSourceCommit: "abc1234000000000000000000000000000000000",
      currentWorktreeDirty: true,
      localProofText: createPassingLocalProofText(),
    });

    expect(report.localProof.ready).toBe(false);
    expect(report.localProof.blockers).toContain(
      "local proof is stale because the source worktree has uncommitted changes; commit or revert them, then rerun product:local-proof",
    );
    expect(report.nextActions).toContain(
      "local proof is stale because the source worktree has uncommitted changes; commit or revert them, then rerun product:local-proof",
    );
  });

  it("rejects stale local proof artifacts missing current checks", () => {
    const report = createSplit402ProductReadinessReport({
      localProofText: JSON.stringify({
        schema: "split402.local_public_alpha_proof.v1",
        status: "passed",
        launchApproval: "not_approved",
        generatedAt: "2026-06-29T19:00:00.000Z",
        checks: [
          { id: "repo_hygiene", status: "passed" },
          { id: "protocol_vectors", status: "passed" },
          { id: "router_alpha", status: "passed" },
          { id: "mcp_gateway_smoke", status: "passed" },
        ],
        notes: [],
      }),
    });

    expect(report.localProof).toMatchObject({
      checked: true,
      ready: false,
      status: "failed",
    });
    expect(report.localProof.blockers).toContain(
      "local proof is stale; rerun product:local-proof because it is missing current checks: source_worktree_clean, public_surface",
    );
    expect(report.nextActions).toContain(
      "Run corepack pnpm product:local-proof --brief --output split402-launch-evidence/local-public-alpha-proof.json.",
    );
  });

  it("surfaces blockers from checked but incomplete evidence", () => {
    const report = createSplit402ProductReadinessReport({
      githubSettingsReviewText: createApprovedGitHubSettingsReviewText(),
      phase6EvidenceText: `review_id: pending
approval_decision: no-go
`,
      phase7ProofText: `proof_id: pending
approval_decision: no-go
proof_date: 2026-06-29
source_commit: 21113e7
control_plane_url: https://control.example
dashboard_url: https://dashboard.example
demo_merchant_url: https://merchant.example
hosted_preflight_evidence: attached: hosted-preflight.json
agent_discovery_evidence: attached: agent-discovery.json
paid_request_evidence: attached: paid-suite.log
receipt_verification_evidence: attached: receipt-verification.json
referrer_balance_evidence: attached: referrer-balance.json
dashboard_summary_evidence: attached: dashboard-summary.json
webhook_delivery_evidence: attached: webhook-delivery.json
payout_obligation_evidence: attached: payout-obligation.json
funding_balance_evidence: attached: funding-balance.json
mcp_bundle_evidence: attached: mcp-bundle.json
mcp_gateway_evidence: attached: mcp-gateway.jsonl
artifact_manifest_evidence: attached: artifact-manifest.json
commands_run: attached: commands.log
approval_notes: checked evidence is intentionally incomplete
`,
      phase7Options: {
        currentSourceCommit: "fd88024000000000000000000000000000000000",
      },
    });

    expect(report.launchDecision).toBe("no-go");
    expect(report.githubSettingsReview.ready).toBe(true);
    expect(report.phase6.evidenceBundleChecked).toBe(true);
    expect(report.phase7.proofChecked).toBe(true);
    expect(report.readiness.checkedLaunchGatePercent).toBe(100);
    expect(report.readiness.readyLaunchGatePercent).toBe(33);
    expect(report.nextActions.join("\n")).toContain(
      "Fix Phase 7 hosted proof blockers",
    );
    expect(report.nextActions.join("\n")).toContain(
      "Fix Phase 6 custody evidence blockers",
    );
    expect(report.nextActions).toContain(
      "If stale evidence files are still scaffold-only, run corepack pnpm product:evidence:init --refresh-source; otherwise recollect or regenerate filled evidence records from the current checkout before launch collection.",
    );
    expect(report.nextActions).toContain(
      "Run corepack pnpm product:launch-preflight --brief --workspace split402-launch-evidence for grouped env/setup blockers before collecting or recollecting evidence.",
    );
    const brief = formatSplit402ProductReadinessBrief(report);
    expect(brief).toContain(
      "Run corepack pnpm product:launch-preflight --brief --workspace split402-launch-evidence for grouped env/setup blockers before collecting or recollecting evidence.",
    );
    expect(brief).toContain(
      "Fix Phase 7 hosted proof blockers reported by corepack pnpm phase7:staging:status --brief.",
    );
    expect(brief).toContain(
      "Fix Phase 6 custody evidence blockers reported by corepack pnpm phase6:evidence:status --brief.",
    );
    expect(brief).toContain(
      "more actions hidden; run corepack pnpm phase7:staging:status --brief split402-launch-evidence/phase7-staging-proof.txt and corepack pnpm phase6:evidence:status --brief split402-launch-evidence/phase6-custody-evidence.txt for full phase blockers.",
    );
    expect(report.nextActions.join("\n")).toContain(
      "Fill direct Phase 6 custody review fields in split402-launch-evidence/phase6-evidence.env",
    );
    expect(report.phase6.nextActions.join("\n")).toContain(
      "Generate image provenance with corepack pnpm phase6:image-provenance",
    );
  });

  it("surfaces stale Phase 6 custody source_commit before custody review", () => {
    const report = createSplit402ProductReadinessReport({
      phase6EvidenceText: `review_id: phase6-custody-2026-06-30
source_commit: abc1234
approval_decision: no-go
`,
      phase6Options: {
        currentSourceCommit: "def5678000000000000000000000000000000000",
      },
    });

    expect(report.phase6.sourceCommitStatus).toMatchObject({
      status: "invalid",
      blockers: ["source_commit does not match current checkout"],
    });
    expect(report.nextActions).toContain(
      "If stale evidence files are still scaffold-only, run corepack pnpm product:evidence:init --refresh-source; otherwise recollect or regenerate filled evidence records from the current checkout before launch collection.",
    );
  });

  it("formats a simple operator-facing summary", () => {
    const report = createSplit402ProductReadinessReport();
    const brief = formatSplit402ProductReadinessBrief(report);

    expect(brief).toContain("Split402 status: no-go");
    expect(brief).toContain("Launch gates ready: 0/3 (0%)");
    expect(brief).toContain("Launch gates checked: 0/3 (0%)");
    expect(brief).toContain(
      "GitHub public/private and license review: not checked",
    );
    expect(brief).toContain("Phase 7 hosted public-alpha proof: not checked");
    expect(brief).toContain("Phase 6 production custody evidence: not checked");
    expect(brief).toContain("Mainnet ready: no");
    expect(brief).toContain("corepack pnpm product:evidence:init");
    expect(brief).toContain("generated Phase 7 and Phase 6 env files");
    expect(brief).toContain("corepack pnpm product:launch-preflight");
  });

  it("keeps launch no-go when GitHub settings review is missing", () => {
    const report = createSplit402ProductReadinessReport({
      phase6EvidenceText: `review_id: phase6-custody-2026-06-30
approval_decision: no-go
`,
      phase7ProofText: `proof_id: phase7-staging-2026-06-30
approval_decision: no-go
`,
    });

    expect(report.readiness.gates[0]).toEqual({
      gate: "public_boundary_review",
      label: "GitHub public/private and license review",
      checked: false,
      ready: false,
    });
    expect(report.readyForPublicBoundary).toBe(false);
    expect(report.launchDecision).toBe("no-go");
    expect(report.nextActions).toContain(
      "Run corepack pnpm product:github-settings-review --from-github --output split402-launch-evidence/github-settings-review.txt to generate the live no-go GitHub API snapshot; use --template only for a blank manual form.",
    );
  });

  it("keeps launch no-go when GitHub settings review is no-go", () => {
    const report = createSplit402ProductReadinessReport({
      currentSourceCommit: "fd88024000000000000000000000000000000000",
      githubSettingsReviewText: createApprovedGitHubSettingsReviewText().replace(
        "review_decision: approved",
        "review_decision: no-go",
      ),
    });

    expect(report.githubSettingsReview).toMatchObject({
      checked: true,
      ready: false,
      status: "failed",
    });
    expect(report.githubSettingsReview.blockers).toContain(
      "github settings review decision is not approved; keep launch no-go until live public/private/license review is complete",
    );
    expect(report.nextActions).toContain(
      "Complete the human GitHub public/private/license review, then set split402-launch-evidence/github-settings-review.txt review_decision to approved only when the live review is complete.",
    );
    expect(report.nextActions).not.toContain(
      "Fix GitHub public/private/license review blockers, then regenerate split402-launch-evidence/github-settings-review.txt with corepack pnpm product:github-settings-review --from-github --output split402-launch-evidence/github-settings-review.txt.",
    );
    expect(report.readyForPublicBoundary).toBe(false);
    expect(report.launchDecision).toBe("no-go");
  });

  it("marks public boundary ready with an approved current GitHub settings review", () => {
    const report = createSplit402ProductReadinessReport({
      currentSourceCommit: "fd88024000000000000000000000000000000000",
      githubSettingsReviewText: createApprovedGitHubSettingsReviewText(),
    });

    expect(report.githubSettingsReview).toMatchObject({
      checked: true,
      ready: true,
      status: "approved",
      sourceCommit: "fd88024000000000000000000000000000000000",
      blockers: [],
    });
    expect(report.readyForPublicBoundary).toBe(true);
    expect(report.readiness.gates[0]).toMatchObject({
      gate: "public_boundary_review",
      ready: true,
    });
    expect(report.launchDecision).toBe("no-go");
  });
});

function createPassingLocalProofText(): string {
  return JSON.stringify({
    schema: "split402.local_public_alpha_proof.v1",
    status: "passed",
    launchApproval: "not_approved",
    generatedAt: "2026-06-29T20:00:00.000Z",
    sourceCommit: "abc1234",
    checks: [
      { id: "source_worktree_clean", status: "passed" },
      { id: "repo_hygiene", status: "passed" },
      { id: "public_surface", status: "passed" },
      { id: "protocol_vectors", status: "passed" },
      { id: "router_alpha", status: "passed" },
      { id: "mcp_gateway_smoke", status: "passed" },
    ],
    notes: [],
  });
}

function createApprovedGitHubSettingsReviewText(): string {
  return `schema: split402.github_repository_settings_review.v1
review_id: github-settings-review-001
review_date: 2026-06-30
reviewers: split402protocol
review_method: github-ui-and-api
evidence_source: attached: github-settings-review-2026-06-30.md
repository: split402protocol/splitx402
source_commit: fd88024000000000000000000000000000000000
branch: main
about_description_matches: yes
topics_match: yes
homepage_policy_matches: yes
branch_protection_enabled: yes
requires_pull_request: yes
requires_code_owner_review: yes
requires_status_checks: yes
required_checks: Lint, Public surface check, Typecheck, Test, Build, Check vectors, Audit, Local public-alpha proof, postgres-integration, CodeQL, Secret scan
blocks_force_pushes: yes
blocks_deletion: yes
blank_issues_disabled: yes
security_advisories_enabled: yes
packages_and_releases_unpublished: yes
review_decision: approved
review_notes: live settings reviewed before launch
`;
}
