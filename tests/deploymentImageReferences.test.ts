import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("production-facing deployment image references", () => {
  it("packages both custody-facing runtime images from pinned Dockerfiles", () => {
    const signerDockerfile = readFileSync("apps/payout-signer/Dockerfile", "utf8");
    const controlPlaneDockerfile = readFileSync(
      "packages/control-plane/Dockerfile",
      "utf8",
    );

    expect(signerDockerfile).toContain("node:22-bookworm-slim");
    expect(signerDockerfile).toContain(
      "pnpm --filter @split402/payout-signer... build",
    );
    expect(signerDockerfile).toContain(
      'CMD ["node", "apps/payout-signer/dist/index.js"]',
    );

    expect(controlPlaneDockerfile).toContain("node:22-bookworm-slim");
    expect(controlPlaneDockerfile).toContain(
      "pnpm --filter @split402/control-plane... build",
    );
    expect(controlPlaneDockerfile).toContain(
      'CMD ["node", "packages/control-plane/dist/server.js"]',
    );
  });

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
    const controlPlaneReadme = readFileSync(
      "packages/control-plane/README.md",
      "utf8",
    );

    expect(runbook).toContain("immutable `sha256:` digest");
    expect(runbook).toContain("packages/control-plane/Dockerfile");
    expect(runbook).toContain("SPLIT402_CONTROL_PLANE_IMAGE_DIGEST");
    expect(runbook).not.toMatch(/\brelease tag\b/iu);
    expect(runbook).not.toContain(":latest");
    expect(signerReadme).toContain("placeholder image digest");
    expect(signerReadme).toContain("local/dev only");
    expect(signerReadme).toContain(
      "ghcr.io/split402protocol/splitx402/payout-signer@sha256:<digest>",
    );
    expect(controlPlaneReadme).toContain(
      "ghcr.io/split402protocol/splitx402/control-plane@sha256:<digest>",
    );
  });
});
