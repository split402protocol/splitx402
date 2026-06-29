import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

interface ForbiddenPattern {
  name: string;
  pattern: RegExp;
}

interface ForbiddenPathPattern {
  name: string;
  pattern: RegExp;
}

const legacySegment = String.fromCharCode(102, 102, 102, 102);
const legacyAccountName = String.fromCharCode(
  102,
  114,
  101,
  101,
  98,
  117,
  115,
  109,
  111,
  110,
  111,
);
const legacyAccountNameReversed = String.fromCharCode(
  109,
  111,
  110,
  111,
  102,
  114,
  101,
  101,
  98,
  117,
  115,
);
const legacyEmailLocalPart = String.fromCharCode(
  104,
  97,
  115,
  104,
  116,
  97,
  103,
  102,
  114,
  101,
  101,
  98,
  117,
  115,
);

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
  },
  {
    name: "legacy GitHub account name",
    pattern: new RegExp(legacyAccountName, "iu")
  },
  {
    name: "legacy GitHub account name",
    pattern: new RegExp(legacyAccountNameReversed, "iu")
  },
  {
    name: "legacy Git author email local part",
    pattern: new RegExp(legacyEmailLocalPart, "iu")
  }
];

const forbiddenTrackedPathPatterns: ForbiddenPathPattern[] = [
  {
    name: "local launch evidence workspace",
    pattern: /^split402-launch-evidence\//u
  },
  {
    name: "local Phase 7 evidence workspace",
    pattern: /^phase7-staging-evidence\//u
  },
  {
    name: "generic local evidence workspace",
    pattern: /^evidence\//u
  },
  {
    name: "raw environment file",
    pattern: /(^|\/)\.env(?:\.|$)/u
  },
  {
    name: "non-example environment file",
    pattern: /(^|\/)[^/]+\.env$/u
  },
  {
    name: "private key or credential artifact",
    pattern: /(^|\/)[^/]+\.(?:credentials|key|keystore|p12|pem|pfx|secret|token)$/iu
  }
];

const ignoredPathPatterns = [
  /^src\/repo-hygiene-check\.ts$/u,
  /^node_modules\//u,
  /^\.git\//u,
  /^dist\//u,
  /(^|\/)dist\//u,
  /(^|\/)coverage\//u,
  /(^|\/)(?:[^/]+)?\.env\.example$/u
];

const trackedFiles = execFileSync("git", ["ls-files"], {
  encoding: "utf8"
})
  .split(/\r?\n/u)
  .filter((file) => file.length > 0)
  .filter((file) => !ignoredPathPatterns.some((pattern) => pattern.test(file)));

const violations: string[] = [];

for (const file of trackedFiles) {
  for (const forbiddenPath of forbiddenTrackedPathPatterns) {
    if (forbiddenPath.pattern.test(file)) {
      violations.push(`${file}: ${forbiddenPath.name}`);
    }
  }

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

for (const violation of createLocalGitMetadataViolations()) {
  violations.push(violation);
}

if (violations.length > 0) {
  console.error("Repo hygiene check failed:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log("Repo hygiene check passed.");

function createLocalGitMetadataViolations(): string[] {
  const metadataViolations: string[] = [];
  const localMetadataChecks = [
    {
      label: "local git refs",
      text: execFileSync(
        "git",
        ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"],
        { encoding: "utf8" },
      )
    },
    {
      label: "local git config",
      text: execFileSync("git", ["config", "--local", "--list"], {
        encoding: "utf8"
      })
    },
    {
      label: "local git author name",
      text: readOptionalGitConfigValue("user.name")
    },
    {
      label: "local git author email",
      text: readOptionalGitConfigValue("user.email")
    }
  ];

  for (const check of localMetadataChecks) {
    for (const forbidden of forbiddenPatterns) {
      if (forbidden.pattern.test(check.text)) {
        metadataViolations.push(`${check.label}: ${forbidden.name}`);
      }
    }
  }

  return metadataViolations;
}

function readOptionalGitConfigValue(key: string): string {
  try {
    return execFileSync("git", ["config", "--get", key], { encoding: "utf8" });
  } catch {
    return "";
  }
}
