import { existsSync, readFileSync, readdirSync } from "node:fs";

export interface Split402PublicSurfaceCheckInput {
  exists?: (path: string) => boolean;
  listDirectory?: (path: string) => string[];
  readText?: (path: string) => string;
}

export interface Split402PublicSurfaceCheck {
  id: string;
  label: string;
  ok: boolean;
  details: string[];
}

export interface Split402PublicSurfaceCheckReport {
  schema: "split402.public_surface_check.v1";
  product: "Split402";
  repository: "split402protocol/splitx402";
  ok: boolean;
  checks: Split402PublicSurfaceCheck[];
}

export const PRODUCT_PUBLIC_SURFACE_CHECK_USAGE =
  "Usage: corepack pnpm product:public-surface-check [--brief|--json]";

const REQUIRED_FILES = [
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "SUPPORT.md",
  "pnpm-workspace.yaml",
  ".github/CODEOWNERS",
  "docs/GITHUB_PUBLIC_PROFILE.md",
  "docs/GITHUB_REPOSITORY_SETTINGS.md",
  "docs/PUBLIC_PRIVATE_BOUNDARY.md",
  "docs/RELEASE_POLICY.md",
  "docs/COMMERCIAL_READINESS.md",
  "docs/checklists/prelaunch-public-private-review.md",
  "docs/decisions/0009-public-private-boundary-and-apache-license.md",
] as const;

const MIT_FREE_PUBLIC_FILES = ["LICENSE", "README.md", "package.json"] as const;
const GITHUB_PROFILE_FILE = "docs/GITHUB_PUBLIC_PROFILE.md";
const EXPECTED_GITHUB_DESCRIPTION =
  "Agent payment routing and verifiable referral accounting for x402 APIs.";
const EXPECTED_GITHUB_TOPICS = [
  "agents",
  "mcp",
  "payments",
  "protocol",
  "solana",
  "typescript",
  "usdc",
  "x402",
] as const;

export function createSplit402PublicSurfaceCheckReport(
  input: Split402PublicSurfaceCheckInput = {},
): Split402PublicSurfaceCheckReport {
  const exists = input.exists ?? existsSync;
  const listDirectory =
    input.listDirectory ?? ((path: string) => readdirSync(path));
  const readText =
    input.readText ?? ((path: string) => readFileSync(path, "utf8"));

  const missingRequiredFiles = REQUIRED_FILES.filter((path) => !exists(path));
  const checks: Split402PublicSurfaceCheck[] = [
    {
      id: "required_public_surface_files",
      label: "Public boundary and license files exist",
      ok: missingRequiredFiles.length === 0,
      details:
        missingRequiredFiles.length === 0
          ? ["Required public-surface files are present."]
          : missingRequiredFiles.map((path) => `Missing ${path}.`),
    },
    createPackageLicenseCheck(exists, readText),
    createWorkspacePackagePrivacyCheck(exists, listDirectory, readText),
    createApacheLicenseFileCheck(exists, readText),
    createReadmeBoundaryCheck(exists, readText),
    createGitHubProfileContractCheck(exists, readText),
    createGitHubRepositorySettingsCheck(exists, readText),
    createCodeownersCheck(exists, readText),
    createSupportPolicyCheck(exists, readText),
    createReleasePolicyCheck(exists, readText),
    createCommercialReadinessCheck(exists, readText),
    createBoundaryPolicyCheck(exists, readText),
    createDecisionRecordCheck(exists, readText),
    createNoMitLaunchClaimCheck(exists, readText),
  ];

  return {
    schema: "split402.public_surface_check.v1",
    product: "Split402",
    repository: "split402protocol/splitx402",
    ok: checks.every((check) => check.ok),
    checks,
  };
}

export function formatSplit402PublicSurfaceCheckBrief(
  report: Split402PublicSurfaceCheckReport,
): string {
  return [
    `Split402 public surface check: ${report.ok ? "passed" : "failed"}`,
    "",
    ...report.checks.flatMap((check) => [
      `- ${check.ok ? "pass" : "fail"}: ${check.label}`,
      ...check.details.map((detail) => `  ${detail}`),
    ]),
    "",
    "Launch posture:",
    "- Public repository: Apache-2.0 protocol foundation.",
    `- GitHub About description: ${EXPECTED_GITHUB_DESCRIPTION}`,
    "- Package publication: workspace packages stay private until intentional release artifacts are approved.",
    "- Private infrastructure: hosted operations, production custody, provider strategy, private evidence, and commercial deployment details.",
  ].join("\n");
}

