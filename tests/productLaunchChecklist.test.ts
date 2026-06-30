import { describe, expect, it } from "vitest";

import {
  createSplit402ProductReadinessReport,
} from "../src/productReadinessStatus.js";
import {
  createSplit402LaunchChecklist,
  formatSplit402LaunchChecklistBrief,
} from "../src/productLaunchChecklist.js";

describe("Split402 launch checklist", () => {
  it("turns product readiness into an operator checklist", () => {
    const checklist = createSplit402LaunchChecklist(
      createSplit402ProductReadinessReport(),
    );

    expect(checklist).toMatchObject({
      schema: "split402.launch_checklist.v1",
      product: "Split402",
      repository: "split402protocol/splitx402",
      launchDecision: "no-go",
      readyForMainnet: false,
      workspace: {
        directory: "split402-launch-evidence",
        localProofFile:
          "split402-launch-evidence/local-public-alpha-proof.json",
        phase6EvidenceFile:
          "split402-launch-evidence/phase6-custody-evidence.txt",
        phase6EnvFile: "split402-launch-evidence/phase6-evidence.env",
        phase7ProofFile: "split402-launch-evidence/phase7-staging-proof.txt",
      },
    });
    expect(checklist.sections.map((section) => section.title)).toEqual([
      "Create launch evidence workspace",
      "Review public/private and license boundary",
      "Run local repository validation",
      "Collect Phase 7 hosted public-alpha proof",
      "Collect Phase 6 production custody evidence",
      "Check combined launch readiness",
    ]);
    expect(checklist.sections[3]?.externalEvidenceRequired).toBe(true);
    expect(checklist.sections[0]?.commands).toContain(
      "corepack pnpm product:launch-preflight --brief --workspace split402-launch-evidence",
    );
    expect(checklist.sections[1]?.commands).toContain(
      "corepack pnpm product:github-settings-review --template",
    );
    expect(checklist.sections[1]?.commands).toContain(
      "corepack pnpm product:github-settings-review",
    );
    expect(checklist.sections[1]?.notes).toContain(
      "Do not reintroduce MIT in README, package metadata, GitHub About text, release notes, or package manifests.",
    );
    expect(checklist.sections[1]?.commands).toContain(
      "corepack pnpm product:public-surface-check --brief",
    );
    expect(checklist.sections[2]?.commands).toContain(
      "corepack pnpm product:local-proof --brief --output split402-launch-evidence/local-public-alpha-proof.json",
    );
    expect(checklist.sections[2]?.commands).toContain(
      "corepack pnpm product:public-surface-check --brief",
    );
    expect(checklist.sections[3]?.commands).toContain(
      "SPLIT402_PHASE7_MCP_GATEWAY_EXECUTE=1 corepack pnpm phase7:staging:collect-mcp-gateway --evidence-env-file split402-launch-evidence/phase7-staging.env",
    );
    expect(checklist.sections[3]?.commands[0]).toBe(
      "corepack pnpm product:launch-preflight --brief --workspace split402-launch-evidence",
    );
    expect(checklist.sections[3]?.commands[1]).toBe(
      "Fill split402-launch-evidence/phase7-staging.env with hosted staging values reported by launch preflight.",
    );
    expect(checklist.sections[3]?.commands).toContain(
      "corepack pnpm phase7:staging:commands-template split402-launch-evidence/phase7-staging-evidence/commands.log",
    );
    expect(checklist.sections[4]?.commands[0]).toBe(
      "corepack pnpm product:launch-preflight --brief --workspace split402-launch-evidence",
    );
    expect(checklist.sections[4]?.commands).toContain(
      "Review generated split402-launch-evidence/phase6-evidence.env before editing; regenerate only if missing with corepack pnpm phase6:evidence:env-template split402-launch-evidence split402-launch-evidence/phase6-evidence.env",
    );
    expect(checklist.sections[4]?.commands).toContain(
      "Generate Phase 6 custody records at the paths listed in split402-launch-evidence/phase6-evidence.env.",
    );
    expect(checklist.sections[4]?.commands).toContain(
      "corepack pnpm phase6:evidence:status --brief split402-launch-evidence/phase6-custody-evidence.txt",
    );
    expect(checklist.sections[5]?.commands).toContain(
      "corepack pnpm product:status --brief --workspace split402-launch-evidence",
    );
    expect(checklist.nextCommand).toBe(
      "corepack pnpm product:evidence:init",
    );
  });

  it("formats the launch checklist for humans without changing no-go posture", () => {
    const checklist = createSplit402LaunchChecklist(
      createSplit402ProductReadinessReport(),
    );

    expect(formatSplit402LaunchChecklistBrief(checklist)).toContain(
      "Split402 launch checklist: no-go",
    );
    expect(formatSplit402LaunchChecklistBrief(checklist)).toContain(
      "Mainnet ready: no",
    );
    expect(formatSplit402LaunchChecklistBrief(checklist)).toContain(
      "corepack pnpm product:evidence:init --missing",
    );
    expect(formatSplit402LaunchChecklistBrief(checklist)).toContain(
      "corepack pnpm product:evidence:init --refresh-source",
    );
    expect(formatSplit402LaunchChecklistBrief(checklist)).toContain(
      "corepack pnpm product:evidence:init --force",
    );
    expect(formatSplit402LaunchChecklistBrief(checklist)).toContain(
      "Review public/private and license boundary",
    );
    expect(formatSplit402LaunchChecklistBrief(checklist)).toContain(
      "corepack pnpm product:github-settings-review --template",
    );
    expect(formatSplit402LaunchChecklistBrief(checklist)).toContain(
      "local-public-alpha-proof.json",
    );
    expect(formatSplit402LaunchChecklistBrief(checklist)).toContain(
      "The combined status remains no-go until both machine-checkable gates pass.",
    );
  });

  it("marks checked but incomplete evidence sections as blocked", () => {
    const checklist = createSplit402LaunchChecklist(
      createSplit402ProductReadinessReport({
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
      }),
    );

    expect(checklist.sections.map((section) => section.status)).toEqual([
      "ready",
      "not_checked",
      "not_checked",
      "blocked",
      "blocked",
      "blocked",
    ]);
    expect(checklist.nextCommand).toBe(
      "corepack pnpm product:github-settings-review --template",
    );
    expect(formatSplit402LaunchChecklistBrief(checklist)).toContain(
      "Collect Phase 7 hosted public-alpha proof [blocked]",
    );
  });

  it("points checked external-evidence blockers back to grouped launch preflight after local proof is ready", () => {
    const checklist = createSplit402LaunchChecklist(
      createSplit402ProductReadinessReport({
        localProofText: JSON.stringify({
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
        }),
        phase6EvidenceText: `review_id: pending
approval_decision: no-go
`,
        phase7ProofText: `proof_id: pending
approval_decision: no-go
`,
      }),
    );

    expect(checklist.sections.map((section) => section.status)).toEqual([
      "ready",
      "not_checked",
      "ready",
      "blocked",
      "blocked",
      "blocked",
    ]);
    expect(checklist.nextCommand).toBe(
      "corepack pnpm product:github-settings-review --template",
    );
  });

  it("marks local validation ready when command evidence is valid", () => {
    const artifacts = new Map<string, Uint8Array>([
      ["evidence/commands.log", encode(createValidCommandsLog())],
    ]);
    const checklist = createSplit402LaunchChecklist(
      createSplit402ProductReadinessReport({
        phase7ProofText: "commands_run: attached: commands.log\n",
        phase7Options: {
          artifactBaseDir: "evidence",
          readArtifact: (path) => readArtifact(artifacts, path),
          resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
        },
      }),
    );

    expect(checklist.sections[1]).toMatchObject({
      title: "Review public/private and license boundary",
      status: "not_checked",
      externalEvidenceRequired: false,
    });
    expect(checklist.sections[2]).toMatchObject({
      title: "Run local repository validation",
      status: "ready",
      externalEvidenceRequired: false,
    });
  });

  it("marks local validation ready when saved local proof passes", () => {
    const checklist = createSplit402LaunchChecklist(
      createSplit402ProductReadinessReport({
        localProofText: JSON.stringify({
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
        }),
      }),
    );

    expect(checklist.sections[2]).toMatchObject({
      title: "Run local repository validation",
      status: "ready",
      externalEvidenceRequired: false,
    });
    expect(checklist.nextCommand).toBe("corepack pnpm product:evidence:init");
  });

  it("marks local validation blocked when command evidence is invalid", () => {
    const artifacts = new Map<string, Uint8Array>([
      ["evidence/commands.log", encode("$ corepack pnpm lint\n")],
    ]);
    const checklist = createSplit402LaunchChecklist(
      createSplit402ProductReadinessReport({
        phase7ProofText: "commands_run: attached: commands.log\n",
        phase7Options: {
          artifactBaseDir: "evidence",
          readArtifact: (path) => readArtifact(artifacts, path),
          resolveArtifactPath: (path, baseDir) => `${baseDir}/${path}`,
        },
      }),
    );

    expect(checklist.sections[1]).toMatchObject({
      title: "Review public/private and license boundary",
      status: "not_checked",
      externalEvidenceRequired: false,
    });
    expect(checklist.sections[2]).toMatchObject({
      title: "Run local repository validation",
      status: "blocked",
      externalEvidenceRequired: false,
    });
  });

  it("marks public review ready only after the GitHub settings review is approved", () => {
    const checklist = createSplit402LaunchChecklist(
      createSplit402ProductReadinessReport(),
      {
        githubSettingsReviewPath:
          "split402-launch-evidence/github-settings-review.txt",
        githubSettingsReviewText: createApprovedGitHubSettingsReview(),
      },
    );

    expect(checklist.sections[1]).toMatchObject({
      title: "Review public/private and license boundary",
      status: "ready",
      externalEvidenceRequired: false,
    });
    expect(checklist.sections[1]?.notes).toContain(
      "split402-launch-evidence/github-settings-review.txt is approved and well formed.",
    );
  });

  it("blocks public review when the GitHub settings review is malformed", () => {
    const checklist = createSplit402LaunchChecklist(
      createSplit402ProductReadinessReport(),
      {
        githubSettingsReviewPath:
          "split402-launch-evidence/github-settings-review.txt",
        githubSettingsReviewText: `schema: split402.github_repository_settings_review.v1
review_decision: approved
`,
      },
    );

    expect(checklist.sections[1]).toMatchObject({
      title: "Review public/private and license boundary",
      status: "blocked",
      externalEvidenceRequired: false,
    });
    expect(checklist.sections[1]?.notes.join("\n")).toContain(
      "Fix split402-launch-evidence/github-settings-review.txt: review_id is required.",
    );
  });

  it("blocks public review when the GitHub settings review remains no-go", () => {
    const checklist = createSplit402LaunchChecklist(
      createSplit402ProductReadinessReport(),
      {
        githubSettingsReviewPath:
          "split402-launch-evidence/github-settings-review.txt",
        githubSettingsReviewText: createApprovedGitHubSettingsReview().replace(
          "review_decision: approved",
          "review_decision: no-go",
        ),
      },
    );

    expect(checklist.sections[1]).toMatchObject({
      title: "Review public/private and license boundary",
      status: "blocked",
      externalEvidenceRequired: false,
    });
    expect(checklist.sections[1]?.notes).toContain(
      "Set split402-launch-evidence/github-settings-review.txt review_decision to approved only after the live public/private/license review is complete.",
    );
  });
});

