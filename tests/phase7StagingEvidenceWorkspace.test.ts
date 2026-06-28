import { describe, expect, it } from "vitest";

import { createPhase7StagingEvidenceWorkspace } from "../src/phase7StagingEvidenceWorkspace.js";
import { PHASE7_STAGING_ATTACHMENT_FIELDS } from "../src/phase7StagingProofAssembly.js";

describe("Phase 7 staging evidence workspace", () => {
  it("creates an env template for every staging attachment field", () => {
    const workspace = createPhase7StagingEvidenceWorkspace({
      directory: "evidence/phase7",
    });

    expect(workspace.directory).toBe("evidence/phase7");
    expect(workspace.envFileName).toBe("phase7-staging.env");
    expect(workspace.artifacts.map((artifact) => artifact.field)).toEqual(
      PHASE7_STAGING_ATTACHMENT_FIELDS,
    );
    expect(workspace.envText).toContain(
      "SPLIT402_PHASE7_ASSEMBLE_HOSTED_PREFLIGHT_EVIDENCE=evidence/phase7/hosted-preflight.json",
    );
    expect(workspace.envText).toContain(
      "SPLIT402_PHASE7_ASSEMBLE_AGENT_DISCOVERY_EVIDENCE=evidence/phase7/agent-discovery.json",
    );
    expect(workspace.envText).toContain(
      "SPLIT402_PHASE7_ASSEMBLE_FUNDING_BALANCE_EVIDENCE=evidence/phase7/funding-balance.json",
    );
    expect(workspace.envText).toContain(
      "SPLIT402_PHASE7_ASSEMBLE_MCP_GATEWAY_EVIDENCE=evidence/phase7/mcp-gateway.jsonl",
    );
    expect(workspace.envText).toContain(
      "SPLIT402_PHASE7_ASSEMBLE_ARTIFACT_MANIFEST_EVIDENCE=evidence/phase7/artifact-manifest.json",
    );
    expect(workspace.envText).toContain(
      "SPLIT402_PHASE7_ASSEMBLE_COMMANDS_RUN=evidence/phase7/commands.log",
    );
  });

  it("documents the expected artifact files without creating fake evidence content", () => {
    const workspace = createPhase7StagingEvidenceWorkspace();

    expect(workspace.readmeText).toContain("# Phase 7 Staging Evidence");
    expect(workspace.readmeText).toContain("hosted-preflight.json");
    expect(workspace.readmeText).toContain("funding-balance.json");
    expect(workspace.readmeText).toContain("mcp-gateway.jsonl");
    expect(workspace.readmeText).toContain("artifact-manifest.json");
    expect(workspace.readmeText).toContain(
      "router-backed discovery, execution, and receipt lookup",
    );
    expect(workspace.readmeText).toContain(
      "corepack pnpm phase7:staging:collect-mcp-gateway",
    );
    expect(workspace.readmeText).toContain(
      "corepack pnpm demo:mcp-gateway:smoke",
    );
    expect(workspace.readmeText).toContain("receiptVerificationStatus");
    expect(workspace.readmeText).toContain("protocolFeeBpsOfCommission");
    expect(workspace.readmeText).toContain(
      "corepack pnpm phase7:staging:derive-receipt-verification",
    );
    expect(workspace.readmeText).toContain("lint, typecheck, test, build");
    expect(workspace.readmeText).toContain(
      "Do not create\nplaceholder artifact files",
    );
    expect(workspace.artifacts.every((artifact) => artifact.fileName.length > 0)).toBe(
      true,
    );
  });
});
