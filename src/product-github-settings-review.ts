import { execFileSync } from "node:child_process";

import {
  createGitHubRepositorySettingsReviewRecord,
  createGitHubRepositorySettingsReviewTemplate,
  githubRepositorySettingsReviewOptionalEnv,
  githubRepositorySettingsReviewRequiredEnv,
} from "./githubRepositorySettingsReview.js";

const env = process.env;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(
    [
      "Usage: corepack pnpm product:github-settings-review [--template]",
      "",
      "Generates a Split402 GitHub repository settings review record from environment variables.",
    ].join("\n"),
  );
  process.exit(0);
}

if (process.argv.includes("--template")) {
  console.log(createGitHubRepositorySettingsReviewTemplate());
  process.exit(0);
}

try {
  console.log(
    createGitHubRepositorySettingsReviewRecord({
      reviewId: readRequiredEnv("SPLIT402_GITHUB_SETTINGS_REVIEW_ID"),
      reviewDate: env.SPLIT402_GITHUB_SETTINGS_REVIEW_DATE ?? isoDate(),
      reviewers: readRequiredEnv("SPLIT402_GITHUB_SETTINGS_REVIEWERS"),
      repository:
        env.SPLIT402_GITHUB_SETTINGS_REPOSITORY ??
        "split402protocol/splitx402",
      sourceCommit:
        env.SPLIT402_GITHUB_SETTINGS_SOURCE_COMMIT ?? readCurrentGitCommit(),
      branch: env.SPLIT402_GITHUB_SETTINGS_BRANCH ?? "main",
      aboutDescriptionMatches: readRequiredEnv(
        "SPLIT402_GITHUB_SETTINGS_ABOUT_DESCRIPTION_MATCHES",
      ),
      topicsMatch: readRequiredEnv("SPLIT402_GITHUB_SETTINGS_TOPICS_MATCH"),
      homepagePolicyMatches: readRequiredEnv(
        "SPLIT402_GITHUB_SETTINGS_HOMEPAGE_POLICY_MATCHES",
      ),
      branchProtectionEnabled: readRequiredEnv(
        "SPLIT402_GITHUB_SETTINGS_BRANCH_PROTECTION_ENABLED",
      ),
      requiresPullRequest: readRequiredEnv(
        "SPLIT402_GITHUB_SETTINGS_REQUIRES_PULL_REQUEST",
      ),
      requiresCodeOwnerReview: readRequiredEnv(
        "SPLIT402_GITHUB_SETTINGS_REQUIRES_CODE_OWNER_REVIEW",
      ),
      requiresStatusChecks: readRequiredEnv(
        "SPLIT402_GITHUB_SETTINGS_REQUIRES_STATUS_CHECKS",
      ),
      requiredChecks: readRequiredEnv(
        "SPLIT402_GITHUB_SETTINGS_REQUIRED_CHECKS",
      ),
      blocksForcePushes: readRequiredEnv(
        "SPLIT402_GITHUB_SETTINGS_BLOCKS_FORCE_PUSHES",
      ),
      blocksDeletion: readRequiredEnv(
        "SPLIT402_GITHUB_SETTINGS_BLOCKS_DELETION",
      ),
      blankIssuesDisabled: readRequiredEnv(
        "SPLIT402_GITHUB_SETTINGS_BLANK_ISSUES_DISABLED",
      ),
      securityAdvisoriesEnabled: readRequiredEnv(
        "SPLIT402_GITHUB_SETTINGS_SECURITY_ADVISORIES_ENABLED",
      ),
      packagesAndReleasesUnpublished: readRequiredEnv(
        "SPLIT402_GITHUB_SETTINGS_PACKAGES_AND_RELEASES_UNPUBLISHED",
      ),
      reviewDecision:
        env.SPLIT402_GITHUB_SETTINGS_REVIEW_DECISION ?? "no-go",
      reviewNotes: env.SPLIT402_GITHUB_SETTINGS_REVIEW_NOTES ?? "",
    }),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(
    [
      "Required environment:",
      ...githubRepositorySettingsReviewRequiredEnv().map((name) => `  ${name}`),
      "Optional environment:",
      ...githubRepositorySettingsReviewOptionalEnv().map((name) => `  ${name}`),
      "",
      "Use --template to print a fillable record.",
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

function readCurrentGitCommit(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

function isoDate(): string {
  return new Date().toISOString().slice(0, 10);
}
