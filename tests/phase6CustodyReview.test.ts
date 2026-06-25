import { describe, expect, it } from "vitest";

import { validatePhase6CustodyEvidence } from "../src/phase6CustodyReview.js";

const VALID_EVIDENCE = `review_id: phase6-review-001
review_date: 2026-06-25
reviewers: security, operations, protocol
source_commit: f932ddb
signer_image_digest: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
control_plane_image_digest: sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
staging_environment: split402-staging
funding_wallet: 8jYFQwU6P4L3uYJwqN4uJtVq4n5o7x8p9a1b2c3d4e5f
network: solana:devnet
network_policy_record: attached: network-policy-001.yaml
signer_policy_record: attached: signer-policy-review-001.md
signer_policy_network: solana:devnet
signer_policy_funding_wallet: 8jYFQwU6P4L3uYJwqN4uJtVq4n5o7x8p9a1b2c3d4e5f
signer_policy_source_token_account: 7xYFQwU6P4L3uYJwqN4uJtVq4n5o7x8p9a1b2c3d4e5f
signer_policy_mint: usdc_mint
signer_policy_allowed_token_program_ids: TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
signer_policy_max_transaction_amount_atomic: 100000000
smoke_check_output: attached: smoke-check-001.log
rotation_drill_record: attached: rotation-drill-001.md
incident_drill_record: attached: incident-drill-001.md
rpc_failover_record: attached: rpc-failover-001.md
approval_decision: approved
approval_notes: approved for staged production custody only
`;

describe("Phase 6 custody review validation", () => {
  it("approves a complete evidence bundle", () => {
    expect(validatePhase6CustodyEvidence(VALID_EVIDENCE)).toEqual({
      approved: true,
      missingFields: [],
      placeholderFields: [],
      invalidFields: [],
    });
  });

  it("rejects missing and placeholder evidence fields", () => {
    const result = validatePhase6CustodyEvidence(`review_id: pending
approval_decision: no-go
`);

    expect(result.approved).toBe(false);
    expect(result.missingFields).toContain("review_date");
    expect(result.placeholderFields).toContain("review_id");
    expect(result.invalidFields).toContain(
      "approval_decision must be approved before Phase 6 custody can go live",
    );
  });

  it("rejects mutable image tags and non-SHA source commits", () => {
    const result = validatePhase6CustodyEvidence(
      VALID_EVIDENCE.replace("source_commit: f932ddb", "source_commit: main")
        .replace(
          "signer_image_digest: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "signer_image_digest: latest",
        ),
    );

    expect(result.approved).toBe(false);
    expect(result.invalidFields).toEqual(
      expect.arrayContaining([
        "source_commit must be a git SHA",
        "signer_image_digest must be an immutable sha256 digest",
      ]),
    );
  });

  it("rejects malformed signer policy evidence", () => {
    const result = validatePhase6CustodyEvidence(
      VALID_EVIDENCE.replace(
        "signer_policy_network: solana:devnet",
        "signer_policy_network: eip155:8453",
      )
        .replace(
          "signer_policy_allowed_token_program_ids: TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
          "signer_policy_allowed_token_program_ids: ,",
        )
        .replace(
          "signer_policy_max_transaction_amount_atomic: 100000000",
          "signer_policy_max_transaction_amount_atomic: 1.5",
        ),
    );

    expect(result.approved).toBe(false);
    expect(result.invalidFields).toEqual(
      expect.arrayContaining([
        "signer_policy_network must start with solana:",
        "signer_policy_allowed_token_program_ids must include at least one token program",
        "signer_policy_max_transaction_amount_atomic must be a positive atomic amount",
      ]),
    );
  });
});
