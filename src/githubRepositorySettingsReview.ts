export interface GitHubRepositorySettingsReviewInput {
  reviewId: string;
  reviewDate: string;
  reviewers: string;
  repository: string;
  sourceCommit: string;
  branch: string;
  aboutDescriptionMatches: string;
  topicsMatch: string;
  homepagePolicyMatches: string;
  branchProtectionEnabled: string;
  requiresPullRequest: string;
  requiresCodeOwnerReview: string;
  requiresStatusChecks: string;
  requiredChecks: string;
  blocksForcePushes: string;
  blocksDeletion: string;
  blankIssuesDisabled: string;
  securityAdvisoriesEnabled: string;
  packagesAndReleasesUnpublished: string;
  reviewDecision?: string;
  reviewNotes?: string;
}

export function createGitHubRepositorySettingsReviewRecord(
  input: GitHubRepositorySettingsReviewInput,
): string {
  const record = {
    schema: "split402.github_repository_settings_review.v1",
    review_id: assertRequired(input.reviewId, "reviewId"),
    review_date: assertRequired(input.reviewDate, "reviewDate"),
    reviewers: assertRequired(input.reviewers, "reviewers"),
    repository: assertRepository(input.repository),
    source_commit: assertGitSha(input.sourceCommit, "sourceCommit"),
    branch: assertRequired(input.branch, "branch"),
    about_description_matches: assertYesNo(
      input.aboutDescriptionMatches,
      "aboutDescriptionMatches",
    ),
    topics_match: assertYesNo(input.topicsMatch, "topicsMatch"),
    homepage_policy_matches: assertYesNo(
      input.homepagePolicyMatches,
      "homepagePolicyMatches",
    ),
    branch_protection_enabled: assertYesNo(
      input.branchProtectionEnabled,
      "branchProtectionEnabled",
    ),
    requires_pull_request: assertYesNo(
      input.requiresPullRequest,
      "requiresPullRequest",
    ),
    requires_code_owner_review: assertYesNo(
      input.requiresCodeOwnerReview,
      "requiresCodeOwnerReview",
    ),
    requires_status_checks: assertYesNo(
      input.requiresStatusChecks,
      "requiresStatusChecks",
    ),
    required_checks: assertRequired(input.requiredChecks, "requiredChecks"),
    blocks_force_pushes: assertYesNo(
      input.blocksForcePushes,
      "blocksForcePushes",
    ),
    blocks_deletion: assertYesNo(input.blocksDeletion, "blocksDeletion"),
    blank_issues_disabled: assertYesNo(
      input.blankIssuesDisabled,
      "blankIssuesDisabled",
    ),
    security_advisories_enabled: assertYesNo(
      input.securityAdvisoriesEnabled,
      "securityAdvisoriesEnabled",
    ),
    packages_and_releases_unpublished: assertYesNo(
      input.packagesAndReleasesUnpublished,
      "packagesAndReleasesUnpublished",
    ),
    review_decision: input.reviewDecision ?? "no-go",
    review_notes: input.reviewNotes ?? "",
  };

  return `${Object.entries(record)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n")}\n`;
}

export function createGitHubRepositorySettingsReviewTemplate(): string {
  return createGitHubRepositorySettingsReviewRecord({
    reviewId: "github-settings-review-001",
    reviewDate: "YYYY-MM-DD",
    reviewers: "<reviewer handles>",
    repository: "split402protocol/splitx402",
    sourceCommit: "0000000",
    branch: "main",
    aboutDescriptionMatches: "no",
    topicsMatch: "no",
    homepagePolicyMatches: "no",
    branchProtectionEnabled: "no",
    requiresPullRequest: "no",
    requiresCodeOwnerReview: "no",
    requiresStatusChecks: "no",
    requiredChecks:
      "Lint, Public surface check, Typecheck, Test, Build, Check vectors, Audit, Local public-alpha proof, PostgreSQL integration tests, CodeQL, Secret scan",
    blocksForcePushes: "no",
    blocksDeletion: "no",
    blankIssuesDisabled: "no",
    securityAdvisoriesEnabled: "no",
    packagesAndReleasesUnpublished: "no",
    reviewDecision: "no-go",
    reviewNotes:
      "template only; replace with live GitHub UI/API evidence before approval",
  });
}

export function githubRepositorySettingsReviewRequiredEnv(): string[] {
  return [
    "SPLIT402_GITHUB_SETTINGS_REVIEW_ID",
    "SPLIT402_GITHUB_SETTINGS_REVIEWERS",
    "SPLIT402_GITHUB_SETTINGS_ABOUT_DESCRIPTION_MATCHES",
    "SPLIT402_GITHUB_SETTINGS_TOPICS_MATCH",
    "SPLIT402_GITHUB_SETTINGS_HOMEPAGE_POLICY_MATCHES",
    "SPLIT402_GITHUB_SETTINGS_BRANCH_PROTECTION_ENABLED",
    "SPLIT402_GITHUB_SETTINGS_REQUIRES_PULL_REQUEST",
    "SPLIT402_GITHUB_SETTINGS_REQUIRES_CODE_OWNER_REVIEW",
    "SPLIT402_GITHUB_SETTINGS_REQUIRES_STATUS_CHECKS",
    "SPLIT402_GITHUB_SETTINGS_REQUIRED_CHECKS",
    "SPLIT402_GITHUB_SETTINGS_BLOCKS_FORCE_PUSHES",
    "SPLIT402_GITHUB_SETTINGS_BLOCKS_DELETION",
    "SPLIT402_GITHUB_SETTINGS_BLANK_ISSUES_DISABLED",
    "SPLIT402_GITHUB_SETTINGS_SECURITY_ADVISORIES_ENABLED",
    "SPLIT402_GITHUB_SETTINGS_PACKAGES_AND_RELEASES_UNPUBLISHED",
  ];
}

export function githubRepositorySettingsReviewOptionalEnv(): string[] {
  return [
    "SPLIT402_GITHUB_SETTINGS_REVIEW_DATE",
    "SPLIT402_GITHUB_SETTINGS_REPOSITORY",
    "SPLIT402_GITHUB_SETTINGS_SOURCE_COMMIT",
    "SPLIT402_GITHUB_SETTINGS_BRANCH",
    "SPLIT402_GITHUB_SETTINGS_REVIEW_DECISION",
    "SPLIT402_GITHUB_SETTINGS_REVIEW_NOTES",
  ];
}

export function assertYesNo(value: string, fieldName: string): "yes" | "no" {
  const trimmed = assertRequired(value, fieldName).toLowerCase();
  if (trimmed !== "yes" && trimmed !== "no") {
    throw new Error(`${fieldName} must be yes or no`);
  }
  return trimmed;
}

function assertRepository(value: string): string {
  const trimmed = assertRequired(value, "repository");
  if (trimmed !== "split402protocol/splitx402") {
    throw new Error("repository must be split402protocol/splitx402");
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
