import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  createMainnetCanaryDryRunEvidenceTemplate,
  createMainnetCanaryRollbackPlanTemplate,
  verifyMainnetCanaryEvidenceAttachment,
} from "../src/mainnetCanaryEvidence.js";

describe("mainnet canary evidence attachments", () => {
  it("accepts reviewed dry-run and rollback artifacts from the evidence workspace", () => {
    const directory = mkdtempSync(join(tmpdir(), "split402-canary-evidence-"));
    try {
      writeFileSync(
        join(directory, "dry-run.txt"),
        createPassingDryRunEvidence(),
      );
      writeFileSync(
        join(directory, "rollback.txt"),
        createPassingRollbackPlan(),
      );

      expect(
        verifyMainnetCanaryEvidenceAttachment({
          kind: "dry_run",
          value: "attached: dry-run.txt",
          workspaceDirectory: directory,
        }),
      ).toMatchObject({ ok: true, errors: [] });
      expect(
        verifyMainnetCanaryEvidenceAttachment({
          kind: "rollback_plan",
          value: "attached: rollback.txt",
          workspaceDirectory: directory,
        }),
      ).toMatchObject({ ok: true, errors: [] });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects missing or placeholder attachment references", () => {
    expect(
      verifyMainnetCanaryEvidenceAttachment({
        kind: "dry_run",
        value: "attached: <dry-run evidence>",
      }),
    ).toMatchObject({
      ok: false,
      errors: [
        "evidence must use `attached: <path>` and must not contain a placeholder",
      ],
    });

    expect(
      verifyMainnetCanaryEvidenceAttachment({
        kind: "rollback_plan",
        value: "attached: missing.txt",
        workspaceDirectory: "split402-launch-evidence",
        exists: () => false,
      }),
    ).toMatchObject({
      ok: false,
      errors: [
        `attached evidence file does not exist: ${join("split402-launch-evidence", "missing.txt")}`,
      ],
    });
  });

  it("rejects scaffold dry-run artifacts until every required result is passed", () => {
    const result = verifyMainnetCanaryEvidenceAttachment({
      kind: "dry_run",
      value: "attached: dry-run.txt",
      exists: () => true,
      readText: () =>
        createMainnetCanaryDryRunEvidenceTemplate({
          sourceCommit: "abc1234",
          reviewDate: "2026-06-30",
        }),
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("merchant_id must be filled");
    expect(result.errors).toContain("dry_run_status must be passed");
    expect(result.errors).toContain("reviewer must be filled");
  });

  it("rejects rollback plans without stop-condition approval", () => {
    const result = verifyMainnetCanaryEvidenceAttachment({
      kind: "rollback_plan",
      value: "attached: rollback.txt",
      exists: () => true,
      readText: () =>
        createMainnetCanaryRollbackPlanTemplate({
          sourceCommit: "abc1234",
          reviewDate: "2026-06-30",
        })
          .replace("merchant_id:", "merchant_id: mrc_1")
          .replace("campaign_id:", "campaign_id: cmp_1")
          .replace("route_id:", "route_id: rte_1")
          .replace("payer_wallet:", "payer_wallet: payer")
          .replace("stop_loss_amount_atomic:", "stop_loss_amount_atomic: 100000")
          .replace("rollback_owner:", "rollback_owner: Split402 ops")
          .replace("rollback_steps:", "rollback_steps: disable route and stop payouts")
          .replace("reconciliation_owner:", "reconciliation_owner: Split402 ops")
          .replace("reviewer:", "reviewer: reviewer"),
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("stop_conditions_reviewed must be yes");
  });

  it("rejects artifacts that exceed the canary amount cap", () => {
    const result = verifyMainnetCanaryEvidenceAttachment({
      kind: "dry_run",
      value: "attached: dry-run.txt",
      exists: () => true,
      readText: () =>
        createPassingDryRunEvidence().replace(
          "max_gross_amount_atomic: 100000",
          "max_gross_amount_atomic: 100001",
        ),
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("max_gross_amount_atomic must be <= 100000");
  });

  it("rejects malformed review dates and source commits", () => {
    const result = verifyMainnetCanaryEvidenceAttachment({
      kind: "dry_run",
      value: "attached: dry-run.txt",
      exists: () => true,
      readText: () =>
        createPassingDryRunEvidence()
          .replace("review_date: 2026-06-30", "review_date: 2026-02-30")
          .replace("source_commit: abc1234", "source_commit: not-a-sha"),
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "review_date must be a valid YYYY-MM-DD calendar date",
    );
    expect(result.errors).toContain("source_commit must be a git SHA");
  });

  it("rejects evidence that does not match the approved canary scope", () => {
    const result = verifyMainnetCanaryEvidenceAttachment({
      expectedScope: {
        merchantId: "mrc_expected",
        campaignId: "cmp_expected",
        routeId: "rte_expected",
        payerWallet: "payer_expected",
        maxGrossAmountAtomic: "50000",
      },
      kind: "dry_run",
      value: "attached: dry-run.txt",
      exists: () => true,
      readText: () => createPassingDryRunEvidence(),
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "merchant_id must match approved canary scope",
        "campaign_id must match approved canary scope",
        "route_id must match approved canary scope",
        "payer_wallet must match approved canary scope",
        "max_gross_amount_atomic must match approved canary scope",
      ]),
    );
  });

  it("rejects evidence from a different source commit than the approved launch scope", () => {
    const result = verifyMainnetCanaryEvidenceAttachment({
      expectedScope: {
        sourceCommit: "def5678000000000000000000000000000000000",
      },
      kind: "dry_run",
      value: "attached: dry-run.txt",
      exists: () => true,
      readText: () => createPassingDryRunEvidence(),
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "source_commit must match approved canary scope",
    );
  });

  it("accepts short source commits when they match the approved launch scope", () => {
    const result = verifyMainnetCanaryEvidenceAttachment({
      expectedScope: {
        sourceCommit: "abc1234000000000000000000000000000000000",
      },
      kind: "rollback_plan",
      value: "attached: rollback.txt",
      exists: () => true,
      readText: () => createPassingRollbackPlan(),
    });

    expect(result).toMatchObject({ ok: true, errors: [] });
  });
});

function createPassingDryRunEvidence(): string {
  return createMainnetCanaryDryRunEvidenceTemplate({
    sourceCommit: "abc1234",
    reviewDate: "2026-06-30",
  })
    .replace("merchant_id:", "merchant_id: mrc_1")
    .replace("campaign_id:", "campaign_id: cmp_1")
    .replace("route_id:", "route_id: rte_1")
    .replace("payer_wallet:", "payer_wallet: payer")
    .replace("dry_run_status: pending", "dry_run_status: passed")
    .replace("receipt_verification: pending", "receipt_verification: passed")
    .replace(
      "economic_policy_verification: pending",
      "economic_policy_verification: passed",
    )
    .replace("chain_verification: pending", "chain_verification: passed")
    .replace("payout_dry_run: pending", "payout_dry_run: passed")
    .replace(
      "signer_byte_verification: pending",
      "signer_byte_verification: passed",
    )
    .replace("reviewer:", "reviewer: reviewer");
}

function createPassingRollbackPlan(): string {
  return createMainnetCanaryRollbackPlanTemplate({
    sourceCommit: "abc1234",
    reviewDate: "2026-06-30",
  })
    .replace("merchant_id:", "merchant_id: mrc_1")
    .replace("campaign_id:", "campaign_id: cmp_1")
    .replace("route_id:", "route_id: rte_1")
    .replace("payer_wallet:", "payer_wallet: payer")
    .replace("stop_loss_amount_atomic:", "stop_loss_amount_atomic: 100000")
    .replace("rollback_owner:", "rollback_owner: Split402 ops")
    .replace("rollback_steps:", "rollback_steps: disable route and stop payouts")
    .replace("stop_conditions_reviewed: no", "stop_conditions_reviewed: yes")
    .replace("reconciliation_owner:", "reconciliation_owner: Split402 ops")
    .replace("reviewer:", "reviewer: reviewer");
}
