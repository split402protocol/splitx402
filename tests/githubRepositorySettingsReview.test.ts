import { describe, expect, it } from "vitest";

import {
  assertYesNo,
  createGitHubRepositorySettingsReviewRecord,
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
      errors: ["review_date must be YYYY-MM-DD"],
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
        "required_checks must include PostgreSQL integration tests",
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
});

const REQUIRED_CHECKS =
  "Lint, Public surface check, Typecheck, Test, Build, Check vectors, Audit, Local public-alpha proof, PostgreSQL integration tests, CodeQL, Secret scan";

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
