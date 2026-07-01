import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { writeCliTextOutput } from "../src/cliOutput.js";
import {
  assertYesNo,
  createGitHubRepositorySettingsReviewRecord,
  createGitHubRepositorySettingsReviewRecordFromLiveGitHub,
  createGitHubRepositorySettingsReviewTemplate,
  githubRepositorySettingsReviewRequiredEnv,
  verifyGitHubRepositorySettingsReviewRecord,
} from "../src/githubRepositorySettingsReview.js";

describe("GitHub repository settings review", () => {
  it("creates a machine-shaped review record", () => {
    const record = createGitHubRepositorySettingsReviewRecord({
      reviewId: "github-settings-review-001",
      reviewDate: "2026-06-30",
      reviewers: "split402protocol",
      reviewMethod: "github-ui-and-api",
      evidenceSource: "attached: github-settings-review-2026-06-30.md",
      repository: "split402protocol/splitx402",
      sourceCommit: "abc1234",
      branch: "main",
      aboutDescriptionMatches: "yes",
      topicsMatch: "yes",
      homepagePolicyMatches: "yes",
      branchProtectionEnabled: "yes",
      requiresPullRequest: "yes",
      requiresCodeOwnerReview: "yes",
      requiresStatusChecks: "yes",
      requiredChecks: REQUIRED_CHECKS,
      blocksForcePushes: "yes",
      blocksDeletion: "yes",
      blankIssuesDisabled: "yes",
      securityAdvisoriesEnabled: "yes",
      packagesAndReleasesUnpublished: "yes",
      reviewDecision: "approved",
      reviewNotes: "verified in GitHub UI",
    });

    expect(record).toContain(
      "schema: split402.github_repository_settings_review.v1",
    );
    expect(record).toContain("repository: split402protocol/splitx402");
    expect(record).toContain("review_method: github-ui-and-api");
    expect(record).toContain(
      "evidence_source: attached: github-settings-review-2026-06-30.md",
    );
    expect(record).toContain("requires_code_owner_review: yes");
    expect(record).toContain("required_checks: Lint, Public surface check");
    expect(record).toContain("review_decision: approved");
  });

  it("prints a no-go template for live settings review", () => {
    const template = createGitHubRepositorySettingsReviewTemplate();

    expect(template).toContain("review_decision: no-go");
    expect(template).toContain("review_method: pending");
    expect(template).toContain("evidence_source: pending");
    expect(template).toContain("branch_protection_enabled: no");
    expect(template).toContain("Local public-alpha proof");
    expect(template).toContain(
      "template only; replace with live GitHub UI/API evidence before approval",
    );
  });

  it("rejects invalid yes/no fields and wrong repositories", () => {
    expect(() => assertYesNo("maybe", "branchProtectionEnabled")).toThrow(
      "branchProtectionEnabled must be yes or no",
    );
    expect(() =>
      createGitHubRepositorySettingsReviewRecord({
        ...createValidInput(),
        repository: "someone/else",
      }),
    ).toThrow("repository must be split402protocol/splitx402");
  });

  it("verifies saved review records before launch evidence collection", () => {
    const validRecord = createGitHubRepositorySettingsReviewRecord(createValidInput());

    expect(verifyGitHubRepositorySettingsReviewRecord(validRecord)).toEqual({
      ok: true,
      errors: [],
    });
    expect(
      verifyGitHubRepositorySettingsReviewRecord(
        validRecord
          .replace("repository: split402protocol/splitx402", "repository: other/project")
          .replace("branch_protection_enabled: yes", "branch_protection_enabled: maybe"),
      ),
    ).toEqual({
      ok: false,
      errors: [
        "repository must be split402protocol/splitx402",
        "branch_protection_enabled must be yes or no",
      ],
    });
    expect(
      verifyGitHubRepositorySettingsReviewRecord(
        validRecord.replace("review_date: 2026-06-30", "review_date: soon"),
      ),
    ).toEqual({
      ok: false,
      errors: ["review_date must be a valid YYYY-MM-DD calendar date"],
    });
    expect(
      verifyGitHubRepositorySettingsReviewRecord(
        validRecord.replace("review_date: 2026-06-30", "review_date: 2026-02-30"),
      ),
    ).toEqual({
      ok: false,
      errors: ["review_date must be a valid YYYY-MM-DD calendar date"],
    });
    expect(
      verifyGitHubRepositorySettingsReviewRecord(
        validRecord.replace(`required_checks: ${REQUIRED_CHECKS}`, "required_checks: Lint"),
      ),
    ).toEqual({
      ok: false,
      errors: [
        "required_checks must include Public surface check",
        "required_checks must include Typecheck",
        "required_checks must include Test",
        "required_checks must include Build",
        "required_checks must include Check vectors",
        "required_checks must include Audit",
        "required_checks must include Local public-alpha proof",
        "required_checks must include postgres-integration",
        "required_checks must include CodeQL",
        "required_checks must include Secret scan",
      ],
    });
  });

  it("rejects approval while required GitHub settings are still no", () => {
    const approvedButUnprotected = createGitHubRepositorySettingsReviewRecord({
      ...createValidInput(),
      branchProtectionEnabled: "no",
      blocksForcePushes: "no",
      reviewDecision: "approved",
    });

    expect(
      verifyGitHubRepositorySettingsReviewRecord(approvedButUnprotected),
    ).toEqual({
      ok: false,
      errors: [
        "branch_protection_enabled must be yes before approval",
        "blocks_force_pushes must be yes before approval",
      ],
    });
  });

  it("rejects approval when live review evidence is still placeholder text", () => {
    const approvedWithoutEvidence = createGitHubRepositorySettingsReviewRecord({
      ...createValidInput(),
      reviewers: "<reviewer handles>",
      reviewMethod: "pending",
      evidenceSource: "pending",
      reviewDecision: "approved",
    });

    expect(
      verifyGitHubRepositorySettingsReviewRecord(approvedWithoutEvidence),
    ).toEqual({
      ok: false,
      errors: [
        "reviewers must be real review evidence before approval",
        "review_method must be real review evidence before approval",
        "evidence_source must be real review evidence before approval",
      ],
    });
  });

  it("lists required environment variables for the CLI", () => {
    expect(githubRepositorySettingsReviewRequiredEnv()).toContain(
      "SPLIT402_GITHUB_SETTINGS_BRANCH_PROTECTION_ENABLED",
    );
    expect(githubRepositorySettingsReviewRequiredEnv()).toContain(
      "SPLIT402_GITHUB_SETTINGS_PACKAGES_AND_RELEASES_UNPUBLISHED",
    );
  });

  it("writes the CLI template directly as UTF-8 evidence", () => {
    const directory = mkdtempSync(join(tmpdir(), "split402-github-review-"));
    const outputPath = join(directory, "github-settings-review.txt");

    try {
      writeCliTextOutput({
        text: createGitHubRepositorySettingsReviewTemplate(),
        outputPath,
      });

      const bytes = readFileSync(outputPath);
      expect(bytes[0]).toBe("s".charCodeAt(0));
      expect(bytes.toString("utf8")).toContain(
        "schema: split402.github_repository_settings_review.v1",
      );
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("creates a no-go review from live GitHub API metadata", () => {
    const record = createGitHubRepositorySettingsReviewRecordFromLiveGitHub({
      reviewId: "github-settings-review-001",
      reviewDate: "2026-06-30",
      reviewers: "split402protocol",
      evidenceSource: "attached: github-api-review.json",
      sourceCommit: "abc1234",
      releaseCount: 0,
      privateVulnerabilityReportingEnabled: true,
      repositoryMetadata: {
        nameWithOwner: "split402protocol/splitx402",
        description:
          "Agent payment routing and verifiable referral accounting for x402 APIs.",
        homepageUrl: "",
        isBlankIssuesEnabled: true,
        repositoryTopics: [
          { name: "payments" },
          { name: "protocol" },
          { name: "typescript" },
          { name: "x402" },
          { name: "agents" },
          { name: "mcp" },
          { name: "solana" },
          { name: "usdc" },
        ],
      },
      branchProtection: {
        required_pull_request_reviews: {
          require_code_owner_reviews: true,
          required_approving_review_count: 1,
        },
        required_status_checks: {
          contexts: ["test", "postgres-integration", "Gitleaks"],
          checks: [{ context: "Analyze JavaScript and TypeScript" }],
        },
        allow_force_pushes: { enabled: false },
        allow_deletions: { enabled: false },
      },
    });

    expect(record).toContain("review_method: github-api");
    expect(record).toContain("about_description_matches: yes");
    expect(record).toContain("topics_match: yes");
    expect(record).toContain("blank_issues_disabled: no");
    expect(record).toContain("security_advisories_enabled: yes");
    expect(record).toContain("packages_and_releases_unpublished: no");
    expect(record).toContain("review_decision: no-go");
    expect(verifyGitHubRepositorySettingsReviewRecord(record)).toEqual({
      ok: false,
      errors: [
        "required_checks must include Lint",
        "required_checks must include Public surface check",
        "required_checks must include Typecheck",
        "required_checks must include Test",
        "required_checks must include Build",
        "required_checks must include Check vectors",
        "required_checks must include Audit",
        "required_checks must include Local public-alpha proof",
        "required_checks must include CodeQL",
        "required_checks must include Secret scan",
      ],
    });
  });

  it("allows no-go live API snapshots before human review fields are filled", () => {
    const record = createGitHubRepositorySettingsReviewRecordFromLiveGitHub({
      reviewId: "github-settings-review-2026-06-30",
      reviewDate: "2026-06-30",
      reviewers: "pending",
      evidenceSource: "pending",
      sourceCommit: "abc1234",
      releaseCount: 0,
      packageCount: 0,
      privateVulnerabilityReportingEnabled: true,
      repositoryMetadata: {
        nameWithOwner: "split402protocol/splitx402",
        description:
          "Agent payment routing and verifiable referral accounting for x402 APIs.",
        homepageUrl: "",
        isBlankIssuesEnabled: false,
        repositoryTopics: [
          { name: "agents" },
          { name: "mcp" },
          { name: "payments" },
          { name: "protocol" },
          { name: "solana" },
          { name: "typescript" },
          { name: "usdc" },
          { name: "x402" },
        ],
      },
      branchProtection: {
        required_pull_request_reviews: {
          require_code_owner_reviews: true,
          required_approving_review_count: 1,
        },
        required_status_checks: {
          contexts: [REQUIRED_CHECKS],
        },
        allow_force_pushes: { enabled: false },
        allow_deletions: { enabled: false },
      },
    });

    expect(record).toContain("reviewers: pending");
    expect(record).toContain("evidence_source: pending");
    expect(record).toContain("review_decision: no-go");
    expect(verifyGitHubRepositorySettingsReviewRecord(record)).toEqual({
      ok: true,
      errors: [],
    });
  });

  it("allows explicit package-unpublished confirmation when the package API is unreadable", () => {
    const record = createGitHubRepositorySettingsReviewRecordFromLiveGitHub({
      ...createLiveReadyInput(),
      packageCount: undefined,
      packagesUnpublishedConfirmed: true,
      releaseCount: 0,
    });

    expect(record).toContain("packages_and_releases_unpublished: yes");
    expect(record).toContain(
      "package publication status manually confirmed unpublished because GitHub package API was unreadable",
    );
    expect(verifyGitHubRepositorySettingsReviewRecord(record)).toEqual({
      ok: true,
      errors: [],
    });
  });

  it("keeps package/release publication blocked when releases exist", () => {
    const record = createGitHubRepositorySettingsReviewRecordFromLiveGitHub({
      ...createLiveReadyInput(),
      packageCount: undefined,
      packagesUnpublishedConfirmed: true,
      releaseCount: 1,
    });

    expect(record).toContain("packages_and_releases_unpublished: no");
  });
});

const REQUIRED_CHECKS =
  "Lint, Public surface check, Typecheck, Test, Build, Check vectors, Audit, Local public-alpha proof, postgres-integration, CodeQL, Secret scan";

function createValidInput() {
  return {
    reviewId: "github-settings-review-001",
    reviewDate: "2026-06-30",
    reviewers: "split402protocol",
    reviewMethod: "github-ui-and-api",
    evidenceSource: "attached: github-settings-review-2026-06-30.md",
    repository: "split402protocol/splitx402",
    sourceCommit: "abc1234",
    branch: "main",
    aboutDescriptionMatches: "yes",
    topicsMatch: "yes",
    homepagePolicyMatches: "yes",
    branchProtectionEnabled: "yes",
    requiresPullRequest: "yes",
    requiresCodeOwnerReview: "yes",
    requiresStatusChecks: "yes",
    requiredChecks: REQUIRED_CHECKS,
    blocksForcePushes: "yes",
    blocksDeletion: "yes",
    blankIssuesDisabled: "yes",
    securityAdvisoriesEnabled: "yes",
    packagesAndReleasesUnpublished: "yes",
  };
}

function createLiveReadyInput() {
  return {
    reviewId: "github-settings-review-2026-06-30",
    reviewDate: "2026-06-30",
    reviewers: "pending",
    evidenceSource: "pending",
    sourceCommit: "abc1234",
    releaseCount: 0,
    packageCount: 0,
    privateVulnerabilityReportingEnabled: true,
    repositoryMetadata: {
      nameWithOwner: "split402protocol/splitx402",
      description:
        "Agent payment routing and verifiable referral accounting for x402 APIs.",
      homepageUrl: "",
      isBlankIssuesEnabled: false,
      repositoryTopics: [
        { name: "agents" },
        { name: "mcp" },
        { name: "payments" },
        { name: "protocol" },
        { name: "solana" },
        { name: "typescript" },
        { name: "usdc" },
        { name: "x402" },
      ],
    },
    branchProtection: {
      required_pull_request_reviews: {
        require_code_owner_reviews: true,
        required_approving_review_count: 1,
      },
      required_status_checks: {
        contexts: [REQUIRED_CHECKS],
      },
      allow_force_pushes: { enabled: false },
      allow_deletions: { enabled: false },
    },
  };
}
