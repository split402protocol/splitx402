import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createProductEvidenceInitWrites,
  findExistingProductEvidenceInitWrites,
  parseProductEvidenceInitArgs,
} from "../src/productEvidenceInitPlan.js";
import { createSplit402ProductEvidenceWorkspace } from "../src/productEvidenceWorkspace.js";

describe("Split402 product evidence workspace", () => {
  it("scaffolds Phase 6 and Phase 7 evidence paths together", () => {
    const workspace = createSplit402ProductEvidenceWorkspace({
      directory: "evidence/launch",
      sourceCommit: "096f190",
      reviewDate: "2026-06-29",
    });

    expect(workspace.directory).toBe("evidence/launch");
    expect(workspace.phase6EvidenceFileName).toBe("phase6-custody-evidence.txt");
    expect(workspace.phase6EnvFileName).toBe("phase6-evidence.env");
    expect(workspace.phase7ProofFileName).toBe("phase7-staging-proof.txt");
    expect(workspace.phase7EnvFileName).toBe("phase7-staging.env");
    expect(workspace.phase7.directory).toBe(
      "evidence/launch/phase7-staging-evidence",
    );
    expect(workspace.phase6EvidenceText).toContain("review_date: 2026-06-29");
    expect(workspace.phase6EvidenceText).toContain("source_commit: 096f190");
    expect(workspace.phase6EvidenceText).toContain("approval_decision: no-go");
    expect(workspace.phase6EnvText).toContain(
      "SPLIT402_PHASE6_ASSEMBLE_IMAGE_PROVENANCE_RECORD",
    );
    expect(workspace.phase7ProofText).toContain("proof_date: 2026-06-29");
    expect(workspace.phase7ProofText).toContain("source_commit: 096f190");
    expect(workspace.phase7ProofText).toContain("approval_decision: no-go");
    expect(workspace.phase7ProofText).toContain(
      "hosted_preflight_evidence: attached: phase7-staging-evidence/hosted-preflight.json",
    );
    expect(workspace.phase7ProofText).toContain(
      "commands_run: attached: phase7-staging-evidence/commands.log",
    );
    expect(workspace.phase7.envText).toContain(
      "SPLIT402_PHASE7_EVIDENCE_DIR=evidence/launch/phase7-staging-evidence",
    );
  });

  it("documents the no-go launch posture and next commands", () => {
    const workspace = createSplit402ProductEvidenceWorkspace();

    expect(workspace.readmeText).toContain(
      "# Split402 Launch Evidence Workspace",
    );
    expect(workspace.readmeText).toContain("Launch gates ready: 0/2 (0%)");
    expect(workspace.readmeText).toContain("Mainnet ready: no");
    expect(workspace.readmeText).toContain(
      "The product remains `no-go` until the Phase 7 hosted proof and Phase 6",
    );
    expect(workspace.nextCommands).toContain(
      "corepack pnpm product:launch-preflight --brief split402-launch-evidence",
    );
    expect(workspace.nextCommands).toContain(
      "corepack pnpm phase7:staging:collect-reads",
    );
    expect(workspace.nextCommands).toContain(
      "corepack pnpm phase7:staging:commands-template > split402-launch-evidence/phase7-staging-evidence/commands.log",
    );
    expect(workspace.nextCommands).toContain(
      "Review split402-launch-evidence/phase7-staging-proof.txt and fill direct hosted proof fields.",
    );
    expect(workspace.nextCommands).toContain(
      "corepack pnpm phase6:evidence:env-template > split402-launch-evidence/phase6-evidence.env",
    );
    expect(workspace.nextCommands).toContain(
      "Fill split402-launch-evidence/phase6-evidence.env with Phase 6 custody record paths.",
    );
    expect(workspace.nextCommands).toContain(
      "corepack pnpm phase6:evidence:status split402-launch-evidence/phase6-custody-evidence.txt",
    );
    expect(workspace.nextCommands).toContain(
      "corepack pnpm product:status --brief split402-launch-evidence/phase6-custody-evidence.txt split402-launch-evidence/phase7-staging-proof.txt",
    );
  });

  it("plans every scaffold file written by the product evidence initializer", () => {
    const workspace = createSplit402ProductEvidenceWorkspace({
      directory: "evidence/launch",
    });

    expect(createProductEvidenceInitWrites(workspace).map((write) => write.path))
      .toEqual([
        join("evidence/launch", "README.md"),
        join("evidence/launch", "phase6-custody-evidence.txt"),
        join("evidence/launch", "phase6-evidence.env"),
        join("evidence/launch", "phase7-staging-proof.txt"),
        join("evidence/launch", "phase7-staging.env"),
        join("evidence/launch/phase7-staging-evidence", "README.md"),
      ]);
  });

  it("detects existing scaffold files before overwriting launch evidence", () => {
    const workspace = createSplit402ProductEvidenceWorkspace();
    const writes = createProductEvidenceInitWrites(workspace);

    expect(
      findExistingProductEvidenceInitWrites(writes, (path) =>
        path.endsWith("phase7-staging-proof.txt"),
      ),
    ).toEqual([
      join("split402-launch-evidence", "phase7-staging-proof.txt"),
    ]);
  });

  it("parses an intentional force flag for evidence scaffold replacement", () => {
    expect(parseProductEvidenceInitArgs(["--force", "evidence/launch"])).toEqual(
      {
        directory: "evidence/launch",
        force: true,
      },
    );
    expect(parseProductEvidenceInitArgs([])).toEqual({
      directory: "split402-launch-evidence",
      force: false,
    });
    expect(() =>
      parseProductEvidenceInitArgs(["one", "two"]),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: Usage: corepack pnpm product:evidence:init [--force] [directory]]`,
    );
  });
});
