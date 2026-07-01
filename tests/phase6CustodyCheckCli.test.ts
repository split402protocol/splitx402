import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

describe("Phase 6 custody check CLI", () => {
  it("fails approved custody evidence when an attached artifact is missing", () => {
    const directory = mkdtempSync(join(tmpdir(), "split402-phase6-check-"));
    const evidencePath = join(directory, "phase6-custody-evidence.txt");
    writeFileSync(evidencePath, createApprovedEvidence(readCurrentGitCommit()));
    writeFileSync(join(directory, "signer-image-audit-001.log"), "audit ok\n");

    const error = runCustodyCheckExpectingFailure(evidencePath);
    const report = JSON.parse(error.stdout.toString("utf8")) as {
      readyForCustody: boolean;
      attachmentStatus: {
        status: string;
        missingArtifacts: string[];
      };
    };

    expect(report.readyForCustody).toBe(false);
    expect(report.attachmentStatus.status).toBe("invalid");
    expect(report.attachmentStatus.missingArtifacts).toContain(
      join(directory, "key-custody-review-001.md"),
    );
  });

  it("passes approved custody evidence only when every attached artifact exists", () => {
    const directory = mkdtempSync(join(tmpdir(), "split402-phase6-check-"));
    const evidencePath = join(directory, "phase6-custody-evidence.txt");
    writeFileSync(evidencePath, createApprovedEvidence(readCurrentGitCommit()));
    for (const artifact of ATTACHED_ARTIFACTS) {
      const artifactPath = join(directory, artifact);
      mkdirSync(dirname(artifactPath), { recursive: true });
      writeFileSync(artifactPath, "evidence ok\n");
    }

    const stdout = execFileSync(
      process.execPath,
      [TSX_CLI, "src/phase6-custody-check.ts", evidencePath],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const report = JSON.parse(stdout) as {
      readyForCustody: boolean;
      attachmentStatus: {
        status: string;
      };
    };

    expect(report.readyForCustody).toBe(true);
    expect(report.attachmentStatus.status).toBe("valid");
  });
});

const ATTACHED_ARTIFACTS = [
  "signer-image-audit-001.log",
  "network-policy-001.yaml",
  "signer-policy-review-001.md",
  "smoke-check-001.log",
  "reconciliation-drill-001.md",
  "rotation-drill-001.md",
  "emergency-revocation-drill-001.md",
  "key-custody-review-001.md",
  "incident-drill-001.md",
  "rollback-drill-001.md",
  "rpc-failover-001.md",
] as const;

const TSX_CLI = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");

function createApprovedEvidence(sourceCommit: string): string {
  return `review_id: phase6-review-001
review_date: 2026-06-25
reviewers: security, operations, protocol
source_commit: ${sourceCommit}
signer_image_digest: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
signer_image_build_command: docker build -f apps/payout-signer/Dockerfile -t ghcr.io/split402protocol/splitx402/payout-signer@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa .
signer_image_dependency_audit_output: attached: signer-image-audit-001.log
control_plane_image_digest: sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
staging_environment: split402-staging
funding_wallet: funding-wallet
network: solana:devnet
network_policy_record: attached: network-policy-001.yaml
signer_policy_record: attached: signer-policy-review-001.md
signer_policy_network: solana:devnet
signer_policy_funding_wallet: funding-wallet
signer_policy_source_token_account: source-token-account
signer_policy_mint: usdc_mint
signer_policy_allowed_token_program_ids: token-program
signer_policy_max_transaction_amount_atomic: 100000000
smoke_check_output: attached: smoke-check-001.log
unknown_outcome_reconciliation_record: attached: reconciliation-drill-001.md
rotation_drill_record: attached: rotation-drill-001.md
emergency_revocation_drill_record: attached: emergency-revocation-drill-001.md
key_custody_record: attached: key-custody-review-001.md
incident_drill_record: attached: incident-drill-001.md
rollback_drill_record: attached: rollback-drill-001.md
rpc_failover_record: attached: rpc-failover-001.md
approval_decision: approved
approval_notes: approved for staged production custody only
`;
}

function readCurrentGitCommit(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function runCustodyCheckExpectingFailure(evidencePath: string): {
  stdout: Buffer;
} {
  try {
    execFileSync(
      process.execPath,
      [TSX_CLI, "src/phase6-custody-check.ts", evidencePath],
      {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch (error) {
    return error as { stdout: Buffer };
  }
  throw new Error("Expected Phase 6 custody check to fail");
}