export function serializeSplit402PublicSurfaceCheckReport(
  report: Split402PublicSurfaceCheckReport,
): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function createPackageLicenseCheck(
  exists: (path: string) => boolean,
  readText: (path: string) => string,
): Split402PublicSurfaceCheck {
  const packageJson = readIfExists("package.json", exists, readText);
  if (packageJson === undefined) {
    return {
      id: "package_license_metadata",
      label: "Root package metadata uses Apache-2.0",
      ok: false,
      details: ["Missing package.json."],
    };
  }

  try {
    const parsed = JSON.parse(packageJson) as {
      description?: unknown;
      license?: unknown;
      private?: unknown;
    };
    const blockers = [
      ...(parsed.description === EXPECTED_GITHUB_DESCRIPTION
        ? []
        : [`Set package.json description to "${EXPECTED_GITHUB_DESCRIPTION}".`]),
      ...(parsed.license === "Apache-2.0"
        ? []
        : ["Set package.json license to Apache-2.0."]),
      ...(parsed.private === true
        ? []
        : ["Keep the root workspace private until publishable packages are intentionally released."]),
    ];
    return {
      id: "package_license_metadata",
      label: "Root package metadata uses Apache-2.0",
      ok: blockers.length === 0,
      details:
        blockers.length === 0
          ? [
              "package.json declares the canonical public description, Apache-2.0, and keeps the workspace private.",
            ]
          : blockers,
    };
  } catch {
    return {
      id: "package_license_metadata",
      label: "Root package metadata uses Apache-2.0",
      ok: false,
      details: ["package.json is not valid JSON."],
    };
  }
}

function createWorkspacePackagePrivacyCheck(
  exists: (path: string) => boolean,
  listDirectory: (path: string) => string[],
  readText: (path: string) => string,
): Split402PublicSurfaceCheck {
  const workspacePackageManifests = discoverWorkspacePackageManifests(
    exists,
    listDirectory,
    readText,
  );
  const blockers = workspacePackageManifests.flatMap((path) => {
    const packageJson = readIfExists(path, exists, readText);
    if (packageJson === undefined) {
      return [`Missing ${path}.`];
    }

    try {
      const parsed = JSON.parse(packageJson) as {
        name?: unknown;
        private?: unknown;
      };
      return parsed.private === true
        ? []
        : [
            `${path} must keep private: true until that package has an intentional release decision.`,
          ];
    } catch {
      return [`${path} is not valid JSON.`];
    }
  });

  return {
    id: "workspace_package_publication_boundary",
    label: "Workspace packages stay private before intentional release",
    ok: blockers.length === 0,
    details:
      blockers.length === 0
        ? [
            "All pnpm workspace app and package manifests keep private: true until publishable artifacts are explicitly approved.",
          ]
        : blockers,
  };
}

function discoverWorkspacePackageManifests(
  exists: (path: string) => boolean,
  listDirectory: (path: string) => string[],
  readText: (path: string) => string,
): string[] {
  const workspace = readIfExists("pnpm-workspace.yaml", exists, readText);
  if (workspace === undefined) {
    return [];
  }

  return parseWorkspacePackagePatterns(workspace).flatMap((pattern) => {
    const parentDirectory = pattern.slice(0, -"/*".length);
    if (!exists(parentDirectory)) {
      return [];
    }
    return listDirectory(parentDirectory)
      .map((entry) => `${parentDirectory}/${entry}/package.json`)
      .sort((left, right) => left.localeCompare(right));
  });
}

function parseWorkspacePackagePatterns(workspace: string): string[] {
  const patterns = new Set<string>();
  for (const line of workspace.split(/\r?\n/u)) {
    const match = /^\s*-\s*["']?([^"'\s]+)["']?\s*$/u.exec(line);
    const pattern = match?.[1];
    if (pattern !== undefined && /^[a-z0-9_-]+\/\*$/iu.test(pattern)) {
      patterns.add(pattern);
    }
  }
  return [...patterns].sort((left, right) => left.localeCompare(right));
}

