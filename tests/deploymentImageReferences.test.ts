import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("production-facing deployment image references", () => {
  it("keeps the payout signer manifest pinned to an immutable digest shape", () => {
    const manifest = readFileSync("deploy/payout-signer/kubernetes.yaml", "utf8");
    const imageLine = manifest
      .split(/\r?\n/u)
      .find((line) => line.trim().startsWith("image:"));

    expect(imageLine).toBeDefined();
    expect(imageLine).not.toContain(":latest");
    expect(imageLine?.trim()).toMatch(
      /^image:\s+"ghcr\.io\/split402protocol\/splitx402\/payout-signer@sha256:(?:<replace-with-image-digest>|[a-f0-9]{64})"$/u,
    );
  });

  it("documents digest-only production signer deployment guidance", () => {
    const runbook = readFileSync(
      "docs/runbooks/payout-signer-deployment.md",
      "utf8",
    );
    const signerReadme = readFileSync("apps/payout-signer/README.md", "utf8");

    expect(runbook).toContain("immutable `sha256:` digest");
    expect(runbook).not.toMatch(/\brelease tag\b/iu);
    expect(runbook).not.toContain(":latest");
    expect(signerReadme).toContain("placeholder image digest");
  });
});
