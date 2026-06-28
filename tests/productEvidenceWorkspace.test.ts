import { describe, expect, it } from "vitest";

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
    expect(workspace.phase7ProofFileName).toBe("phase7-staging-proof.txt");
    expect(workspace.phase7EnvFileName).toBe("phase7-staging.env");
    expect(workspace.phase7.directory).toBe(
      "evidence/launch/phase7-staging-evidence",
    );
    expect(workspace.phase6EvidenceText).toContain("review_date: 2026-06-29");
    expect(workspace.phase6EvidenceText).toContain("source_commit: 096f190");
    expect(workspace.phase6EvidenceText).toContain("approval_decision: no-go");
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
      "corepack pnpm phase7:staging:collect-reads",
    );
    expect(workspace.nextCommands).toContain(
      "Review split402-launch-evidence/phase7-staging-proof.txt and fill direct hosted proof fields.",
    );
    expect(workspace.nextCommands).toContain(
      "corepack pnpm phase6:evidence:status split402-launch-evidence/phase6-custody-evidence.txt",
    );
    expect(workspace.nextCommands).toContain(
      "corepack pnpm product:status --brief split402-launch-evidence/phase6-custody-evidence.txt split402-launch-evidence/phase7-staging-proof.txt",
    );
  });
});
