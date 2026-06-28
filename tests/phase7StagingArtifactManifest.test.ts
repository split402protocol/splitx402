import { describe, expect, it } from "vitest";

import { createPhase7StagingArtifactManifest } from "../src/phase7StagingArtifactManifest.js";
import { createPhase7StagingProofRecord } from "../src/phase7StagingProof.js";

describe("Phase 7 staging artifact manifest", () => {
  it("hashes local attached artifacts", () => {
    const manifest = createPhase7StagingArtifactManifest(
      createPhase7StagingProofRecord({
        paid_request_evidence: "attached: paid-suite.log",
        mcp_gateway_evidence: "attached: mcp-gateway.jsonl",
        artifact_manifest_evidence: "attached: artifact-manifest.json",
      }),
      {
        artifactBaseDir: "evidence",
        readArtifact: (path) => {
          if (path === "evidence/mcp-gateway.jsonl") {
            return new TextEncoder().encode("gateway proof\n");
          }
          if (path !== "evidence/paid-suite.log") {
            throw new Error(`unexpected artifact path ${path}`);
          }
          return new TextEncoder().encode("paid proof\n");
        },
      },
    );

    expect(manifest).toMatchObject({
      schema: "split402.phase7_artifact_manifest.v1",
      artifactBaseDir: "evidence",
    });
    expect(manifest.artifacts).toContainEqual({
      evidenceField: "paid_request_evidence",
      reference: "attached: paid-suite.log",
      kind: "local",
      artifactPath: "evidence/paid-suite.log",
      sizeBytes: 11,
      sha256: "1ba45a5375f1fb67d0920c315250c625521f9171bb169d164e36e57b7408fa70",
    });
    expect(manifest.artifacts).toContainEqual({
      evidenceField: "mcp_gateway_evidence",
      reference: "attached: mcp-gateway.jsonl",
      kind: "local",
      artifactPath: "evidence/mcp-gateway.jsonl",
      sizeBytes: 14,
      sha256: "987839459e78ca4042287f31f96c7d98af69df6b18a7fdbab87652f9b4b488f7",
    });
    expect(manifest.artifacts.map((artifact) => artifact.evidenceField)).not.toContain(
      "artifact_manifest_evidence",
    );
  });

  it("rejects remote references for proof artifacts that must be local", () => {
    expect(() =>
      createPhase7StagingArtifactManifest(
        createPhase7StagingProofRecord({
          agent_discovery_evidence: "https://artifacts.example/discovery.json",
          artifact_manifest_evidence: "attached: artifact-manifest.json",
        }),
        {
          artifactBaseDir: "evidence",
          readArtifact: () => new Uint8Array(),
        },
      ),
    ).toThrow("agent_discovery_evidence must be an attached local artifact");
  });

  it("rejects bare artifact paths in proof records", () => {
    expect(() =>
      createPhase7StagingArtifactManifest(
        createPhase7StagingProofRecord({
          agent_discovery_evidence: "agent-discovery.json",
          artifact_manifest_evidence: "attached: artifact-manifest.json",
        }),
        {
          artifactBaseDir: "evidence",
          readArtifact: () => new Uint8Array(),
        },
      ),
    ).toThrow("agent_discovery_evidence must be an attached local artifact");
  });
});
