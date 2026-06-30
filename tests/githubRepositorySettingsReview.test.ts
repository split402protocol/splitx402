import { describe, expect, it } from "vitest";

import {
  assertYesNo,
  createGitHubRepositorySettingsReviewRecord,
  createGitHubRepositorySettingsReviewTemplate,
  githubRepositorySettingsReviewRequiredEnv,
} from "../src/githubRepositorySettingsReview.js";

describe("GitHub repository settings review", () => {
  it("creates a machine-shaped review record", () => {
    const record = createGitHubRepositorySettingsReviewRecord({
      reviewId: "github-settings-review-001",
      reviewDate: "2026-06-30",
      reviewers: "split402protocol",
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
      requiredChecks: "Lint, Public surface check, Local public-alpha proof",
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
    expect(record).toContain("requires_code_owner_review: yes");
    expect(record).toContain("required_checks: Lint, Public surface check");
    expect(record).toContain("review_decision: approved");
  });

  it("prints a no-go template for live settings review", () => {
    const template = createGitHubRepositorySettingsReviewTemplate();

    expect(template).toContain("review_decision: no-go");
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

  it("lists required environment variables for the CLI", () => {
    expect(githubRepositorySettingsReviewRequiredEnv()).toContain(
      "SPLIT402_GITHUB_SETTINGS_BRANCH_PROTECTION_ENABLED",
    );
    expect(githubRepositorySettingsReviewRequiredEnv()).toContain(
      "SPLIT402_GITHUB_SETTINGS_PACKAGES_AND_RELEASES_UNPUBLISHED",
    );
  });
});

function createValidInput() {
  return {
    reviewId: "github-settings-review-001",
    reviewDate: "2026-06-30",
    reviewers: "split402protocol",
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
    requiredChecks: "Lint",
    blocksForcePushes: "yes",
    blocksDeletion: "yes",
    blankIssuesDisabled: "yes",
    securityAdvisoriesEnabled: "yes",
    packagesAndReleasesUnpublished: "yes",
  };
}