function createApacheLicenseFileCheck(
  exists: (path: string) => boolean,
  readText: (path: string) => string,
): Split402PublicSurfaceCheck {
  const license = readIfExists("LICENSE", exists, readText);
  const ok =
    license !== undefined &&
    license.includes("Apache License") &&
    license.includes("Version 2.0");
  return {
    id: "apache_license_file",
    label: "LICENSE contains Apache-2.0 text",
    ok,
    details: ok
      ? ["LICENSE contains Apache License Version 2.0 text."]
      : ["Replace LICENSE with Apache License Version 2.0 text."],
  };
}

function createReadmeBoundaryCheck(
  exists: (path: string) => boolean,
  readText: (path: string) => string,
): Split402PublicSurfaceCheck {
  const readme = readIfExists("README.md", exists, readText);
  const blockers = [
    ...(readme?.includes("license-Apache--2.0") === true
      ? []
      : ["README.md must show the Apache-2.0 license badge."]),
    ...(readme?.includes("[Apache-2.0](LICENSE)") === true
      ? []
      : ["README.md must link to the Apache-2.0 LICENSE file."]),
    ...(readme?.includes("docs/PUBLIC_PRIVATE_BOUNDARY.md") === true
      ? []
      : ["README.md must link to docs/PUBLIC_PRIVATE_BOUNDARY.md."]),
    ...(readme?.includes("docs/GITHUB_REPOSITORY_SETTINGS.md") === true
      ? []
      : ["README.md must link to docs/GITHUB_REPOSITORY_SETTINGS.md."]),
    ...(readme?.includes("docs/RELEASE_POLICY.md") === true
      ? []
      : ["README.md must link to docs/RELEASE_POLICY.md."]),
    ...(readme?.includes("SUPPORT.md") === true
      ? []
      : ["README.md must link to SUPPORT.md."]),
    ...(readme?.includes(
      "docs/checklists/prelaunch-public-private-review.md",
    ) === true
      ? []
      : [
          "README.md must link to docs/checklists/prelaunch-public-private-review.md.",
        ]),
    ...(readme?.includes(
      "docs/decisions/0009-public-private-boundary-and-apache-license.md",
    ) === true
      ? []
      : ["README.md must link to the public/private license decision record."]),
  ];
  return {
    id: "readme_license_boundary",
    label: "README presents the public/private license boundary",
    ok: blockers.length === 0,
    details:
      blockers.length === 0
        ? ["README presents Apache-2.0 and the public/private boundary."]
        : blockers,
  };
}

function createGitHubRepositorySettingsCheck(
  exists: (path: string) => boolean,
  readText: (path: string) => string,
): Split402PublicSurfaceCheck {
  const path = "docs/GITHUB_REPOSITORY_SETTINGS.md";
  const settings = readIfExists(path, exists, readText);
  const requiredPhrases = [
    "require pull request before merging",
    "require review from Code Owners",
    "require status checks to pass before merge",
    "block force pushes",
    "block branch deletion",
    "Local public-alpha proof",
    "PostgreSQL integration tests",
    "CodeQL",
    "Secret scan",
    "Keep blank issues disabled",
    "GitHub Security Advisories",
    'Workspace packages stay `"private": true`',
    "The local checks prove the tracked repository surface.",
    "product:github-settings-review --from-github",
    "product:github-settings-review",
  ];
  const missingPhrases = requiredPhrases.filter(
    (phrase) => settings?.includes(phrase) !== true,
  );

  return {
    id: "github_repository_settings_policy",
    label: "GitHub repository settings policy protects launch-facing main",
    ok: missingPhrases.length === 0,
    details:
      missingPhrases.length === 0
        ? [
            "GitHub settings policy records branch protection, CODEOWNERS review, issue intake, required checks, and release posture.",
          ]
        : missingPhrases.map((phrase) => `${path} must include "${phrase}".`),
  };
}

