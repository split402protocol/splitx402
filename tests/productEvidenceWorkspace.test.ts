import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createProductEvidenceInitWrites,
  createProductEvidenceSourceRefreshWrites,
  findExistingProductEvidenceInitWrites,
  parseProductEvidenceInitArgs,
} from "../src/productEvidenceInitPlan.js";
import { createSplit402ProductEvidenceWorkspace } from "../src/productEvidenceWorkspace.js";

describe("Split402 product evidence workspace", () => {
  it("scaffolds Phase 6 and Phase 7 evidence paths together", () => {
    const workspace = createSplit402ProductEvidenceWorkspace({
      directory: "evidence/launch",
      sourceCommit: "096f190",
      reviewDate: "2026-06-29",
    });

    expect(workspace.directory).toBe("evidence/launch");
    expect(workspace.githubSettingsReviewFileName).toBe(
      "github-settings-review.txt",
    );
    expect(workspace.mainnetCanaryEnvFileName).toBe("mainnet-canary.env");
    expect(workspace.mainnetCanaryDryRunFileName).toBe(
      "mainnet-canary-dry-run.txt",
    );
    expect(workspace.mainnetCanaryRollbackPlanFileName).toBe(
      "mainnet-canary-rollback-plan.txt",
    );
    expect(workspace.phase6EvidenceFileName).toBe("phase6-custody-evidence.txt");
    expect(workspace.phase6EnvFileName).toBe("phase6-evidence.env");
    expect(workspace.phase7ProofFileName).toBe("phase7-staging-proof.txt");
    expect(workspace.phase7EnvFileName).toBe("phase7-staging.env");
    expect(workspace.phase7.envFilePath).toBe("evidence/launch/phase7-staging.env");
    expect(workspace.phase7.directory).toBe(
      "evidence/launch/phase7-staging-evidence",
    );
    expect(workspace.phase6EvidenceText).toContain("review_date: 2026-06-29");
    expect(workspace.phase6EvidenceText).toContain("source_commit: 096f190");
    expect(workspace.phase6EvidenceText).toContain("approval_decision: no-go");
    expect(workspace.phase6EnvText).toContain(
      "SPLIT402_PHASE6_ASSEMBLE_IMAGE_PROVENANCE_RECORD",
    );
    expect(workspace.phase6EnvText).toContain(
      "evidence/launch/phase6-image-provenance.txt",
    );
    expect(workspace.phase6EnvText).toContain(
      "SPLIT402_PHASE6_ASSEMBLE_IMAGE_PROVENANCE_RECORD=evidence/launch/phase6-image-provenance.txt",
    );
    expect(workspace.phase6EnvText).not.toContain(
      "# SPLIT402_PHASE6_ASSEMBLE_IMAGE_PROVENANCE_RECORD=evidence/launch/phase6-image-provenance.txt",
    );
    expect(workspace.phase6EnvText).not.toContain(
      "split402-launch-evidence/phase6-image-provenance.txt",
    );
    expect(workspace.phase7ProofText).toContain("proof_date: 2026-06-29");
    expect(workspace.phase7ProofText).toContain("source_commit: 096f190");
    expect(workspace.phase7ProofText).toContain("approval_decision: no-go");
    expect(workspace.phase7ProofText).toContain(
      "hosted_preflight_evidence: attached: phase7-staging-evidence/hosted-preflight.json",
    );
    expect(workspace.phase7ProofText).toContain(
      "commands_run: attached: phase7-staging-evidence/commands.log",
    );
    expect(workspace.phase7.envText).toContain(
      "SPLIT402_PHASE7_EVIDENCE_DIR=evidence/launch/phase7-staging-evidence",
    );
    expect(workspace.githubSettingsReviewText).toContain(
      "schema: split402.github_repository_settings_review.v1",
    );
    expect(workspace.githubSettingsReviewText).toContain(
      "review_date: 2026-06-29",
    );
    expect(workspace.githubSettingsReviewText).toContain(
      "source_commit: 096f190",
    );
    expect(workspace.githubSettingsReviewText).toContain(
      "review_method: pending",
    );
    expect(workspace.githubSettingsReviewText).toContain(
      "evidence_source: pending",
    );
    expect(workspace.githubSettingsReviewText).toContain(
      "review_decision: no-go",
    );
    expect(workspace.mainnetCanaryEnvText).toContain(
      "SPLIT402_MAINNET_CANARY_CONFIRM=split402-mainnet-canary",
    );
    expect(workspace.mainnetCanaryEnvText).toContain(
      "SPLIT402_MAINNET_CANARY_NON_ATOMIC_ACK=referral-accounting-not-atomic-split",
    );
    expect(workspace.mainnetCanaryEnvText).toContain(
      "SPLIT402_MAINNET_CANARY_REVIEW_DECISION=no-go",
    );
    expect(workspace.mainnetCanaryEnvText).toContain(
      "SPLIT402_MAINNET_CANARY_DRY_RUN_EVIDENCE=attached: mainnet-canary-dry-run.txt",
    );
    expect(workspace.mainnetCanaryEnvText).toContain(
      "SPLIT402_MAINNET_CANARY_ROLLBACK_PLAN=attached: mainnet-canary-rollback-plan.txt",
    );
    expect(workspace.mainnetCanaryDryRunText).toContain(
      "schema: split402.mainnet_canary_dry_run.v1",
    );
    expect(workspace.mainnetCanaryDryRunText).toContain(
      "source_commit: 096f190",
    );
    expect(workspace.mainnetCanaryRollbackPlanText).toContain(
      "schema: split402.mainnet_canary_rollback_plan.v1",
    );
    expect(workspace.mainnetCanaryRollbackPlanText).toContain(
      "review_date: 2026-06-29",
    );
  });

  it("documents the no-go launch posture and next commands", () => {
    const workspace = createSplit402ProductEvidenceWorkspace();

    expect(workspace.readmeText).toContain(
      "# Split402 Launch Evidence Workspace",
    );
    expect(workspace.readmeText).toContain("Launch gates ready: 0/3 (0%)");
    expect(workspace.readmeText).toContain("local-public-alpha-proof.json");
    expect(workspace.readmeText).toContain("github-settings-review.txt");
    expect(workspace.readmeText).toContain("mainnet-canary.env");
    expect(workspace.readmeText).toContain("mainnet-canary-dry-run.txt");
    expect(workspace.readmeText).toContain(
      "mainnet-canary-rollback-plan.txt",
    );
    expect(workspace.readmeText).toContain(
      "Live GitHub settings and public/private license review record",
    );
    expect(workspace.readmeText).toContain("Mainnet ready: no");
    expect(workspace.readmeText).toContain(
      "The product remains `no-go` until the GitHub public/private license",
    );
    expect(workspace.readmeText).toContain(
      "The mainnet canary env template is not a launch approval",
    );
    expect(workspace.readmeText).toContain(
      "saved local public-alpha proof records the source commit",
    );
    expect(workspace.readmeText).toContain(
      "`product:local-proof` also fails unless the",
    );
    expect(workspace.readmeText).toContain("source worktree is clean");
    expect(workspace.readmeText).toContain("On Windows PowerShell");
    expect(workspace.readmeText).toContain(
      "$env:SPLIT402_PHASE7_SEED_CONFIRM='seed-hosted-staging'; corepack",
    );
    expect(workspace.readmeText).toContain(
      "commands_run` checker accepts PowerShell prompt lines",
    );
    expect(workspace.readmeText).toContain(
      "dotenv-style parsing",
    );
    expect(workspace.readmeText).toContain(
      "quoted values are handled consistently",
    );
    expect(workspace.readmeText).toContain(
      "corepack pnpm product:github-settings-review --template --output split402-launch-evidence/github-settings-review.txt",
    );
    expect(workspace.nextCommands.slice(0, 5)).toEqual([
      "corepack pnpm product:local-proof --brief --output split402-launch-evidence/local-public-alpha-proof.json",
      "corepack pnpm product:github-settings-review --template --output split402-launch-evidence/github-settings-review.txt",
      "Generate the live GitHub API review with corepack pnpm product:github-settings-review --from-github --output split402-launch-evidence/github-settings-review.txt, then keep it no-go until human review approves the live settings evidence.",
      "corepack pnpm product:launch-preflight --brief --workspace split402-launch-evidence",
      "Fill split402-launch-evidence/phase7-staging.env with hosted staging values reported by launch preflight.",
    ]);
    expect(workspace.nextCommands).toContain(
      "corepack pnpm phase7:staging:collect-reads --evidence-env-file split402-launch-evidence/phase7-staging.env",
    );
    expect(workspace.nextCommands).toContain(
      "corepack pnpm phase7:staging:commands-template split402-launch-evidence/phase7-staging-evidence/commands.log",
    );
    expect(workspace.nextCommands).toContain(
      "Review split402-launch-evidence/phase7-staging-proof.txt and fill direct hosted proof fields.",
    );
    expect(workspace.nextCommands).toContain(
      "Review generated split402-launch-evidence/phase6-evidence.env before editing; regenerate only if missing with corepack pnpm phase6:evidence:env-template split402-launch-evidence split402-launch-evidence/phase6-evidence.env",
    );
    expect(workspace.nextCommands).toContain(
      "Generate Phase 6 custody records at the paths listed in split402-launch-evidence/phase6-evidence.env.",
    );
    expect(workspace.nextCommands).toContain(
      "corepack pnpm phase6:evidence:status --brief split402-launch-evidence/phase6-custody-evidence.txt",
    );
    expect(workspace.nextCommands).toContain(
      "corepack pnpm phase6:evidence:assemble --evidence-env-file split402-launch-evidence/phase6-evidence.env split402-launch-evidence/phase6-custody-evidence.txt",
    );
    expect(workspace.nextCommands).toContain(
      "corepack pnpm product:status --brief --workspace split402-launch-evidence",
    );
    expect(workspace.nextCommands).toContain(
      "Review split402-launch-evidence/mainnet-canary.env only after product:status is go.",
    );
    expect(workspace.nextCommands).toContain(
      "Fill split402-launch-evidence/mainnet-canary-dry-run.txt and split402-launch-evidence/mainnet-canary-rollback-plan.txt with private reviewed canary evidence.",
    );
    expect(workspace.nextCommands).toContain(
      "corepack pnpm product:mainnet-canary --brief --workspace split402-launch-evidence",
    );
  });

  it("plans every scaffold file written by the product evidence initializer", () => {
    const workspace = createSplit402ProductEvidenceWorkspace({
      directory: "evidence/launch",
    });

    expect(createProductEvidenceInitWrites(workspace).map((write) => write.path))
      .toEqual([
        join("evidence/launch", "README.md"),
        join("evidence/launch", "github-settings-review.txt"),
        join("evidence/launch", "mainnet-canary.env"),
        join("evidence/launch", "mainnet-canary-dry-run.txt"),
        join("evidence/launch", "mainnet-canary-rollback-plan.txt"),
        join("evidence/launch", "phase6-custody-evidence.txt"),
        join("evidence/launch", "phase6-evidence.env"),
        join("evidence/launch", "phase7-staging-proof.txt"),
        join("evidence/launch", "phase7-staging.env"),
        join("evidence/launch/phase7-staging-evidence", "README.md"),
      ]);
  });

  it("detects existing scaffold files before overwriting launch evidence", () => {
    const workspace = createSplit402ProductEvidenceWorkspace();
    const writes = createProductEvidenceInitWrites(workspace);

    expect(
      findExistingProductEvidenceInitWrites(writes, (path) =>
        path.endsWith("phase7-staging-proof.txt"),
      ),
    ).toEqual([
      join("split402-launch-evidence", "phase7-staging-proof.txt"),
    ]);
  });

  it("parses intentional scaffold replacement and missing-only modes", () => {
    expect(parseProductEvidenceInitArgs(["--force", "evidence/launch"])).toEqual(
      {
        directory: "evidence/launch",
        force: true,
        help: false,
        missing: false,
        refreshSource: false,
      },
    );
    expect(parseProductEvidenceInitArgs(["--missing", "evidence/launch"]))
      .toEqual({
        directory: "evidence/launch",
        force: false,
        help: false,
        missing: true,
        refreshSource: false,
      });
    expect(parseProductEvidenceInitArgs(["--refresh-source", "evidence/launch"]))
      .toEqual({
        directory: "evidence/launch",
        force: false,
        help: false,
        missing: false,
        refreshSource: true,
      });
    expect(parseProductEvidenceInitArgs(["--help"])).toEqual({
      directory: "split402-launch-evidence",
      force: false,
      help: true,
      missing: false,
      refreshSource: false,
    });
    expect(parseProductEvidenceInitArgs([])).toEqual({
      directory: "split402-launch-evidence",
      force: false,
      help: false,
      missing: false,
      refreshSource: false,
    });
    expect(() =>
      parseProductEvidenceInitArgs(["one", "two"]),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: Usage: corepack pnpm product:evidence:init [--force|--missing|--refresh-source] [directory]]`,
    );
    expect(() =>
      parseProductEvidenceInitArgs(["--force", "--refresh-source"]),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: Usage: corepack pnpm product:evidence:init [--force|--missing|--refresh-source] [directory]]`,
    );
    expect(() =>
      parseProductEvidenceInitArgs(["--froce"]),
    ).toThrowErrorMatchingInlineSnapshot(`
      [Error: Usage: corepack pnpm product:evidence:init [--force|--missing|--refresh-source] [directory]
      Unknown option: --froce]
    `);
  });

  it("plans source-commit refreshes without rewriting env templates", () => {
    const previous = createSplit402ProductEvidenceWorkspace({
      sourceCommit: "abc1234",
    });
    const next = createSplit402ProductEvidenceWorkspace({
      sourceCommit: "def5678",
    });

    const writes = createProductEvidenceSourceRefreshWrites({
      workspace: next,
      readText: (path) => {
        if (path.endsWith(previous.githubSettingsReviewFileName)) {
          return previous.githubSettingsReviewText;
        }
        if (path.endsWith(previous.phase6EvidenceFileName)) {
          return previous.phase6EvidenceText;
        }
        if (path.endsWith(previous.phase7ProofFileName)) {
          return previous.phase7ProofText;
        }
        throw new Error(`unexpected read ${path}`);
      },
    });

    expect(writes.map((write) => write.path)).toEqual([
      join("split402-launch-evidence", "github-settings-review.txt"),
      join("split402-launch-evidence", "phase6-custody-evidence.txt"),
      join("split402-launch-evidence", "phase7-staging-proof.txt"),
    ]);
    expect(writes[0]?.contents).toContain("source_commit: def5678");
    expect(writes[1]?.contents).toContain("source_commit: def5678");
    expect(writes[2]?.contents).toContain("source_commit: def5678");
    expect(writes[0]?.contents).not.toContain("source_commit: abc1234");
    expect(writes[1]?.contents).not.toContain("source_commit: abc1234");
    expect(writes[2]?.contents).not.toContain("source_commit: abc1234");
  });

  it("adds missing GitHub review evidence fields during scaffold source refresh", () => {
    const previous = createSplit402ProductEvidenceWorkspace({
      sourceCommit: "abc1234",
    });
    const next = createSplit402ProductEvidenceWorkspace({
      sourceCommit: "def5678",
    });

    const previousGithubReview = previous.githubSettingsReviewText
      .replace("review_method: pending\n", "")
      .replace("evidence_source: pending\n", "");
    const writes = createProductEvidenceSourceRefreshWrites({
      workspace: next,
      readText: (path) => {
        if (path.endsWith(previous.githubSettingsReviewFileName)) {
          return previousGithubReview;
        }
        if (path.endsWith(previous.phase6EvidenceFileName)) {
          return previous.phase6EvidenceText;
        }
        if (path.endsWith(previous.phase7ProofFileName)) {
          return previous.phase7ProofText;
        }
        throw new Error(`unexpected read ${path}`);
      },
    });

    expect(writes[0]?.contents).toContain("source_commit: def5678");
    expect(writes[0]?.contents).toContain("review_method: pending");
    expect(writes[0]?.contents).toContain("evidence_source: pending");
  });

  it("refuses to refresh source commits after evidence values are filled", () => {
    const previous = createSplit402ProductEvidenceWorkspace({
      sourceCommit: "abc1234",
    });
    const next = createSplit402ProductEvidenceWorkspace({
      sourceCommit: "def5678",
    });

    expect(() =>
      createProductEvidenceSourceRefreshWrites({
        workspace: next,
        readText: (path) => {
          if (path.endsWith(previous.githubSettingsReviewFileName)) {
            return previous.githubSettingsReviewText;
          }
          if (path.endsWith(previous.phase6EvidenceFileName)) {
            return previous.phase6EvidenceText.replace(
              "funding_wallet:",
              "funding_wallet: merchant-funded-wallet",
            );
          }
          if (path.endsWith(previous.phase7ProofFileName)) {
            return previous.phase7ProofText;
          }
          throw new Error(`unexpected read ${path}`);
        },
      }),
    ).toThrowErrorMatchingInlineSnapshot(`
      [Error: Refusing to refresh source_commit in split402-launch-evidence/phase6-custody-evidence.txt because it already contains non-scaffold evidence fields.
      Non-refreshable fields: funding_wallet
      Recollect evidence from the current checkout instead of rewriting source_commit.]
    `);
  });

  it("refuses to refresh source commits after GitHub settings review is filled", () => {
    const previous = createSplit402ProductEvidenceWorkspace({
      sourceCommit: "abc1234",
    });
    const next = createSplit402ProductEvidenceWorkspace({
      sourceCommit: "def5678",
    });

    expect(() =>
      createProductEvidenceSourceRefreshWrites({
        workspace: next,
        readText: (path) => {
          if (path.endsWith(previous.githubSettingsReviewFileName)) {
            return previous.githubSettingsReviewText
              .replace("reviewers: <reviewer handles>", "reviewers: Split402 operators")
              .replace("about_description_matches: no", "about_description_matches: yes");
          }
          if (path.endsWith(previous.phase6EvidenceFileName)) {
            return previous.phase6EvidenceText;
          }
          if (path.endsWith(previous.phase7ProofFileName)) {
            return previous.phase7ProofText;
          }
          throw new Error(`unexpected read ${path}`);
        },
      }),
    ).toThrowErrorMatchingInlineSnapshot(`
      [Error: Refusing to refresh source_commit in split402-launch-evidence/github-settings-review.txt because it already contains non-scaffold evidence fields.
      Non-refreshable fields: reviewers, about_description_matches
      Recollect evidence from the current checkout instead of rewriting source_commit.]
    `);
  });
});
