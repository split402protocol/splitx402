import { describe, expect, it } from "vitest";

import { createPhase6EvidenceAssemblyEnvTemplate } from "../src/phase6EvidenceAssemblyEnv.js";

describe("Phase 6 evidence assembly env template", () => {
  it("prints commented local env guidance without preconfigured evidence values", () => {
    const template = createPhase6EvidenceAssemblyEnvTemplate();

    expect(template).toContain(
      "# SPLIT402_PHASE6_ASSEMBLE_IMAGE_PROVENANCE_RECORD=split402-launch-evidence/phase6-image-provenance.txt",
    );
    expect(template).toContain(
      "# SPLIT402_PHASE6_ASSEMBLE_SIGNER_POLICY_RECORD=split402-launch-evidence/phase6-signer-policy-review.txt",
    );
    expect(template).toContain(
      "# SPLIT402_PHASE6_ASSEMBLE_NETWORK_POLICY_RECORD=split402-launch-evidence/phase6-network-policy-review.txt",
    );
    expect(template.match(/SPLIT402_PHASE6_ASSEMBLE_SIGNER_POLICY_RECORD/gu))
      .toHaveLength(1);
    expect(template).toContain(
      "# corepack pnpm phase6:evidence:assemble > split402-launch-evidence/phase6-custody-evidence.txt",
    );
    expect(template).not.toMatch(/^\s*SPLIT402_PHASE6_/mu);
  });
});
