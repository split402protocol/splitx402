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

const FORBIDDEN_OLD_REPO_REFERENCES = [
  /github\.com\/[^)\s"'`]+\/ffff\b/iu,
  /\bsplit402protocol\/ffff\b/iu,
  /\bsplitx402\/ffff\b/iu,
];

describe("repository presentation", () => {
  it("does not reintroduce old ffff GitHub or repository references", () => {
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
    expect(readme).not.toMatch(/\bffff\b/iu);
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

    expect(dependabotConfig).toContain('package-ecosystem: "github-actions"');
    expect(dependabotConfig).toContain('package-ecosystem: "npm"');
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
