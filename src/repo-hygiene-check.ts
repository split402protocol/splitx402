import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

interface ForbiddenPattern {
  name: string;
  pattern: RegExp;
}

const legacySegment = String.fromCharCode(102, 102, 102, 102);

const forbiddenPatterns: ForbiddenPattern[] = [
  {
    name: "legacy repository URL",
    pattern: new RegExp(`github\\.com\\/splitx402\\/${legacySegment}`, "iu")
  },
  {
    name: "legacy repository shorthand",
    pattern: new RegExp(`splitx402\\/${legacySegment}`, "iu")
  },
  {
    name: "legacy path reference",
    pattern: new RegExp(`\\/${legacySegment}(?:\\b|[/?#)"'\\]])`, "iu")
  }
];

const ignoredPathPatterns = [
  /^src\/repo-hygiene-check\.ts$/u,
  /^node_modules\//u,
  /^\.git\//u,
  /^dist\//u,
  /(^|\/)dist\//u,
  /(^|\/)coverage\//u,
  /^phase7-staging-evidence\//u
];

const trackedFiles = execFileSync("git", ["ls-files"], {
  encoding: "utf8"
})
  .split(/\r?\n/u)
  .filter((file) => file.length > 0)
  .filter((file) => !ignoredPathPatterns.some((pattern) => pattern.test(file)));

const violations: string[] = [];

for (const file of trackedFiles) {
  const contents = readFileSync(file, "utf8");
  const lines = contents.split(/\r?\n/u);
  lines.forEach((line, index) => {
    for (const forbidden of forbiddenPatterns) {
      if (forbidden.pattern.test(line)) {
        violations.push(`${file}:${index + 1}: ${forbidden.name}`);
      }
    }
  });
}

if (violations.length > 0) {
  console.error("Repo hygiene check failed:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log("Repo hygiene check passed.");