function createCodeownersCheck(
  exists: (path: string) => boolean,
  readText: (path: string) => string,
): Split402PublicSurfaceCheck {
  const codeowners = readIfExists(".github/CODEOWNERS", exists, readText);
  const requiredLines = [
    "* @split402protocol",
    "/packages/protocol/ @split402protocol",
    "/packages/x402-extension/ @split402protocol",
    "/packages/control-plane/ @split402protocol",
    "/packages/router/ @split402protocol",
    "/apps/payout-signer/ @split402protocol",
    "/docs/decisions/ @split402protocol",
    "/docs/RELEASE_POLICY.md @split402protocol",
    "/docs/PUBLIC_PRIVATE_BOUNDARY.md @split402protocol",
    "/SECURITY.md @split402protocol",
    "/SUPPORT.md @split402protocol",
    "/.github/ @split402protocol",
    "/deploy/ @split402protocol",
  ];
  const missingLines = requiredLines.filter(
    (line) => codeowners?.includes(line) !== true,
  );

  return {
    id: "codeowners_review_boundary",
    label: "Sensitive public repository paths have CODEOWNERS review routing",
    ok: missingLines.length === 0,
    details:
      missingLines.length === 0
        ? [
            "CODEOWNERS routes protocol, payment, custody, release, CI, and public-presentation changes to Split402 review.",
          ]
        : missingLines.map((line) => `.github/CODEOWNERS must include ${line}.`),
  };
}

function createSupportPolicyCheck(
  exists: (path: string) => boolean,
  readText: (path: string) => string,
): Split402PublicSurfaceCheck {
  const support = readIfExists("SUPPORT.md", exists, readText);
  const blockers = [
    ...(support?.includes("not production ready") === true
      ? []
      : ["SUPPORT.md must state that Split402 is not production ready."]),
    ...(support?.includes("not mainnet approved") === true
      ? []
      : ["SUPPORT.md must state that Split402 is not mainnet approved."]),
    ...(support?.includes("No released versions are currently supported") === true
      ? []
      : [
          "SUPPORT.md must state that no released versions are currently supported.",
        ]),
    ...(support?.includes("GitHub Security Advisories") === true
      ? []
      : [
          "SUPPORT.md must direct vulnerability reports to GitHub Security Advisories.",
        ]),
    ...(support?.includes("docs/RELEASE_POLICY.md") === true
      ? []
      : ["SUPPORT.md must link to docs/RELEASE_POLICY.md."]),
  ];

  return {
    id: "support_policy_boundary",
    label: "Support policy preserves public-alpha support boundaries",
    ok: blockers.length === 0,
    details:
      blockers.length === 0
        ? [
            "SUPPORT.md keeps support limited to public-alpha development and private security reporting.",
          ]
        : blockers,
  };
}

function createReleasePolicyCheck(
  exists: (path: string) => boolean,
  readText: (path: string) => string,
): Split402PublicSurfaceCheck {
  const releasePolicy = readIfExists("docs/RELEASE_POLICY.md", exists, readText);
  const blockers = [
    ...(releasePolicy?.includes("no supported public release yet") === true
      ? []
      : [
          "docs/RELEASE_POLICY.md must state there is no supported public release yet.",
        ]),
    ...(releasePolicy?.includes("private\": true") === true
      ? []
      : ["docs/RELEASE_POLICY.md must keep workspace packages private until release approval."]),
    ...(releasePolicy?.includes("product:local-proof --brief") === true
      ? []
      : ["docs/RELEASE_POLICY.md must require product:local-proof before publishing."]),
    ...(releasePolicy?.includes(
      "product:status --brief --workspace split402-launch-evidence",
    ) === true
      ? []
      : ["docs/RELEASE_POLICY.md must require product:status before publishing."]),
    ...(releasePolicy?.includes(
      "product:mainnet-canary --brief --workspace split402-launch-evidence",
    ) === true
      ? []
      : ["docs/RELEASE_POLICY.md must require product:mainnet-canary before mainnet canary use."]),
    ...(releasePolicy?.includes("readyForProductionMainnet") === true &&
    releasePolicy.includes("does not approve production mainnet launch")
      ? []
      : [
          "docs/RELEASE_POLICY.md must keep mainnet canary separate from production mainnet launch approval.",
        ]),
    ...(releasePolicy?.includes("not approve public launch") === true
      ? []
      : ["docs/RELEASE_POLICY.md must state that local proof does not approve launch."]),
  ];

  return {
    id: "release_policy_boundary",
    label: "Release policy prevents premature publication claims",
    ok: blockers.length === 0,
    details:
      blockers.length === 0
        ? ["Release policy keeps packages, hosted demos, production custody, mainnet canaries, and production mainnet behind explicit evidence gates."]
        : blockers,
  };
}

