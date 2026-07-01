import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const PUBLIC_PRESENTATION_ROOTS = [
  "README.md",
  "docs",
  "apps",
  "packages",
  ".github",
  "deploy",
] as const;

const TEXT_FILE_EXTENSIONS = new Set([
  ".json",
  ".md",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

const OLD_REPO_SLUG = ["ff", "ff"].join("");

const FORBIDDEN_OLD_REPO_REFERENCES = [
  new RegExp(`github\\.com/\\S*/${OLD_REPO_SLUG}\\b`, "iu"),
  new RegExp(`\\bsplit402protocol/${OLD_REPO_SLUG}\\b`, "iu"),
  new RegExp(`\\bsplitx402/${OLD_REPO_SLUG}\\b`, "iu"),
];

describe("repository presentation", () => {
  it("does not reintroduce old GitHub or repository references", () => {
    const offenders = listPresentationFiles()
      .map((filePath) => ({
        filePath,
        text: readFileSync(filePath, "utf8"),
      }))
      .flatMap(({ filePath, text }) =>
        FORBIDDEN_OLD_REPO_REFERENCES.filter((pattern) =>
          pattern.test(text),
        ).map((pattern) => `${filePath} matched ${pattern}`),
      );

    expect(offenders).toEqual([]);
  });

  it("keeps Split402 repository docs anchored to the canonical GitHub repo", () => {
    const readme = readFileSync("README.md", "utf8");

    expect(readme).toContain("split402protocol/splitx402");
    expect(readme).not.toMatch(new RegExp(`\\b${OLD_REPO_SLUG}\\b`, "iu"));
  });

  it("keeps the public PR workflow professional and reviewable", () => {
    const pullRequestTemplate = readFileSync(
      ".github/pull_request_template.md",
      "utf8",
    );

    expect(pullRequestTemplate).toContain("## Summary");
    expect(pullRequestTemplate).toContain("## Validation");
    expect(pullRequestTemplate).toContain("Commands run:");
    expect(pullRequestTemplate).toContain("## Protocol / Security Notes");
    expect(pullRequestTemplate).toContain("## Docs Updated");
    expect(pullRequestTemplate).toContain(
      "corepack pnpm product:public-surface-check --brief",
    );
    expect(pullRequestTemplate).toContain(
      "corepack pnpm product:local-proof --brief",
    );
    expect(pullRequestTemplate).toContain(
      "product:local-proof` intentionally fails when the source worktree is dirty",
    );
  });

  it("keeps required GitHub validation and security automation configured", () => {
    const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");
    const codeowners = readFileSync(".github/CODEOWNERS", "utf8");
    const repositorySettings = readFileSync(
      "docs/GITHUB_REPOSITORY_SETTINGS.md",
      "utf8",
    );
    const codeqlWorkflow = readFileSync(
      ".github/workflows/codeql.yml",
      "utf8",
    );
    const secretScanWorkflow = readFileSync(
      ".github/workflows/secret-scan.yml",
      "utf8",
    );
    const dependabotConfig = readFileSync(".github/dependabot.yml", "utf8");

    expect(ciWorkflow).toContain("corepack pnpm lint");
    expect(ciWorkflow).toContain(
      "corepack pnpm product:public-surface-check --brief",
    );
    expect(ciWorkflow).toContain("corepack pnpm typecheck");
    expect(ciWorkflow).toContain("corepack pnpm test");
    expect(ciWorkflow).toContain("corepack pnpm build");
    expect(ciWorkflow).toContain("corepack pnpm vectors:check");
    expect(ciWorkflow).toContain("corepack pnpm audit --audit-level high");
    expect(ciWorkflow).toContain("corepack pnpm product:local-proof --brief");
    expect(ciWorkflow).toContain("corepack pnpm test:postgres");
    expect(ciWorkflow).toContain("postgres:16");

    expect(codeowners).toContain("* @split402protocol");
    expect(codeowners).toContain("/packages/protocol/ @split402protocol");
    expect(codeowners).toContain("/packages/control-plane/ @split402protocol");
    expect(codeowners).toContain("/apps/payout-signer/ @split402protocol");
    expect(codeowners).toContain("/docs/RELEASE_POLICY.md @split402protocol");
    expect(codeowners).toContain("/.github/ @split402protocol");

    expect(repositorySettings).toContain("require pull request before merging");
    expect(repositorySettings).toContain("require review from Code Owners");
    expect(repositorySettings).toContain(
      "require status checks to pass before merge",
    );
    expect(repositorySettings).toContain("Local public-alpha proof");
    expect(repositorySettings).toContain("PostgreSQL integration tests");
    expect(repositorySettings).toContain("GitHub Security Advisories");
    expect(repositorySettings).toContain(
      "not live branch protection settings",
    );

    expect(codeqlWorkflow).toContain("github/codeql-action/init@v3");
    expect(codeqlWorkflow).toContain("javascript-typescript");

    expect(secretScanWorkflow).toContain("gitleaks/gitleaks-action@v2.3.9");
    expect(secretScanWorkflow).toContain("fetch-depth: 0");
    expect(secretScanWorkflow).toContain("GITHUB_TOKEN");

    expect(dependabotConfig).toContain('package-ecosystem: "github-actions"');
    expect(dependabotConfig).toContain('package-ecosystem: "npm"');
  });

  it("keeps public issue intake structured and security-aware", () => {
    const issueConfig = readFileSync(".github/ISSUE_TEMPLATE/config.yml", "utf8");
    const bugReport = readFileSync(
      ".github/ISSUE_TEMPLATE/bug_report.yml",
      "utf8",
    );
    const integrationQuestion = readFileSync(
      ".github/ISSUE_TEMPLATE/integration_question.yml",
      "utf8",
    );
    const phaseTask = readFileSync(
      ".github/ISSUE_TEMPLATE/phase_task.yml",
      "utf8",
    );
    const contributing = readFileSync("CONTRIBUTING.md", "utf8");

    expect(issueConfig).toContain("blank_issues_enabled: false");
    expect(issueConfig).toContain(
      "https://github.com/split402protocol/splitx402/security/advisories/new",
    );
    expect(issueConfig).toContain("docs/PUBLIC_PRIVATE_BOUNDARY.md");

    for (const issueForm of [bugReport, integrationQuestion, phaseTask]) {
      expect(issueForm).toContain("description:");
      expect(issueForm).toContain("labels:");
      expect(issueForm).toContain("validations:");
      expect(issueForm).toContain("required: true");
    }

    expect(bugReport).toContain("Report a reproducible Split402 public-alpha issue");
    expect(bugReport).toContain("This is not a suspected security vulnerability");
    expect(integrationQuestion).toContain(
      "Split402 is public alpha and not mainnet approved",
    );
    expect(phaseTask).toContain("No production/mainnet readiness claim");
    expect(phaseTask).toContain("Phase 7 public-alpha staging proof");
    expect(contributing).toContain("Use the structured GitHub issue forms");
    expect(contributing).toContain("Use GitHub Security Advisories");
  });

  it("keeps README status badges aligned with GitHub validation workflows", () => {
    const readme = readFileSync("README.md", "utf8");

    expect(readme).toContain("actions/workflows/ci.yml/badge.svg");
    expect(readme).toContain("actions/workflows/codeql.yml/badge.svg");
    expect(readme).toContain("actions/workflows/secret-scan.yml/badge.svg");
    expect(readme).toContain("docs/GITHUB_REPOSITORY_SETTINGS.md");
  });

  it("keeps the GitHub profile linked to repository settings", () => {
    const profile = readFileSync("docs/GITHUB_PUBLIC_PROFILE.md", "utf8");

    expect(profile).toContain("docs/GITHUB_REPOSITORY_SETTINGS.md");
    expect(profile).toContain("Branch protection, CODEOWNERS review");
  });

  it("keeps README lifecycle and API docs aligned with payout hardening", () => {
    const readme = readFileSync("README.md", "utf8");

    expect(readme).toContain(
      "PendingChainVerification --> Rejected: settlement rejected",
    );
    expect(readme).toContain("Allocated --> Released: safe allocation release");
    expect(readme).toContain("Finalized --> Paid: payout ledger closes once");
    expect(readme).toContain(
      "POST /v1/payout-batches/:batchId/release-allocations",
    );
    expect(readme).toContain(
      'Transactions[("payout_transactions / payout_transaction_items")]',
    );
    expect(readme).not.toContain(
      "PendingChainVerification --> DeadLetter: verifier exhausted",
    );
  });

  it("keeps public receipt ingestion endpoint docs aligned", () => {
    const readme = readFileSync("README.md", "utf8");
    const controlPlaneReadme = readFileSync(
      "packages/control-plane/README.md",
      "utf8",
    );
    const architecture = readFileSync(
      "docs/reference/split402_protocol_architecture_v0.1.md",
      "utf8",
    );

    for (const text of [readme, controlPlaneReadme, architecture]) {
      expect(text).toContain("POST /v1/receipts");
      expect(text).not.toContain("POST /v1/receipts/ingest");
    }
  });

  it("keeps Phase 6 payout safety docs aligned with implemented hardening", () => {
    const phase6 = readFileSync("docs/PHASE_6.md", "utf8");
    const roadmap = readFileSync("docs/ROADMAP.md", "utf8");
    const buildPlan = readFileSync("docs/BUILD_PLAN.md", "utf8");

    for (const text of [phase6, roadmap, buildPlan]) {
      expect(text).toContain("payout transaction-to-item");
      expect(text).toContain("transfer-content verification");
      expect(text).toContain("transaction byte verification");
    }

    for (const text of [phase6, roadmap]) {
      expect(text).toContain("signer byte verification");
      expect(text).toContain(
        "corepack pnpm product:status --brief --workspace split402-launch-evidence",
      );
    }
  });

  it("keeps adoption-layer docs aligned with router and MCP gateway state", () => {
    const buildPlan = readFileSync("docs/BUILD_PLAN.md", "utf8");
    const currentState = readFileSync("docs/CURRENT_STATE.md", "utf8");
    const roadmap = readFileSync("docs/ROADMAP.md", "utf8");

    for (const text of [buildPlan, currentState, roadmap]) {
      expect(text).toContain("@split402/router");
      expect(text).toContain("control-plane route discovery");
      expect(text).toContain("split402.searchCapabilities");
      expect(text).toContain("split402.execute");
      expect(text).toContain("split402.getReceipt");
      expect(text).toContain("not production MCP hosting");
    }
  });

  it("keeps public proof docs aligned with Phase 7 continuity gates", () => {
    const readme = readFileSync("README.md", "utf8");
    const phase7 = readFileSync("docs/PHASE_7.md", "utf8");
    const stagingProof = readFileSync(
      "docs/runbooks/phase7-staging-proof.md",
      "utf8",
    );

    expect(readme).toContain("proof gate cross-checks those artifacts");
    expect(phase7).toContain("same active route, campaign");
    expect(phase7).toContain("referrer wallet, and merchant id");
    expect(phase7).toContain("phase7:staging:commands-template");
    expect(stagingProof).toContain("proof artifacts are local-only");
    expect(stagingProof).toContain("close the status gate");
    expect(stagingProof).toContain("phase7:staging:commands-template");
    expect(stagingProof).toContain(
      "receipt summaries from a different run",
    );
    expect(phase7).toContain("no changed-file rows");
    expect(stagingProof).toContain("no changed-file rows");
  });

  it("keeps Phase 7 proof docs on the launch evidence workspace flow", () => {
    const proofDocs = [
      "README.md",
      "docs/PHASE_7.md",
      "docs/runbooks/phase7-hosted-staging.md",
      "docs/runbooks/phase7-staging-proof.md",
    ].map((filePath) => ({
      filePath,
      text: readFileSync(filePath, "utf8"),
    }));

    for (const { filePath, text } of proofDocs) {
      expect(text, filePath).toContain(
        "split402-launch-evidence/phase7-staging.env",
      );
      expect(text, filePath).toContain(
        "split402-launch-evidence/phase7-staging-proof.txt",
      );
      expect(text, filePath).toContain(
        "split402-launch-evidence/phase7-staging-evidence/artifact-manifest.json",
      );
      expect(text, filePath).not.toMatch(
        /--evidence-env-file phase7-staging-evidence\//u,
      );
      expect(text, filePath).not.toContain(
        "phase7:staging:manifest phase7-staging-proof.txt phase7-staging-evidence/artifact-manifest.json",
      );
      expect(text, filePath).not.toContain(
        "phase7:staging:assemble --evidence-env-file phase7-staging-evidence/phase7-staging.env phase7-staging-proof.txt",
      );
    }
  });

  it("documents the combined product readiness status command", () => {
    const readme = readFileSync("README.md", "utf8");
    const currentState = readFileSync("docs/CURRENT_STATE.md", "utf8");
    const releasePolicy = readFileSync("docs/RELEASE_POLICY.md", "utf8");

    expect(readme).toContain("corepack pnpm product:evidence:init");
    expect(readme).toContain("corepack pnpm product:evidence:init --help");
    expect(readme).toContain("corepack pnpm product:evidence:init --missing");
    expect(readme).toContain("corepack pnpm product:evidence:init --refresh-source");
    expect(readme).toContain("corepack pnpm product:evidence:init --force");
    expect(readme).toContain("corepack pnpm product:local-proof --help");
    expect(readme).toContain("corepack pnpm product:local-proof --brief");
    expect(readme).toContain(
      "corepack pnpm product:github-settings-review --template --output split402-launch-evidence/github-settings-review.txt",
    );
    expect(readme).toContain("corepack pnpm product:github-settings-review");
    expect(readme).toContain("corepack pnpm product:public-surface-check --brief");
    expect(readme).toContain(
      "corepack pnpm product:local-proof --brief --output split402-launch-evidence/local-public-alpha-proof.json",
    );
    expect(readme).toContain("corepack pnpm product:launch-preflight --help");
    expect(readme).toContain("corepack pnpm product:launch-preflight --brief");
    expect(readme).toContain("corepack pnpm product:launch-checklist --help");
    expect(readme).toContain("corepack pnpm product:launch-checklist --brief");
    expect(readme).toContain(
      "corepack pnpm product:launch-checklist --brief --workspace split402-launch-evidence",
    );
    expect(readme).toContain("corepack pnpm phase6:evidence:env-template");
    expect(readme).toContain(
      "Review that generated file before editing it.",
    );
    expect(readme).toContain(
      "corepack pnpm phase6:evidence:env-template evidence/launch",
    );
    expect(readme).toContain(
      "corepack pnpm product:launch-checklist --brief <phase6-custody-evidence.txt> <phase7-staging-proof.txt>",
    );
    expect(readme).toContain("corepack pnpm product:status");
    expect(readme).toContain("corepack pnpm product:status --help");
    expect(readme).toContain("corepack pnpm product:status --brief");
    expect(readme).toContain(
      "corepack pnpm product:status --brief --workspace split402-launch-evidence",
    );
    expect(readme).toContain(
      "corepack pnpm product:mainnet-canary --brief --workspace split402-launch-evidence",
    );
    expect(readme).toContain(
      "corepack pnpm phase7:staging-proof --evidence-env-file split402-launch-evidence/phase7-staging.env split402-launch-evidence/phase7-staging-proof.txt",
    );
    expect(readme).toContain(
      "corepack pnpm phase7:staging:manifest split402-launch-evidence/phase7-staging-proof.txt split402-launch-evidence/phase7-staging-evidence/artifact-manifest.json",
    );
    expect(readme).toContain("creates a local evidence workspace");
    expect(readme).toContain("refuses to overwrite");
    expect(readme).toContain("existing scaffold files");
    expect(readme).toContain("remains `no-go`");
    expect(readme).toContain("launch-gate percentages");
    expect(readme).toContain("redacted summaries");
    expect(readme).toContain("without printing tokens, private keys");
    expect(readme).toContain("custody values");
    expect(readme).toContain("dotenv-style parsing");
    expect(readme).toContain("hides extra actions");
    expect(readme).toContain("adoption-layer smoke proof");
    expect(readme).toContain("saved proof records the source commit");
    expect(readme).toContain("fails unless the source worktree is clean");
    expect(readme).toContain("source worktree has uncommitted changes");
    expect(currentState).toContain("corepack pnpm product:evidence:init");
    expect(currentState).toContain("corepack pnpm product:local-proof");
    expect(currentState).toContain("corepack pnpm product:launch-preflight");
    expect(currentState).toContain("scaffold `source_commit` values");
    expect(currentState).toContain("redacted Phase 6 custody and Phase 7 hosted env summaries");
    expect(currentState).toContain("dotenv-style parsing");
    expect(currentState).toContain("corepack pnpm product:launch-checklist");
    expect(currentState).toContain("local env templates");
    expect(currentState).toContain("`--refresh-source`");
    expect(currentState).toContain("checked, blocked, or ready");
    expect(currentState).toContain("refuses to overwrite existing scaffold");
    expect(currentState).toContain("corepack pnpm product:status");
    expect(currentState).toContain("corepack pnpm product:mainnet-canary");
    expect(currentState).toContain("full blocker lists");
    expect(currentState).toContain("saved proof");
    expect(currentState).toContain("records the source");
    expect(currentState).toContain("fails unless the source worktree is clean");
    expect(currentState).toContain("source worktree has");
    expect(readme).toContain("source_commit` match before reporting ready");
    expect(currentState).toContain("source_commit` alignment");
    expect(releasePolicy).toContain(
      "corepack pnpm product:mainnet-canary --brief --workspace split402-launch-evidence",
    );
    expect(releasePolicy).toContain(
      "does not approve production mainnet launch",
    );
  });
});

function listPresentationFiles(): string[] {
  return PUBLIC_PRESENTATION_ROOTS.flatMap((root) => listTextFiles(root));
}

function listTextFiles(path: string): string[] {
  const stat = statSync(path);
  if (stat.isFile()) {
    return isTextFile(path) ? [path] : [];
  }

  return readdirSync(path)
    .filter((entry) => entry !== "node_modules" && entry !== "dist")
    .flatMap((entry) => listTextFiles(join(path, entry)));
}

function isTextFile(path: string): boolean {
  if (path === "README.md") {
    return true;
  }

  const extension = path.slice(path.lastIndexOf("."));
  return TEXT_FILE_EXTENSIONS.has(extension);
}
