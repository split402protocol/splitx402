import { describe, expect, it } from "vitest";

import {
  createSplit402PublicSurfaceCheckReport,
  formatSplit402PublicSurfaceCheckBrief,
} from "../src/productPublicSurfaceCheck.js";

describe("Split402 public surface check", () => {
  it("passes when launch-facing license and boundary files are aligned", () => {
    const files = createPublicSurfaceFiles();
    const report = createReport(files);

    expect(report).toMatchObject({
      schema: "split402.public_surface_check.v1",
      product: "Split402",
      repository: "split402protocol/splitx402",
      ok: true,
    });
    expect(formatSplit402PublicSurfaceCheckBrief(report)).toContain(
      "Split402 public surface check: passed",
    );
    expect(formatSplit402PublicSurfaceCheckBrief(report)).toContain(
      "Public repository: Apache-2.0 protocol foundation.",
    );
    expect(formatSplit402PublicSurfaceCheckBrief(report)).toContain(
      "GitHub About description: Agent payment routing and verifiable referral accounting for x402 APIs.",
    );
    expect(formatSplit402PublicSurfaceCheckBrief(report)).toContain(
      "Package publication: workspace packages stay private until intentional release artifacts are approved.",
    );
  });

  it("fails when launch-facing files drift back to MIT", () => {
    const files = createPublicSurfaceFiles({
      "README.md": "Split402\n\nLicensed under MIT.\n",
    });
    const report = createReport(files);

    expect(report.ok).toBe(false);
    expect(
      report.checks.find((check) => check.id === "no_mit_launch_facing_claims"),
    ).toMatchObject({
      ok: false,
      details: ["README.md must not present MIT as the launch-facing license."],
    });
  });

  it("fails when package metadata uses an old product description", () => {
    const files = createPublicSurfaceFiles({
      "package.json": JSON.stringify({
        name: "split402",
        description: "Referral and commission protocol infrastructure.",
        license: "Apache-2.0",
        private: true,
      }),
    });
    const report = createReport(files);

    expect(report.ok).toBe(false);
    expect(
      report.checks.find((check) => check.id === "package_license_metadata"),
    ).toMatchObject({
      ok: false,
      details: [
        'Set package.json description to "Agent payment routing and verifiable referral accounting for x402 APIs.".',
      ],
    });
  });

  it("fails when a workspace package becomes publishable before release approval", () => {
    const files = createPublicSurfaceFiles({
      "packages/router/package.json": JSON.stringify({
        name: "@split402/router",
        private: false,
      }),
    });
    const report = createReport(files);

    expect(report.ok).toBe(false);
    expect(
      report.checks.find(
        (check) => check.id === "workspace_package_publication_boundary",
      ),
    ).toMatchObject({
      ok: false,
      details: [
        "packages/router/package.json must keep private: true until that package has an intentional release decision.",
      ],
    });
  });

  it("fails when a workspace package manifest is missing from the public tree", () => {
    const files = createPublicSurfaceFiles();
    files.delete("apps/payout-signer/package.json");
    files.set("apps/payout-signer/README.md", "Payout signer app docs.\n");

    const report = createReport(files);

    expect(report.ok).toBe(false);
    expect(
      report.checks.find(
        (check) => check.id === "workspace_package_publication_boundary",
      ),
    ).toMatchObject({
      ok: false,
      details: ["Missing apps/payout-signer/package.json."],
    });
  });

  it("discovers new pnpm workspace packages before release approval", () => {
    const files = createPublicSurfaceFiles({
      "packages/new-provider/package.json": JSON.stringify({
        name: "@split402/new-provider",
        private: false,
      }),
    });

    const report = createReport(files);

    expect(report.ok).toBe(false);
    expect(
      report.checks.find(
        (check) => check.id === "workspace_package_publication_boundary",
      ),
    ).toMatchObject({
      ok: false,
      details: expect.arrayContaining([
        "packages/new-provider/package.json must keep private: true until that package has an intentional release decision.",
      ]),
    });
  });

  it("fails when the public/private boundary disappears", () => {
    const files = createPublicSurfaceFiles();
    files.delete("docs/PUBLIC_PRIVATE_BOUNDARY.md");

    const report = createReport(files);

    expect(report.ok).toBe(false);
    expect(
      report.checks.find(
        (check) => check.id === "required_public_surface_files",
      ),
    ).toMatchObject({
      ok: false,
      details: ["Missing docs/PUBLIC_PRIVATE_BOUNDARY.md."],
    });
  });

  it("fails when commercial readiness disclosures disappear", () => {
    const files = createPublicSurfaceFiles({
      "docs/COMMERCIAL_READINESS.md": [
        "# Commercial Readiness",
        "Split402 can launch commercially now.",
      ].join("\n"),
    });

    const report = createReport(files);

    expect(report.ok).toBe(false);
    expect(
      report.checks.find(
        (check) => check.id === "commercial_readiness_boundary",
      ),
    ).toMatchObject({
      ok: false,
      details: expect.arrayContaining([
        "docs/COMMERCIAL_READINESS.md must state public-alpha commercial status.",
        "docs/COMMERCIAL_READINESS.md must disclose the non-atomic MVP boundary.",
        "docs/COMMERCIAL_READINESS.md must disclose merchant solvency risk.",
        "docs/COMMERCIAL_READINESS.md must define the protocol fee basis.",
        "docs/COMMERCIAL_READINESS.md must keep custody and hosted launch behind Phase 6/7 approval.",
        "docs/COMMERCIAL_READINESS.md must include a commercial pre-launch gate.",
      ]),
    });
  });

  it("fails when the GitHub public profile contract drifts", () => {
    const files = createPublicSurfaceFiles({
      "docs/GITHUB_PUBLIC_PROFILE.md": [
        "Description: vague x402 stuff",
        "Topics:",
        "- x402",
        "License: MIT",
      ].join("\n"),
    });

    const report = createReport(files);

    expect(report.ok).toBe(false);
    expect(
      report.checks.find(
        (check) => check.id === "github_public_profile_contract",
      ),
    ).toMatchObject({
      ok: false,
      details: expect.arrayContaining([
        "docs/GITHUB_PUBLIC_PROFILE.md must include the canonical GitHub About description.",
        "docs/GITHUB_PUBLIC_PROFILE.md must keep homepage unset until public hosted evidence is ready.",
        "docs/GITHUB_PUBLIC_PROFILE.md must state the public license as Apache-2.0.",
        "docs/GITHUB_PUBLIC_PROFILE.md must include the launch boundary section.",
        "docs/GITHUB_PUBLIC_PROFILE.md must document how GitHub contributor metadata is generated.",
      ]),
    });
  });
});

