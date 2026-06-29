import { existsSync, readFileSync } from "node:fs";

export interface Split402PublicSurfaceCheckInput {
  exists?: (path: string) => boolean;
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
  "docs/PUBLIC_PRIVATE_BOUNDARY.md",
  "docs/decisions/0009-public-private-boundary-and-apache-license.md",
] as const;

const MIT_FREE_PUBLIC_FILES = ["LICENSE", "README.md", "package.json"] as const;

export function createSplit402PublicSurfaceCheckReport(
  input: Split402PublicSurfaceCheckInput = {},
): Split402PublicSurfaceCheckReport {
  const exists = input.exists ?? existsSync;
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
    createApacheLicenseFileCheck(exists, readText),
    createReadmeBoundaryCheck(exists, readText),
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
      license?: unknown;
      private?: unknown;
    };
    const blockers = [
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
          ? ["package.json declares Apache-2.0 and keeps the workspace private."]
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

function createBoundaryPolicyCheck(
  exists: (path: string) => boolean,
  readText: (path: string) => string,
): Split402PublicSurfaceCheck {
  const boundary = readIfExists(
    "docs/PUBLIC_PRIVATE_BOUNDARY.md",
    exists,
    readText,
  );
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
    ...(boundary?.includes("Apache-2.0") === true
      ? []
      : ["docs/PUBLIC_PRIVATE_BOUNDARY.md must state Apache-2.0 for the public repository."]),
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
