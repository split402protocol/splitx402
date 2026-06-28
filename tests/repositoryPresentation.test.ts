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
  });

  it("keeps required GitHub validation and security automation configured", () => {
    const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");
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
    expect(ciWorkflow).toContain("corepack pnpm typecheck");
    expect(ciWorkflow).toContain("corepack pnpm test");
    expect(ciWorkflow).toContain("corepack pnpm build");
    expect(ciWorkflow).toContain("corepack pnpm vectors:check");
    expect(ciWorkflow).toContain("corepack pnpm audit --audit-level high");
    expect(ciWorkflow).toContain("corepack pnpm test:postgres");
    expect(ciWorkflow).toContain("postgres:16");

    expect(codeqlWorkflow).toContain("github/codeql-action/init@v3");
    expect(codeqlWorkflow).toContain("javascript-typescript");

    expect(secretScanWorkflow).toContain("gitleaks/gitleaks-action@v2.3.9");
    expect(secretScanWorkflow).toContain("fetch-depth: 0");
    expect(secretScanWorkflow).toContain("GITHUB_TOKEN");

    expect(dependabotConfig).toContain('package-ecosystem: "github-actions"');
    expect(dependabotConfig).toContain('package-ecosystem: "npm"');
  });

  it("keeps README status badges aligned with GitHub validation workflows", () => {
    const readme = readFileSync("README.md", "utf8");

    expect(readme).toContain("actions/workflows/ci.yml/badge.svg");
    expect(readme).toContain("actions/workflows/codeql.yml/badge.svg");
    expect(readme).toContain("actions/workflows/secret-scan.yml/badge.svg");
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
  });

  it("documents the combined product readiness status command", () => {
    const readme = readFileSync("README.md", "utf8");
    const currentState = readFileSync("docs/CURRENT_STATE.md", "utf8");

    expect(readme).toContain("corepack pnpm product:evidence:init");
    expect(readme).toContain("corepack pnpm product:evidence:init --force");
    expect(readme).toContain("corepack pnpm product:launch-preflight --brief");
    expect(readme).toContain("corepack pnpm product:launch-checklist --brief");
    expect(readme).toContain("corepack pnpm phase6:evidence:env-template");
    expect(readme).toContain(
      "corepack pnpm phase6:evidence:env-template evidence/launch",
    );
    expect(readme).toContain(
      "corepack pnpm product:launch-checklist --brief <phase6-custody-evidence.txt> <phase7-staging-proof.txt>",
    );
    expect(readme).toContain("corepack pnpm product:status");
    expect(readme).toContain("corepack pnpm product:status --brief");
    expect(readme).toContain("creates a local evidence workspace");
    expect(readme).toContain("refuses to overwrite");
    expect(readme).toContain("existing scaffold files");
    expect(readme).toContain("remains `no-go`");
    expect(readme).toContain("launch-gate percentages");
    expect(currentState).toContain("corepack pnpm product:evidence:init");
    expect(currentState).toContain("corepack pnpm product:launch-preflight");
    expect(currentState).toContain("corepack pnpm product:launch-checklist");
    expect(currentState).toContain("local env templates");
    expect(currentState).toContain("checked, blocked, or ready");
    expect(currentState).toContain("refuses to overwrite existing scaffold");
    expect(currentState).toContain("corepack pnpm product:status");
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
