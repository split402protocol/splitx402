import { describe, expect, it } from "vitest";

import {
  PHASE6_EVIDENCE_COMMANDS,
  createPhase6EvidenceStatusReport,
  formatPhase6EvidenceStatusBrief,
} from "../src/phase6EvidenceStatus.js";

describe("Phase 6 evidence status", () => {
  it("lists the operator evidence commands before a bundle exists", () => {
    const report = createPhase6EvidenceStatusReport();

    expect(report).toMatchObject({
      schema: "split402.phase6_evidence_status.v1",
      readyForCustody: false,
      evidenceBundleChecked: false,
    });
    expect(report.commands).toBe(PHASE6_EVIDENCE_COMMANDS);
    expect(report.commands[0]?.command).toBe(
      "corepack pnpm phase6:evidence:bundle",
    );
    expect(report.commands.map((item) => item.command)).toContain(
      "corepack pnpm phase6:evidence:assemble",
    );
    expect(report.commands.map((item) => item.command)).toContain(
      "corepack pnpm phase6:evidence:env-template split402-launch-evidence split402-launch-evidence/phase6-evidence.env",
    );
    expect(report.commands.map((item) => item.command)).toContain(
      "corepack pnpm phase6:network-policy",
    );
    expect(report.commands.map((item) => item.command)).toContain(
      "corepack pnpm phase6:incident-drill",
    );
    expect(report.commands.map((item) => item.command)).toContain(
      "corepack pnpm phase6:reconciliation-drill",
    );
    expect(report.commands.map((item) => item.command)).toContain(
      "corepack pnpm signer:payout:smoke && corepack pnpm phase6:signer-smoke",
    );
    expect(report.commands.map((item) => item.command)).toContain(
      "corepack pnpm payout:finality:failover-drill && corepack pnpm phase6:rpc-failover",
    );
    expect(report.nextActions).toContain(
      "Generate a bundle scaffold with corepack pnpm phase6:evidence:bundle.",
    );
    expect(report.nextActions).toContain(
      "Review generated split402-launch-evidence/phase6-evidence.env before editing; regenerate only if missing with corepack pnpm phase6:evidence:env-template split402-launch-evidence split402-launch-evidence/phase6-evidence.env.",
    );
  });

  it("reports blockers from an incomplete evidence bundle", () => {
    const report = createPhase6EvidenceStatusReport(`review_id: pending
approval_decision: no-go
`);

    expect(report.readyForCustody).toBe(false);
    expect(report.evidenceBundleChecked).toBe(true);
    expect(report.sourceCommitStatus.status).toBe("not_applicable");
    expect(report.validation?.missingFields).toContain("review_date");
    expect(report.validation?.placeholderFields).toContain("review_id");
    expect(report.validation?.invalidFields).toContain(
      "approval_decision must be approved before Phase 6 custody can go live",
    );
    expect(report.nextActions[0]).toBe(
      "Run corepack pnpm product:launch-preflight --brief --workspace split402-launch-evidence for grouped env/setup blockers before collecting or recollecting evidence.",
    );
    expect(report.nextActions.join("\n")).toContain(
      "Fill direct Phase 6 custody review fields in split402-launch-evidence/phase6-evidence.env",
    );
    expect(report.nextActions.join("\n")).toContain(
      "Generate image provenance with corepack pnpm phase6:image-provenance",
    );
    expect(report.nextActions.join("\n")).toContain(
      "Generate signer policy evidence with corepack pnpm phase6:signer-policy",
    );
    expect(report.nextActions.join("\n")).toContain(
      "Generate custody drill evidence",
    );
    expect(report.nextActions.join("\n")).toContain(
      "Keep approval_decision=no-go until all Phase 6 custody evidence fields and reviews are complete",
    );
    expect(report.nextActions.join("\n")).toContain(
      "Reassemble with corepack pnpm phase6:evidence:assemble",
    );
    expect(report.nextActions.join("\n")).not.toContain("Fill missing fields:");
    expect(report.nextActions.join("\n")).not.toContain(
      "Replace placeholder fields: approval_decision",
    );
    const brief = formatPhase6EvidenceStatusBrief(report);
    expect(brief).toContain("Phase 6 custody evidence: checked, blocked");
    expect(brief).toContain("Launch posture: production custody remains no-go");
    expect(brief).toContain("Missing fields:");
    expect(brief).toContain(
      "Keep approval_decision=no-go until all Phase 6 custody evidence fields and reviews are complete",
    );
  });

  it("validates Phase 6 evidence source_commit against the current checkout", () => {
    const report = createPhase6EvidenceStatusReport(
      `review_id: pending
source_commit: abc1234
approval_decision: no-go
`,
      {
        currentSourceCommit: "abc1234000000000000000000000000000000000",
      },
    );

    expect(report.sourceCommitStatus).toEqual({
      status: "valid",
      evidenceSourceCommit: "abc1234",
      currentSourceCommit: "abc1234000000000000000000000000000000000",
      blockers: [],
    });
  });

  it("blocks Phase 6 evidence from a stale checkout", () => {
    const report = createPhase6EvidenceStatusReport(
      `review_id: pending
source_commit: abc1234
approval_decision: no-go
`,
      {
        currentSourceCommit: "def5678000000000000000000000000000000000",
      },
    );

    expect(report.sourceCommitStatus).toEqual({
      status: "invalid",
      evidenceSourceCommit: "abc1234",
      currentSourceCommit: "def5678000000000000000000000000000000000",
      blockers: ["source_commit does not match current checkout"],
    });
    expect(report.nextActions).toContain(
      "Run corepack pnpm product:launch-preflight --brief --workspace split402-launch-evidence for grouped env/setup blockers before collecting or recollecting evidence.",
    );
    expect(report.nextActions).toContain(
      "source_commit does not match current checkout",
    );
  });

  it("checks approved Phase 6 attached artifacts from the evidence bundle directory", () => {
    const report = createPhase6EvidenceStatusReport(APPROVED_EVIDENCE, {
      artifactBaseDir: "split402-launch-evidence",
      artifactExists: () => true,
      currentSourceCommit: "f932ddb000000000000000000000000000000000",
      resolveArtifactPath: (artifactPath, baseDir) => `${baseDir}/${artifactPath}`,
    });

    expect(report.readyForCustody).toBe(true);
    expect(report.attachmentStatus).toMatchObject({
      status: "valid",
      missingArtifacts: [],
    });
    expect(report.attachmentStatus.checkedArtifacts).toContain(
      "split402-launch-evidence/signer-image-audit-001.log",
    );
  });

  it("blocks approved Phase 6 custody evidence when attached artifacts are missing", () => {
    const report = createPhase6EvidenceStatusReport(APPROVED_EVIDENCE, {
      artifactBaseDir: "split402-launch-evidence",
      artifactExists: (path) =>
        path !== "split402-launch-evidence/key-custody-review-001.md",
      currentSourceCommit: "f932ddb000000000000000000000000000000000",
      resolveArtifactPath: (artifactPath, baseDir) => `${baseDir}/${artifactPath}`,
    });

    expect(report.readyForCustody).toBe(false);
    expect(report.attachmentStatus).toMatchObject({
      status: "invalid",
      missingArtifacts: [
        "split402-launch-evidence/key-custody-review-001.md",
      ],
      blockers: [
        "Phase 6 attached artifact is missing: split402-launch-evidence/key-custody-review-001.md",
      ],
    });
    expect(report.nextActions).toContain(
      "Phase 6 attached artifact is missing: split402-launch-evidence/key-custody-review-001.md",
    );
    expect(formatPhase6EvidenceStatusBrief(report)).toContain(
      "Attached artifacts: invalid",
    );
  });
});

const APPROVED_EVIDENCE = `review_id: phase6-review-001
review_date: 2026-06-25
reviewers: security, operations, protocol
source_commit: f932ddb
signer_image_digest: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
signer_image_build_command: docker build -f apps/payout-signer/Dockerfile -t ghcr.io/split402protocol/splitx402/payout-signer@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa .
signer_image_dependency_audit_output: attached: signer-image-audit-001.log
control_plane_image_digest: sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
staging_environment: split402-staging
funding_wallet: 8jYFQwU6P4L3uYJwqN4uJtVq4n5o7x8p9a1b2c3d4e5f
network: solana:devnet
network_policy_record: attached: network-policy-001.yaml
signer_policy_record: attached: signer-policy-review-001.md
signer_policy_network: solana:devnet
signer_policy_funding_wallet: 8jYFQwU6P4L3uYJwqN4uJtVq4n5o7x8p9a1b2c3d4e5f
signer_policy_source_token_account: source-token-account
signer_policy_mint: usdc_mint
signer_policy_allowed_token_program_ids: TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
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