function createCommercialReadinessCheck(
  exists: (path: string) => boolean,
  readText: (path: string) => string,
): Split402PublicSurfaceCheck {
  const commercial = readIfExists("docs/COMMERCIAL_READINESS.md", exists, readText);
  const blockers = [
    ...(commercial?.includes("Public alpha only") === true
      ? []
      : ["docs/COMMERCIAL_READINESS.md must state public-alpha commercial status."]),
    ...(commercial?.includes("not atomic on-chain payment splitting") === true
      ? []
      : ["docs/COMMERCIAL_READINESS.md must disclose the non-atomic MVP boundary."]),
    ...(commercial?.includes("merchant payout wallet is solvent") === true
      ? []
      : ["docs/COMMERCIAL_READINESS.md must disclose merchant solvency risk."]),
    ...(commercial?.includes("protocolFeeBpsOfCommission") === true
      ? []
      : ["docs/COMMERCIAL_READINESS.md must define the protocol fee basis."]),
    ...(commercial?.includes("Phase 6") === true &&
    commercial.includes("Phase 7 approval") === true
      ? []
      : ["docs/COMMERCIAL_READINESS.md must keep custody and hosted launch behind Phase 6/7 approval."]),
    ...(commercial?.includes("Commercial launch remains blocked until all are true") === true
      ? []
      : ["docs/COMMERCIAL_READINESS.md must include a commercial pre-launch gate."]),
  ];

  return {
    id: "commercial_readiness_boundary",
    label: "Commercial readiness preserves public-alpha risk disclosures",
    ok: blockers.length === 0,
    details:
      blockers.length === 0
        ? [
            "Commercial readiness doc keeps non-atomic settlement, solvency, fee, custody, and launch-gate disclosures explicit.",
          ]
        : blockers,
  };
}

function createBoundaryPolicyCheck(
  exists: (path: string) => boolean,
  readText: (path: string) => string,
): Split402PublicSurfaceCheck {
  const boundary = readIfExists(
    "docs/PUBLIC_PRIVATE_BOUNDARY.md",
    exists,
    readText,
  );
  const hasLaunchFacingLicensePolicy =
    boundary !== undefined &&
    boundary.includes("Apache-2.0") &&
    boundary.includes("launch-facing license");
  const blockers = [
    ...(boundary?.includes("## Public Repository") === true
      ? []
      : ["docs/PUBLIC_PRIVATE_BOUNDARY.md must define the public repository surface."]),
    ...(boundary?.includes("## Private Commercial Surface") === true
      ? []
      : ["docs/PUBLIC_PRIVATE_BOUNDARY.md must define the private commercial surface."]),
    ...(boundary?.includes("## License Policy") === true
      ? []
      : ["docs/PUBLIC_PRIVATE_BOUNDARY.md must define the license policy."]),
    ...(boundary?.includes("## Pre-Launch Classification Matrix") === true
      ? []
      : ["docs/PUBLIC_PRIVATE_BOUNDARY.md must include the pre-launch classification matrix."]),
    ...(boundary?.includes("Apache-2.0") === true
      ? []
      : ["docs/PUBLIC_PRIVATE_BOUNDARY.md must state Apache-2.0 for the public repository."]),
    ...(hasLaunchFacingLicensePolicy
      ? []
      : ["docs/PUBLIC_PRIVATE_BOUNDARY.md must state that Apache-2.0 is the launch-facing license."]),
  ];
  return {
    id: "public_private_boundary_policy",
    label: "Public/private boundary policy is explicit",
    ok: blockers.length === 0,
    details:
      blockers.length === 0
        ? ["Public/private boundary policy is explicit."]
        : blockers,
  };
}

