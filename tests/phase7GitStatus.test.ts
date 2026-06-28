import { describe, expect, it } from "vitest";

import {
  isPhase7SourceWorktreeDirty,
  listPhase7SourceWorktreeChanges,
} from "../src/phase7GitStatus.js";

describe("Phase 7 git status filtering", () => {
  it("allows generated proof and attached evidence artifacts", () => {
    const changes = listPhase7SourceWorktreeChanges({
      porcelainStatus: [
        "?? phase7-staging-proof.txt",
        "?? phase7-staging-evidence/hosted-preflight.json",
        "?? phase7-staging-evidence/artifact-manifest.json",
        "?? evidence/phase7/mcp-gateway.jsonl",
        "",
      ].join("\n"),
      proofPath: "phase7-staging-proof.txt",
      allowedArtifactPaths: ["evidence/phase7/mcp-gateway.jsonl"],
    });

    expect(changes).toEqual([]);
  });

  it("allows absolute proof and artifact paths inside the repository", () => {
    const changes = listPhase7SourceWorktreeChanges({
      porcelainStatus: [
        "?? phase7-staging-proof.txt",
        "?? evidence/phase7/mcp-gateway.jsonl",
        "",
      ].join("\n"),
      proofPath: "C:/repo/splitx402/phase7-staging-proof.txt",
      allowedArtifactPaths: ["C:/repo/splitx402/evidence/phase7/mcp-gateway.jsonl"],
      repositoryRoot: "C:/repo/splitx402",
    });

    expect(changes).toEqual([]);
  });

  it("blocks source changes outside the proof artifact paths", () => {
    expect(
      listPhase7SourceWorktreeChanges({
        porcelainStatus: [
          " M src/phase7StagingStatus.ts",
          "?? packages/router/src/new-file.ts",
          "?? phase7-staging-evidence/mcp-gateway.jsonl",
          "",
        ].join("\n"),
        allowedArtifactPaths: ["phase7-staging-evidence/mcp-gateway.jsonl"],
      }),
    ).toEqual(["src/phase7StagingStatus.ts", "packages/router/src/new-file.ts"]);
  });

  it("handles renamed proof artifacts by checking the destination path", () => {
    expect(
      isPhase7SourceWorktreeDirty({
        porcelainStatus:
          "R  phase7-staging-evidence/old.json -> phase7-staging-evidence/new.json\n",
      }),
    ).toBe(false);
  });
});
