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
      "# SPLIT402_PHASE7_PROOF_ID=phase7-staging-YYYY-MM-DD",
    );
    expect(workspace.envText).toContain(
      "# SPLIT402_PHASE7_CONTROL_PLANE_URL=http://localhost:4021",
    );
    expect(workspace.envText).toContain(
      "# SPLIT402_PHASE7_SOURCE_COMMIT defaults to git rev-parse HEAD when omitted.",
    );
    expect(workspace.envText).toContain(
      "# SPLIT402_PHASE7_SEED_CONFIRM=seed-hosted-staging",
    );
    expect(workspace.envText).toContain(
      "# SPLIT402_DATABASE_URL=postgresql://split402:split402@localhost:5432/split402",
    );
    expect(workspace.envText).toContain(
      "# SPLIT402_PHASE7_MERCHANT_ID=<seed-output-merchant-id>",
    );
    expect(workspace.envText).toContain(
      "# SPLIT402_PHASE7_REFERRER_WALLET=<seed-output-referrer-wallet>",
    );
    expect(workspace.envText).toContain(
      "# SPLIT402_DASHBOARD_MERCHANT_ID=<seed-output-merchant-id>",
    );
    expect(workspace.envText).toContain(
      "# SPLIT402_DASHBOARD_REFERRER_WALLET=<seed-output-referrer-wallet>",
    );
    expect(workspace.envText).toContain(
      "# SPLIT402_DASHBOARD_VIEWER_TOKEN=<dashboard-viewer-token>",
    );
    expect(workspace.envText).toContain(
      "# SPLIT402_MERCHANT_ORIGIN=http://localhost:4023",
    );
    expect(workspace.envText).toContain(
      "# SPLIT402_MERCHANT_PUBLIC_KEY=<seed-output-service-public-key>",
    );
    expect(workspace.envText).not.toContain(
      "\nSPLIT402_MERCHANT_PUBLIC_KEY=<seed-output-service-public-key>",
    );
    expect(workspace.envText).toContain(
      "# SPLIT402_FUNDING_BALANCE_PROVIDER=solana-rpc",
    );
    expect(workspace.envText).toContain(
      "# SPLIT402_FUNDING_BALANCE_SOLANA_RPC_URL=https://api.devnet.solana.com",
    );
    expect(workspace.envText).toContain(
      "# SPLIT402_FUNDING_BALANCE_SOLANA_RPC_URLS=<comma-separated-rpc-urls>",
    );
    expect(workspace.envText).not.toContain(
      "\nSPLIT402_FUNDING_BALANCE_PROVIDER=solana-rpc",
    );
    expect(workspace.envText).toContain(
      "# SPLIT402_MCP_CONTROL_PLANE_URL=http://localhost:4021",
    );
    expect(workspace.envText).toContain(
      "# SPLIT402_PHASE7_MCP_GATEWAY_EXECUTE=1",
    );
    expect(workspace.envText).toContain(
      "# SPLIT402_MCP_SVM_PRIVATE_KEY=<funded-devnet-buyer-private-key>",
    );
    expect(workspace.envText).toContain(
      "SPLIT402_PHASE7_EVIDENCE_DIR=evidence/phase7",
    );
    expect(workspace.envText).not.toContain(
      "\nSPLIT402_MCP_SVM_PRIVATE_KEY=<funded-devnet-buyer-private-key>",
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
      "SPLIT402_PHASE7_SEED_CONFIRM=seed-hosted-staging corepack pnpm phase7:staging:seed",
    );
    expect(workspace.readmeText).toContain("git rev-parse HEAD");
    expect(workspace.readmeText).toContain("git status --short --branch");
    expect(workspace.readmeText).toContain(
      "corepack pnpm phase7:hosted:preflight",
    );
    expect(workspace.readmeText).toContain(
      "# Confirm hosted control plane has SPLIT402_FUNDING_BALANCE_PROVIDER=solana-rpc.",
    );
    expect(workspace.readmeText).not.toContain(
      "phase7:hosted:preflight > phase7-staging-evidence/hosted-preflight.json",
    );
    expect(workspace.readmeText).toContain(
      "# Fill SPLIT402_MCP_* hosted proof variables and use a funded buyer key.",
    );
    expect(workspace.readmeText).toContain(
      "SPLIT402_PHASE7_MCP_GATEWAY_EXECUTE=1 corepack pnpm phase7:staging:collect-mcp-gateway",
    );
    expect(workspace.readmeText).not.toContain(
      "\ncorepack pnpm phase7:staging:collect-mcp-gateway\n",
    );
    expect(workspace.readmeText).toContain(
      "corepack pnpm demo:mcp-gateway:smoke",
    );
    expect(workspace.readmeText).toContain("receiptVerificationStatus");
    expect(workspace.readmeText).toContain("protocolFeeBpsOfCommission");
    expect(workspace.readmeText).toContain(
      "report should include providerId, payToWallet",
    );
    expect(workspace.readmeText).toContain("selected provider payToWallet");
    expect(workspace.readmeText).toContain("matching receipt payToWallet");
    expect(workspace.readmeText).toContain(
      "`phase7:hosted:preflight` writes `hosted-preflight.json`",
    );
    expect(workspace.readmeText).toContain(
      "Funding-balance evidence requires the hosted control plane to run with",
    );
    expect(workspace.readmeText).toContain(
      "`SPLIT402_FUNDING_BALANCE_PROVIDER=solana-rpc`",
    );
    expect(workspace.readmeText).toContain(
      "`phase7:staging-proof` and `phase7:staging:assemble` fill `source_commit`",
    );
    expect(workspace.readmeText).toContain(
      "corepack pnpm phase7:staging:derive-receipt-verification",
    );
    expect(workspace.readmeText).toContain(
      "The staging seed prints `proofEnv`; copy those values",
    );
    expect(workspace.readmeText).toContain(
      "corepack pnpm phase7:staging:manifest phase7-staging-proof.txt > phase7-staging-evidence/artifact-manifest.json",
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
