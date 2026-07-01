import { execFileSync } from "node:child_process";

import { writeCliTextOutput } from "./cliOutput.js";
import {
  createGitHubRepositorySettingsReviewRecord,
  createGitHubRepositorySettingsReviewRecordFromLiveGitHub,
  createGitHubRepositorySettingsReviewTemplate,
  githubRepositorySettingsReviewOptionalEnv,
  githubRepositorySettingsReviewRequiredEnv,
  type LiveGitHubBranchProtection,
  type LiveGitHubRepositoryMetadata,
} from "./githubRepositorySettingsReview.js";

const env = process.env;
const USAGE =
  "Usage: corepack pnpm product:github-settings-review [--template|--from-github] [--output path]";
let args: ParsedArgs;
try {
  args = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

if (args.help) {
  console.log(
    [
      USAGE,
      "",
      "Generates a Split402 GitHub repository settings review record from environment variables.",
      "Use --from-github to generate a no-go record from live GitHub API settings through gh.",
      "Use --output to write a UTF-8 evidence file without shell redirection.",
    ].join("\n"),
  );
  process.exit(0);
}

if (args.template) {
  writeCliTextOutput({
    text: createGitHubRepositorySettingsReviewTemplate(),
    outputPath: args.outputPath,
  });
  process.exit(0);
}

try {
  if (args.fromGithub) {
    writeCliTextOutput({
      text: createGitHubRepositorySettingsReviewRecordFromLiveGitHub({
        reviewId:
          env.SPLIT402_GITHUB_SETTINGS_REVIEW_ID ??
          `github-settings-review-${isoDate()}`,
        reviewDate: env.SPLIT402_GITHUB_SETTINGS_REVIEW_DATE ?? isoDate(),
        reviewers: env.SPLIT402_GITHUB_SETTINGS_REVIEWERS ?? "pending",
        evidenceSource:
          env.SPLIT402_GITHUB_SETTINGS_EVIDENCE_SOURCE ?? "pending",
        repositoryMetadata: readLiveRepositoryMetadata(),
        branchProtection: readLiveBranchProtection(),
        privateVulnerabilityReportingEnabled:
          readLivePrivateVulnerabilityReportingEnabled(),
        releaseCount: readLiveReleaseCount(),
        packageCount: readLivePackageCount(),
        sourceCommit:
          env.SPLIT402_GITHUB_SETTINGS_SOURCE_COMMIT ?? readCurrentGitCommit(),
        reviewNotes: env.SPLIT402_GITHUB_SETTINGS_REVIEW_NOTES,
      }),
      outputPath: args.outputPath,
    });
    process.exit(0);
  }

  writeCliTextOutput({
    text: createGitHubRepositorySettingsReviewRecord({
      reviewId: readRequiredEnv("SPLIT402_GITHUB_SETTINGS_REVIEW_ID"),
      reviewDate: env.SPLIT402_GITHUB_SETTINGS_REVIEW_DATE ?? isoDate(),
      reviewers: readRequiredEnv("SPLIT402_GITHUB_SETTINGS_REVIEWERS"),
      reviewMethod: readRequiredEnv("SPLIT402_GITHUB_SETTINGS_REVIEW_METHOD"),
      evidenceSource: readRequiredEnv(
        "SPLIT402_GITHUB_SETTINGS_EVIDENCE_SOURCE",
      ),
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
    outputPath: args.outputPath,
  });
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

interface ParsedArgs {
  fromGithub: boolean;
  help: boolean;
  outputPath?: string;
  template: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    fromGithub: false,
    help: false,
    template: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--template") {
      parsed.template = true;
      continue;
    }
    if (arg === "--from-github") {
      parsed.fromGithub = true;
      continue;
    }
    if (arg === "--output") {
      const outputPath = argv[index + 1];
      if (outputPath === undefined || outputPath.startsWith("--")) {
        throw new Error(`${USAGE}\n--output requires a path.`);
      }
      parsed.outputPath = outputPath;
      index += 1;
      continue;
    }
    if (arg?.startsWith("--output=")) {
      const outputPath = arg.slice("--output=".length);
      if (outputPath.length === 0) {
        throw new Error(`${USAGE}\n--output requires a path.`);
      }
      parsed.outputPath = outputPath;
      continue;
    }
    throw new Error(`${USAGE}\nUnknown option: ${arg}`);
  }

  if (parsed.fromGithub && parsed.template) {
    throw new Error(`${USAGE}\nChoose either --template or --from-github.`);
  }

  return parsed;
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

function readLiveRepositoryMetadata(): LiveGitHubRepositoryMetadata {
  return JSON.parse(
    execFileSync(
      "gh",
      [
        "repo",
        "view",
        "split402protocol/splitx402",
        "--json",
        [
          "nameWithOwner",
          "description",
          "homepageUrl",
          "repositoryTopics",
          "licenseInfo",
          "isBlankIssuesEnabled",
          "hasIssuesEnabled",
        ].join(","),
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    ),
  ) as LiveGitHubRepositoryMetadata;
}

function readLiveBranchProtection(): LiveGitHubBranchProtection | undefined {
  try {
    return JSON.parse(
      execFileSync(
        "gh",
        ["api", "repos/split402protocol/splitx402/branches/main/protection"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ),
    ) as LiveGitHubBranchProtection;
  } catch {
    return undefined;
  }
}

function readLiveReleaseCount(): number | undefined {
  return readLiveArrayCount(["api", "repos/split402protocol/splitx402/releases"]);
}

function readLivePackageCount(): number | undefined {
  const npmPackages = readLiveArrayCount([
    "api",
    "orgs/split402protocol/packages?package_type=npm",
  ]);
  const containerPackages = readLiveArrayCount([
    "api",
    "orgs/split402protocol/packages?package_type=container",
  ]);
  if (npmPackages === undefined || containerPackages === undefined) {
    return undefined;
  }
  return npmPackages + containerPackages;
}

function readLiveArrayCount(args: string[]): number | undefined {
  try {
    const parsed = JSON.parse(
      execFileSync("gh", [...args, "--paginate"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    ) as unknown;
    return Array.isArray(parsed) ? parsed.length : undefined;
  } catch {
    return undefined;
  }
}

function readLivePrivateVulnerabilityReportingEnabled(): boolean | undefined {
  try {
    const parsed = JSON.parse(
      execFileSync(
        "gh",
        ["api", "repos/split402protocol/splitx402/private-vulnerability-reporting"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ),
    ) as { enabled?: boolean };
    return parsed.enabled;
  } catch {
    return undefined;
  }
}
