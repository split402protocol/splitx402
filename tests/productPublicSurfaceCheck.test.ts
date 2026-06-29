import { describe, expect, it } from "vitest";

import {
  createSplit402PublicSurfaceCheckReport,
  formatSplit402PublicSurfaceCheckBrief,
} from "../src/productPublicSurfaceCheck.js";

describe("Split402 public surface check", () => {
  it("passes when launch-facing license and boundary files are aligned", () => {
    const files = createPublicSurfaceFiles();
    const report = createSplit402PublicSurfaceCheckReport({
      exists: (path) => files.has(path),
      readText: (path) => files.get(path) ?? "",
    });

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
  });

  it("fails when launch-facing files drift back to MIT", () => {
    const files = createPublicSurfaceFiles({
      "README.md": "Split402\n\nLicensed under MIT.\n",
    });
    const report = createSplit402PublicSurfaceCheckReport({
      exists: (path) => files.has(path),
      readText: (path) => files.get(path) ?? "",
    });

    expect(report.ok).toBe(false);
    expect(
      report.checks.find((check) => check.id === "no_mit_launch_facing_claims"),
    ).toMatchObject({
      ok: false,
      details: ["README.md must not present MIT as the launch-facing license."],
    });
  });

  it("fails when the public/private boundary disappears", () => {
    const files = createPublicSurfaceFiles();
    files.delete("docs/PUBLIC_PRIVATE_BOUNDARY.md");

    const report = createSplit402PublicSurfaceCheckReport({
      exists: (path) => files.has(path),
      readText: (path) => files.get(path) ?? "",
    });

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
});

function createPublicSurfaceFiles(
  overrides: Record<string, string> = {},
): Map<string, string> {
  return new Map(
    Object.entries({
      "package.json": JSON.stringify({
        name: "split402",
        license: "Apache-2.0",
        private: true,
      }),
      LICENSE: "Apache License\nVersion 2.0, January 2004\n",
      "README.md": [
        "![License](https://img.shields.io/badge/license-Apache--2.0-blue)",
        "[Public and private boundary](docs/PUBLIC_PRIVATE_BOUNDARY.md)",
        "[Public/private and license decision](docs/decisions/0009-public-private-boundary-and-apache-license.md)",
        "This public repository is licensed under [Apache-2.0](LICENSE).",
      ].join("\n"),
      "SECURITY.md": "Report vulnerabilities privately.\n",
      "docs/PUBLIC_PRIVATE_BOUNDARY.md": [
        "## Public Repository",
        "## Private Commercial Surface",
        "## License Policy",
        "This repository is licensed under Apache-2.0.",
      ].join("\n"),
      "docs/decisions/0009-public-private-boundary-and-apache-license.md": [
        "Status: accepted",
        "The public repository is licensed under Apache-2.0.",
        "The following belong in private Split402 infrastructure.",
      ].join("\n"),
      ...overrides,
    }),
  );
}