function createGitHubProfileContractCheck(
  exists: (path: string) => boolean,
  readText: (path: string) => string,
): Split402PublicSurfaceCheck {
  const profile = readIfExists(GITHUB_PROFILE_FILE, exists, readText);
  if (profile === undefined) {
    return {
      id: "github_public_profile_contract",
      label: "GitHub public profile contract is professional",
      ok: false,
      details: [`Missing ${GITHUB_PROFILE_FILE}.`],
    };
  }

  const missingTopics = EXPECTED_GITHUB_TOPICS.filter(
    (topic) => !profile.includes(`- ${topic}`),
  );
  const blockers = [
    ...(profile.includes(`Description: ${EXPECTED_GITHUB_DESCRIPTION}`)
      ? []
      : [
          `${GITHUB_PROFILE_FILE} must include the canonical GitHub About description.`,
        ]),
    ...(missingTopics.length === 0
      ? []
      : [
          `${GITHUB_PROFILE_FILE} must list canonical GitHub topics: ${missingTopics.join(
            ", ",
          )}.`,
        ]),
    ...(profile.includes(
      "Homepage: unset until a hosted public docs or demo URL is live and proof-gated.",
    )
      ? []
      : [
          `${GITHUB_PROFILE_FILE} must keep homepage unset until public hosted evidence is ready.`,
        ]),
    ...(profile.includes("Apache-2.0")
      ? []
      : [`${GITHUB_PROFILE_FILE} must state the public license as Apache-2.0.`]),
    ...(profile.includes("## Launch Boundary")
      ? []
      : [`${GITHUB_PROFILE_FILE} must include the launch boundary section.`]),
    ...(profile.includes("docs/GITHUB_REPOSITORY_SETTINGS.md")
      ? []
      : [
          `${GITHUB_PROFILE_FILE} must link to the GitHub repository settings policy.`,
        ]),
    ...(profile.includes("Contributors are generated from commit author metadata")
      ? []
      : [
          `${GITHUB_PROFILE_FILE} must document how GitHub contributor metadata is generated.`,
        ]),
  ];

  return {
    id: "github_public_profile_contract",
    label: "GitHub public profile contract is professional",
    ok: blockers.length === 0,
    details:
      blockers.length === 0
        ? [
            "GitHub profile contract records the canonical About description, topics, homepage posture, license, and contributor metadata note.",
          ]
        : blockers,
  };
}

function createDecisionRecordCheck(
  exists: (path: string) => boolean,
  readText: (path: string) => string,
): Split402PublicSurfaceCheck {
  const decision = readIfExists(
    "docs/decisions/0009-public-private-boundary-and-apache-license.md",
    exists,
    readText,
  );
  const blockers = [
    ...(decision?.includes("Status: accepted") === true
      ? []
      : ["Decision 0009 must be accepted."]),
    ...(decision?.includes("Apache-2.0") === true
      ? []
      : ["Decision 0009 must record Apache-2.0 for the public repository."]),
    ...(decision?.includes("private Split402 infrastructure") === true
      ? []
      : ["Decision 0009 must reserve sensitive operations for private infrastructure."]),
    ...(decision?.includes("Apache-2.0 is the launch-facing license") === true
      ? []
      : ["Decision 0009 must state that Apache-2.0 is the launch-facing license."]),
  ];
  return {
    id: "license_decision_record",
    label: "License and public/private decision is recorded",
    ok: blockers.length === 0,
    details:
      blockers.length === 0
        ? ["Decision 0009 records the Apache-2.0 public core and private operations boundary."]
        : blockers,
  };
}

function createNoMitLaunchClaimCheck(
  exists: (path: string) => boolean,
  readText: (path: string) => string,
): Split402PublicSurfaceCheck {
  const violations = MIT_FREE_PUBLIC_FILES.flatMap((path) => {
    const text = readIfExists(path, exists, readText);
    if (text === undefined || !/\bMIT\b/u.test(text)) {
      return [];
    }
    return [`${path} must not present MIT as the launch-facing license.`];
  });
  return {
    id: "no_mit_launch_facing_claims",
    label: "Launch-facing files do not claim MIT licensing",
    ok: violations.length === 0,
    details:
      violations.length === 0
        ? ["Launch-facing files do not claim MIT licensing."]
        : violations,
  };
}

function readIfExists(
  path: string,
  exists: (path: string) => boolean,
  readText: (path: string) => string,
): string | undefined {
  return exists(path) ? readText(path) : undefined;
}
