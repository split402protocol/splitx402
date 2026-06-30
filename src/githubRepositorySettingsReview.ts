export interface GitHubRepositorySettingsReviewInput {
  reviewId: string;
  reviewDate: string;
  reviewers: string;
  reviewMethod: string;
  evidenceSource: string;
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

export interface GitHubRepositorySettingsReviewVerificationResult {
  ok: boolean;
  errors: string[];
}

const GITHUB_SETTINGS_REVIEW_SCHEMA =
  "split402.github_repository_settings_review.v1";

const REQUIRED_RECORD_FIELDS = [
  "schema",
  "review_id",
  "review_date",
  "reviewers",
  "review_method",
  "evidence_source",
  "repository",
  "source_commit",
  "branch",
  "about_description_matches",
  "topics_match",
  "homepage_policy_matches",
  "branch_protection_enabled",
  "requires_pull_request",
  "requires_code_owner_review",
  "requires_status_checks",
  "required_checks",
  "blocks_force_pushes",
  "blocks_deletion",
  "blank_issues_disabled",
  "security_advisories_enabled",
  "packages_and_releases_unpublished",
  "review_decision",
] as const;

const YES_NO_RECORD_FIELDS = [
  "about_description_matches",
  "topics_match",
  "homepage_policy_matches",
  "branch_protection_enabled",
  "requires_pull_request",
  "requires_code_owner_review",
  "requires_status_checks",
  "blocks_force_pushes",
  "blocks_deletion",
  "blank_issues_disabled",
  "security_advisories_enabled",
  "packages_and_releases_unpublished",
] as const;

const REQUIRED_CHECK_LABELS = [
  "Lint",
  "Public surface check",
  "Typecheck",
  "Test",
  "Build",
  "Check vectors",
  "Audit",
  "Local public-alpha proof",
  "PostgreSQL integration tests",
  "CodeQL",
  "Secret scan",
] as const;

export function createGitHubRepositorySettingsReviewRecord(
  input: GitHubRepositorySettingsReviewInput,
): string {
  const record = {
    schema: GITHUB_SETTINGS_REVIEW_SCHEMA,
    review_id: assertRequired(input.reviewId, "reviewId"),
    review_date: assertRequired(input.reviewDate, "reviewDate"),
    reviewers: assertRequired(input.reviewers, "reviewers"),
    review_method: assertRequired(input.reviewMethod, "reviewMethod"),
    evidence_source: assertRequired(input.evidenceSource, "evidenceSource"),
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
    reviewMethod: "pending",
    evidenceSource: "pending",
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

export function verifyGitHubRepositorySettingsReviewRecord(
  text: string,
): GitHubRepositorySettingsReviewVerificationResult {
  const fields = parseRecordFields(text);
  const errors: string[] = [];

  for (const field of REQUIRED_RECORD_FIELDS) {
    if (!hasRequiredField(fields, field)) {
      errors.push(`${field} is required`);
    }
  }

  const schema = fields.get("schema");
  if (schema !== undefined && schema !== GITHUB_SETTINGS_REVIEW_SCHEMA) {
    errors.push(`schema must be ${GITHUB_SETTINGS_REVIEW_SCHEMA}`);
  }

  const repository = fields.get("repository");
  if (repository !== undefined && repository !== "split402protocol/splitx402") {
    errors.push("repository must be split402protocol/splitx402");
  }

  const sourceCommit = fields.get("source_commit");
  if (sourceCommit !== undefined && !/^[a-f0-9]{7,40}$/u.test(sourceCommit)) {
    errors.push("source_commit must be a git SHA");
  }

  const reviewDate = fields.get("review_date");
  if (reviewDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/u.test(reviewDate)) {
    errors.push("review_date must be YYYY-MM-DD");
  }

  const branch = fields.get("branch");
  if (branch !== undefined && branch !== "main") {
    errors.push("branch must be main");
  }

  for (const field of YES_NO_RECORD_FIELDS) {
    const value = fields.get(field);
    if (value !== undefined && value !== "yes" && value !== "no") {
      errors.push(`${field} must be yes or no`);
    }
  }

  const reviewDecision = fields.get("review_decision");
  if (
    reviewDecision !== undefined &&
    reviewDecision !== "no-go" &&
    reviewDecision !== "approved"
  ) {
    errors.push("review_decision must be no-go or approved");
  }
  if (reviewDecision === "approved") {
    for (const field of ["reviewers", "review_method", "evidence_source"] as const) {
      if (isPlaceholderReviewValue(fields.get(field))) {
        errors.push(`${field} must be real review evidence before approval`);
      }
    }
    for (const field of YES_NO_RECORD_FIELDS) {
      if (fields.get(field) !== "yes") {
        errors.push(`${field} must be yes before approval`);
      }
    }
  }

  const requiredChecks = fields.get("required_checks");
  if (requiredChecks !== undefined) {
    for (const label of REQUIRED_CHECK_LABELS) {
      if (!requiredChecks.includes(label)) {
        errors.push(`required_checks must include ${label}`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function githubRepositorySettingsReviewRequiredEnv(): string[] {
  return [
    "SPLIT402_GITHUB_SETTINGS_REVIEW_ID",
    "SPLIT402_GITHUB_SETTINGS_REVIEWERS",
    "SPLIT402_GITHUB_SETTINGS_REVIEW_METHOD",
    "SPLIT402_GITHUB_SETTINGS_EVIDENCE_SOURCE",
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

function hasRequiredField(
  fields: ReadonlyMap<string, string>,
  field: string,
): boolean {
  const value = fields.get(field);
  return value !== undefined && value.length > 0;
}

function isPlaceholderReviewValue(value: string | undefined): boolean {
  if (value === undefined) {
    return true;
  }
  const normalized = value.trim().toLowerCase();
  return (
    normalized.length === 0 ||
    normalized === "pending" ||
    normalized === "todo" ||
    normalized === "tbd" ||
    normalized === "template" ||
    normalized.includes("template only") ||
    normalized.includes("replace") ||
    normalized.startsWith("<")
  );
}

function parseRecordFields(text: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of text.split(/\r?\n/u)) {
    const match = /^([a-z][a-z0-9_]*):\s*(.*)$/u.exec(line);
    if (match?.[1] === undefined || match[2] === undefined) {
      continue;
    }
    fields.set(match[1], match[2].trim());
  }
  return fields;
}
