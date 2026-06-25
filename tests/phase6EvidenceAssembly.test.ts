import { describe, expect, it } from "vitest";

import {
  assemblePhase6CustodyEvidenceBundle,
  parsePhase6Record,
} from "../src/phase6EvidenceAssembly.js";

const IMAGE_PROVENANCE = `review_id: phase6-image-review-001
review_date: 2026-06-26
reviewers: security, operations
source_commit: 42105be
signer_image_digest: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
control_plane_image_digest: sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
signer_image_build_command: docker build -f apps/payout-signer/Dockerfile -t image .
dependency_audit_output: attached: signer-image-audit.log
`;

const SIGNER_POLICY = `review_id: phase6-signer-policy-001
network: solana:devnet
funding_wallet: 8jYFQwU6P4L3uYJwqN4uJtVq4n5o7x8p9a1b2c3d4e5f
source_token_account: 7xYFQwU6P4L3uYJwqN4uJtVq4n5o7x8p9a1b2c3d4e5f
mint: usdc_mint
allowed_token_program_ids: TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
max_transaction_amount_atomic: 100000000
`;

describe("Phase 6 evidence assembly", () => {
  it("assembles bundle values from generated records and attachments", () => {
    const bundle = assemblePhase6CustodyEvidenceBundle({
      records: {
        imageProvenance: IMAGE_PROVENANCE,
        signerPolicy: SIGNER_POLICY,
      },
      attachments: {
        signer_policy_record: "evidence/signer-policy.txt",
        network_policy_record: "evidence/network-policy.txt",
        smoke_check_output: "evidence/signer-smoke.txt",
        rotation_drill_record: "evidence/rotation.txt",
        emergency_revocation_drill_record: "evidence/emergency.txt",
        key_custody_record: "evidence/key-custody.txt",
        incident_drill_record: "evidence/incident.txt",
        rollback_drill_record: "evidence/rollback.txt",
        rpc_failover_record: "evidence/rpc-failover.txt",
      },
      values: {
        review_id: "phase6-custody-001",
        staging_environment: "split402-staging",
        approval_notes: "human approval pending",
      },
    });

    expect(bundle).toContain("source_commit: 42105be\n");
    expect(bundle).toContain(
      "signer_policy_network: solana:devnet\n",
    );
    expect(bundle).toContain(
      "signer_policy_record: attached: evidence/signer-policy.txt\n",
    );
    expect(bundle).toContain("approval_decision: no-go\n");
  });

  it("lets explicit values override derived values", () => {
    const bundle = assemblePhase6CustodyEvidenceBundle({
      records: { signerPolicy: SIGNER_POLICY },
      values: { network: "solana:testnet" },
    });

    expect(bundle).toContain("network: solana:testnet\n");
    expect(bundle).toContain("signer_policy_network: solana:devnet\n");
  });

  it("parses simple generated record fields", () => {
    expect(parsePhase6Record("field_one: value\nignored\nfield_two: ok\n")).toEqual(
      new Map([
        ["field_one", "value"],
        ["field_two", "ok"],
      ]),
    );
  });
});
