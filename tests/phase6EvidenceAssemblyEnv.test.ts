import { describe, expect, it } from "vitest";

import { parsePhase6EvidenceEnvTemplateCliArgs } from "../src/phase6-evidence-env-template.js";
import { createPhase6EvidenceAssemblyEnvTemplate } from "../src/phase6EvidenceAssemblyEnv.js";

describe("Phase 6 evidence assembly env template", () => {
  it("parses help and rejects unknown CLI options", () => {
    expect(parsePhase6EvidenceEnvTemplateCliArgs(["--help"])).toEqual({
      help: true,
    });
    expect(parsePhase6EvidenceEnvTemplateCliArgs(["evidence/launch"])).toEqual({
      directory: "evidence/launch",
      help: false,
    });
    expect(
      parsePhase6EvidenceEnvTemplateCliArgs([
        "evidence/launch",
        "evidence/launch/phase6-evidence.env",
      ]),
    ).toEqual({
      directory: "evidence/launch",
      outputPath: "evidence/launch/phase6-evidence.env",
      help: false,
    });
    expect(() =>
      parsePhase6EvidenceEnvTemplateCliArgs(["--directory"]),
    ).toThrowErrorMatchingInlineSnapshot(`
      [Error: Usage: corepack pnpm phase6:evidence:env-template [evidence-directory] [phase6-evidence.env]
      Unknown option: --directory]
    `);
    expect(() =>
      parsePhase6EvidenceEnvTemplateCliArgs(["one", "two", "three"]),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: Usage: corepack pnpm phase6:evidence:env-template [evidence-directory] [phase6-evidence.env]]`,
    );
  });

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
      "# corepack pnpm phase6:evidence:assemble --evidence-env-file split402-launch-evidence/phase6-evidence.env split402-launch-evidence/phase6-custody-evidence.txt",
    );
    expect(template).not.toMatch(/^\s*SPLIT402_PHASE6_/mu);
  });

  it("uses the selected launch evidence directory in generated paths", () => {
    const template = createPhase6EvidenceAssemblyEnvTemplate({
      directory: "evidence/launch",
    });

    expect(template).toContain(
      "# SPLIT402_PHASE6_ASSEMBLE_IMAGE_PROVENANCE_RECORD=evidence/launch/phase6-image-provenance.txt",
    );
    expect(template).toContain(
      "# corepack pnpm phase6:evidence:assemble --evidence-env-file evidence/launch/phase6-evidence.env evidence/launch/phase6-custody-evidence.txt",
    );
    expect(template).not.toContain("split402-launch-evidence/phase6-image-provenance.txt");
  });

  it("can activate non-secret record path mappings for product evidence workspaces", () => {
    const template = createPhase6EvidenceAssemblyEnvTemplate({
      activateRecordPathMappings: true,
      directory: "evidence/launch",
    });

    expect(template).toContain(
      "SPLIT402_PHASE6_ASSEMBLE_IMAGE_PROVENANCE_RECORD=evidence/launch/phase6-image-provenance.txt",
    );
    expect(template).toContain(
      "SPLIT402_PHASE6_ASSEMBLE_NETWORK_POLICY_RECORD=evidence/launch/phase6-network-policy-review.txt",
    );
    expect(template).not.toContain(
      "# SPLIT402_PHASE6_ASSEMBLE_IMAGE_PROVENANCE_RECORD=evidence/launch/phase6-image-provenance.txt",
    );
    expect(template).toContain(
      "# SPLIT402_PHASE6_EVIDENCE_REVIEW_ID=phase6-custody-YYYY-MM-DD",
    );
  });
});
