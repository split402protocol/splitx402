import { describe, expect, it } from "vitest";

import {
  assertImageDigest,
  createPhase6ImageProvenanceRecord,
} from "../src/phase6ImageProvenance.js";

describe("Phase 6 image provenance record", () => {
  it("creates a review record with immutable image digests", () => {
    expect(
      createPhase6ImageProvenanceRecord({
        reviewId: "phase6-image-review-001",
        reviewDate: "2026-06-25",
        reviewers: "security, operations",
        sourceCommit: "25b8dd2",
        signerImageDigest:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        controlPlaneImageDigest:
          "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        dependencyAuditOutput: "attached: audit-001.log",
        buildLogRecord: "attached: build-001.log",
        sbomRecord: "attached: sbom-001.spdx.json",
      }),
    ).toContain("review_id: phase6-image-review-001\n");
  });

  it("rejects mutable image tags", () => {
    expect(() => assertImageDigest("latest", "signerImageDigest")).toThrow(
      "signerImageDigest must be an immutable sha256 digest",
    );
  });

  it("requires audit, build log, and SBOM records", () => {
    expect(() =>
      createPhase6ImageProvenanceRecord({
        reviewId: "phase6-image-review-001",
        reviewDate: "2026-06-25",
        reviewers: "security, operations",
        sourceCommit: "25b8dd2",
        signerImageDigest:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        controlPlaneImageDigest:
          "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        dependencyAuditOutput: "",
        buildLogRecord: "attached: build-001.log",
        sbomRecord: "attached: sbom-001.spdx.json",
      }),
    ).toThrow("dependencyAuditOutput is required");
  });
});