function createValidCommandsLog(): string {
  return [
    "$ git rev-parse HEAD",
    "fd88024000000000000000000000000000000000",
    "$ git status --short --branch",
    "## main...origin/main",
    "$ corepack pnpm phase7:staging:init",
    "$ corepack pnpm product:launch-preflight --brief --workspace split402-launch-evidence",
    "Split402 launch preflight: ready",
    "$ SPLIT402_PHASE7_SEED_CONFIRM=seed-hosted-staging corepack pnpm phase7:staging:seed",
    "$ corepack pnpm phase7:staging-proof phase7-staging-proof.txt",
    "$ corepack pnpm phase7:hosted:preflight",
    "$ corepack pnpm phase7:staging:collect-reads",
    "$ corepack pnpm phase7:staging:collect-mcp-gateway",
    "$ corepack pnpm demo:mcp-gateway:smoke",
    "$ corepack pnpm demo:mcp-bundle phase7-staging-evidence/mcp-bundle.json",
    "$ corepack pnpm demo:paid-suite phase7-staging-evidence/paid-suite.log",
    "$ corepack pnpm phase7:staging:derive-receipt-verification phase7-staging-evidence/paid-suite.log phase7-staging-evidence/receipt-verification.json",
    "$ corepack pnpm phase7:staging:manifest phase7-staging-proof.txt phase7-staging-evidence/artifact-manifest.json",
    "$ corepack pnpm phase7:staging:assemble phase7-staging-proof.txt",
    "$ corepack pnpm phase7:staging:status phase7-staging-proof.txt",
    "$ corepack pnpm lint",
    "$ corepack pnpm product:public-surface-check --brief",
    "Split402 public surface check: passed",
    "$ corepack pnpm typecheck",
    "$ corepack pnpm test",
    "$ corepack pnpm build",
    "$ corepack pnpm vectors:check",
    "$ corepack pnpm audit --audit-level high",
    "",
  ].join("\n");
}

function readArtifact(
  artifacts: ReadonlyMap<string, Uint8Array>,
  path: string,
): Uint8Array {
  const artifact = artifacts.get(path);
  if (artifact === undefined) {
    throw new Error(`missing artifact ${path}`);
  }
  return artifact;
}

function encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function createApprovedGitHubSettingsReview(): string {
  return `schema: split402.github_repository_settings_review.v1
review_id: github-settings-review-001
review_date: 2026-06-30
reviewers: split402protocol
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
required_checks: Lint, Public surface check, Typecheck, Test, Build, Check vectors, Audit, Local public-alpha proof, PostgreSQL integration tests, CodeQL, Secret scan
blocks_force_pushes: yes
blocks_deletion: yes
blank_issues_disabled: yes
security_advisories_enabled: yes
packages_and_releases_unpublished: yes
review_decision: approved
review_notes: live settings reviewed before launch
`;
}
