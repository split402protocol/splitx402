import { describe, expect, it } from "vitest";

import {
  PHASE6_EVIDENCE_COLLECTOR_RECORDS,
  collectPhase6EvidenceRecords,
} from "../src/phase6EvidenceCollector.js";

describe("Phase 6 evidence collector", () => {
  it("writes generated records to configured env paths", () => {
    const writes: Array<{ path: string; text: string }> = [];
    const commands: string[] = [];
    const report = collectPhase6EvidenceRecords({
      env: configuredEnv(),
      exists: () => false,
      writeText: (path, text) => writes.push({ path, text }),
      runCommand: (file, args) => {
        commands.push([file, ...args].join(" "));
        return {
          exitCode: 0,
          stdout: `${args.at(-1)} record\n`,
          stderr: "",
        };
      },
    });

    expect(report.ok).toBe(true);
    expect(report.generated).toBe(PHASE6_EVIDENCE_COLLECTOR_RECORDS.length);
    expect(report.blocked).toBe(0);
    expect(writes).toHaveLength(PHASE6_EVIDENCE_COLLECTOR_RECORDS.length);
    expect(writes[0]).toEqual({
      path: "evidence/phase6-image-provenance.txt",
      text: "phase6:image-provenance record\n",
    });
    expect(commands).toContain("corepack pnpm phase6:signer-policy");
    expect(report.nextActions).toContain(
      "Run corepack pnpm phase6:evidence:assemble --evidence-env-file split402-launch-evidence/phase6-evidence.env split402-launch-evidence/phase6-custody-evidence.txt.",
    );
  });

  it("blocks records whose output path env mapping is missing", () => {
    const report = collectPhase6EvidenceRecords({
      env: {},
      exists: () => false,
      writeText: () => {
        throw new Error("should not write");
      },
      runCommand: () => {
        throw new Error("should not run");
      },
    });

    expect(report.ok).toBe(false);
    expect(report.generated).toBe(0);
    expect(report.blocked).toBe(PHASE6_EVIDENCE_COLLECTOR_RECORDS.length);
    expect(report.items[0]).toMatchObject({
      name: "image_provenance",
      status: "blocked",
      detail:
        "SPLIT402_PHASE6_ASSEMBLE_IMAGE_PROVENANCE_RECORD is not configured in the Phase 6 evidence env file.",
    });
  });

  it("refuses to overwrite existing private evidence without force", () => {
    const report = collectPhase6EvidenceRecords({
      env: configuredEnv(),
      exists: (path) => path === "evidence/phase6-signer-policy-review.txt",
      writeText: () => undefined,
      runCommand: () => ({ exitCode: 0, stdout: "ok\n", stderr: "" }),
    });

    expect(report.ok).toBe(false);
    expect(report.items).toContainEqual(
      expect.objectContaining({
        name: "signer_policy",
        status: "blocked",
        detail:
          "evidence/phase6-signer-policy-review.txt already exists; pass --force only when intentionally replacing private evidence.",
      }),
    );
  });

  it("records command failures without writing failed output", () => {
    const writes: string[] = [];
    const report = collectPhase6EvidenceRecords({
      env: configuredEnv(),
      force: true,
      exists: () => true,
      writeText: (path) => writes.push(path),
      runCommand: (_file, args) =>
        args.includes("phase6:network-policy")
          ? { exitCode: 1, stdout: "", stderr: "missing network evidence\n" }
          : { exitCode: 0, stdout: "ok\n", stderr: "" },
    });

    expect(report.ok).toBe(false);
    expect(writes).not.toContain("evidence/phase6-network-policy-review.txt");
    expect(report.items).toContainEqual(
      expect.objectContaining({
        name: "network_policy",
        status: "blocked",
        detail: "generator exited with code 1: missing network evidence",
      }),
    );
  });
});

function configuredEnv(): Record<string, string> {
  return {
    SPLIT402_PHASE6_ASSEMBLE_IMAGE_PROVENANCE_RECORD:
      "evidence/phase6-image-provenance.txt",
    SPLIT402_PHASE6_ASSEMBLE_SIGNER_POLICY_RECORD:
      "evidence/phase6-signer-policy-review.txt",
    SPLIT402_PHASE6_ASSEMBLE_NETWORK_POLICY_RECORD:
      "evidence/phase6-network-policy-review.txt",
    SPLIT402_PHASE6_ASSEMBLE_SMOKE_CHECK_OUTPUT:
      "evidence/phase6-signer-smoke-review.txt",
    SPLIT402_PHASE6_ASSEMBLE_UNKNOWN_OUTCOME_RECONCILIATION_RECORD:
      "evidence/phase6-reconciliation-drill.txt",
    SPLIT402_PHASE6_ASSEMBLE_ROTATION_DRILL_RECORD:
      "evidence/phase6-rotation-drill.txt",
    SPLIT402_PHASE6_ASSEMBLE_EMERGENCY_REVOCATION_DRILL_RECORD:
      "evidence/phase6-emergency-revocation-drill.txt",
    SPLIT402_PHASE6_ASSEMBLE_KEY_CUSTODY_RECORD:
      "evidence/phase6-key-custody-review.txt",
    SPLIT402_PHASE6_ASSEMBLE_INCIDENT_DRILL_RECORD:
      "evidence/phase6-incident-drill.txt",
    SPLIT402_PHASE6_ASSEMBLE_ROLLBACK_DRILL_RECORD:
      "evidence/phase6-rollback-drill.txt",
    SPLIT402_PHASE6_ASSEMBLE_RPC_FAILOVER_RECORD:
      "evidence/phase6-rpc-failover-review.txt",
  };
}