function createPublicSurfaceFiles(
  overrides: Record<string, string> = {},
): Map<string, string> {
  return new Map(
    Object.entries({
      "package.json": JSON.stringify({
        name: "split402",
        description:
          "Agent payment routing and verifiable referral accounting for x402 APIs.",
        license: "Apache-2.0",
        private: true,
      }),
      "pnpm-workspace.yaml": ['packages:', '  - "packages/*"', '  - "apps/*"'].join("\n"),
      LICENSE: "Apache License\nVersion 2.0, January 2004\n",
      "README.md": [
        "![License](https://img.shields.io/badge/license-Apache--2.0-blue)",
        "[Public and private boundary](docs/PUBLIC_PRIVATE_BOUNDARY.md)",
        "[GitHub repository settings](docs/GITHUB_REPOSITORY_SETTINGS.md)",
        "[Release policy](docs/RELEASE_POLICY.md)",
        "[Commercial readiness](docs/COMMERCIAL_READINESS.md)",
        "[Pre-launch public/private review checklist](docs/checklists/prelaunch-public-private-review.md)",
        "[Public/private and license decision](docs/decisions/0009-public-private-boundary-and-apache-license.md)",
        "This public repository is licensed under [Apache-2.0](LICENSE).",
        "[Support policy](SUPPORT.md)",
      ].join("\n"),
      "SECURITY.md": "Report vulnerabilities privately.\n",
      ".github/CODEOWNERS": [
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
      ].join("\n"),
      "SUPPORT.md": [
        "Split402 is not production ready and not mainnet approved.",
        "No released versions are currently supported.",
        "Use GitHub Security Advisories.",
        "[`docs/RELEASE_POLICY.md`](docs/RELEASE_POLICY.md)",
      ].join("\n"),
      "docs/GITHUB_PUBLIC_PROFILE.md": [
        "Description: Agent payment routing and verifiable referral accounting for x402 APIs.",
        "Homepage: unset until a hosted public docs or demo URL is live and proof-gated.",
        "Topics:",
        "- agents",
        "- mcp",
        "- payments",
        "- protocol",
        "- solana",
        "- typescript",
        "- usdc",
        "- x402",
        "License: Apache-2.0",
        "## Launch Boundary",
        "[`docs/GITHUB_REPOSITORY_SETTINGS.md`](GITHUB_REPOSITORY_SETTINGS.md)",
        "Contributors are generated from commit author metadata.",
      ].join("\n"),
      "docs/GITHUB_REPOSITORY_SETTINGS.md": [
        "require pull request before merging",
        "require review from Code Owners",
        "require status checks to pass before merge",
        "block force pushes",
        "block branch deletion",
        "Local public-alpha proof",
        "postgres-integration",
        "CodeQL",
        "Secret scan",
        "Keep blank issues disabled",
        "GitHub Security Advisories",
        "Workspace packages stay `\"private\": true`",
        "The local checks prove the tracked repository surface.",
        "product:github-settings-review",
        "product:github-settings-review --from-github",
      ].join("\n"),
      "docs/PUBLIC_PRIVATE_BOUNDARY.md": [
        "## Public Repository",
        "## Private Commercial Surface",
        "## Pre-Launch Classification Matrix",
        "## License Policy",
        "This repository is licensed under Apache-2.0.",
        "Apache-2.0 is the launch-facing license for this public repository.",
      ].join("\n"),
      "docs/RELEASE_POLICY.md": [
        "Split402 has no supported public release yet.",
        "Keep every workspace package marked \"private\": true.",
        "corepack pnpm product:local-proof --brief",
        "corepack pnpm product:status --brief --workspace split402-launch-evidence",
        "corepack pnpm product:mainnet-canary --brief --workspace split402-launch-evidence",
        "A passing local proof does not approve public launch.",
        "readyForProductionMainnet remains false.",
        "product:mainnet-canary does not approve production mainnet launch.",
      ].join("\n"),
      "docs/COMMERCIAL_READINESS.md": [
        "# Commercial Readiness",
        "## Current Commercial Status",
        "- Public alpha only.",
        "The current MVP is referral attribution and commission accounting around normal x402 payments.",
        "It is not atomic on-chain payment splitting.",
        "A valid Split402 receipt proves a merchant-signed commission obligation, not that the merchant payout wallet is solvent.",
        "Protocol fees are calculated from the referral commission, using `protocolFeeBpsOfCommission`.",
        "Production custody, hosted operations, and mainnet use require Phase 6 and Phase 7 approval before any customer-facing launch claim.",
        "## Pre-Launch Commercial Gate",
        "Commercial launch remains blocked until all are true:",
      ].join("\n"),
      "docs/checklists/prelaunch-public-private-review.md": [
        "# Pre-Launch Public/Private Review",
        "Keep the public repository as the Apache-2.0 protocol foundation.",
        "Keep every workspace package marked \"private\": true.",
      ].join("\n"),
      "docs/decisions/0009-public-private-boundary-and-apache-license.md": [
        "Status: accepted",
        "The public repository is licensed under Apache-2.0.",
        "Apache-2.0 is the launch-facing license.",
        "The following belong in private Split402 infrastructure.",
      ].join("\n"),
      "apps/dashboard/package.json": JSON.stringify({
        name: "@split402/dashboard",
        private: true,
      }),
      "apps/demo-agent/package.json": JSON.stringify({
        name: "@split402/demo-agent",
        private: true,
      }),
      "apps/demo-merchant/package.json": JSON.stringify({
        name: "@split402/demo-merchant",
        private: true,
      }),
      "apps/mcp-demo/package.json": JSON.stringify({
        name: "@split402/mcp-demo",
        private: true,
      }),
      "apps/payout-signer/package.json": JSON.stringify({
        name: "@split402/payout-signer",
        private: true,
      }),
      "packages/agent-sdk/package.json": JSON.stringify({
        name: "@split402/agent-sdk",
        private: true,
      }),
      "packages/control-plane/package.json": JSON.stringify({
        name: "@split402/control-plane",
        private: true,
      }),
      "packages/express/package.json": JSON.stringify({
        name: "@split402/express",
        private: true,
      }),
      "packages/merchant-sdk/package.json": JSON.stringify({
        name: "@split402/merchant-sdk",
        private: true,
      }),
      "packages/protocol/package.json": JSON.stringify({
        name: "@split402/protocol",
        private: true,
      }),
      "packages/router/package.json": JSON.stringify({
        name: "@split402/router",
        private: true,
      }),
      "packages/test-vectors/package.json": JSON.stringify({
        name: "@split402/test-vectors",
        private: true,
      }),
      "packages/x402-extension/package.json": JSON.stringify({
        name: "@split402/x402-extension",
        private: true,
      }),
      ...overrides,
    }),
  );
}

function createReport(files: Map<string, string>) {
  return createSplit402PublicSurfaceCheckReport({
    exists: (path) => files.has(path) || path === "apps" || path === "packages",
    listDirectory: (path) => listVirtualDirectory(files, path),
    readText: (path) => files.get(path) ?? "",
  });
}

function listVirtualDirectory(files: ReadonlyMap<string, string>, path: string): string[] {
  const prefix = `${path}/`;
  const entries = new Set<string>();
  for (const filePath of files.keys()) {
    if (!filePath.startsWith(prefix)) {
      continue;
    }
    const [entry] = filePath.slice(prefix.length).split("/");
    if (entry !== undefined && entry.length > 0) {
      entries.add(entry);
    }
  }
  return [...entries].sort((left, right) => left.localeCompare(right));
}
