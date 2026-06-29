import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  PRODUCT_LAUNCH_CHECKLIST_USAGE,
  PRODUCT_STATUS_USAGE,
  readSplit402ProductReadinessCliInput,
} from "../src/productReadinessCli.js";

describe("Split402 product readiness CLI parsing", () => {
  it("parses help and brief flags without treating help as an evidence path", () => {
    const input = readSplit402ProductReadinessCliInput([
      "--help",
      "--brief",
    ]);

    expect(input.help).toBe(true);
    expect(input.brief).toBe(true);
    expect(input.phase6EvidencePath).toBeUndefined();
    expect(input.phase7ProofPath).toBeUndefined();
    expect(input.report.launchDecision).toBe("no-go");
  });

  it("rejects unknown readiness CLI options", () => {
    expect(() =>
      readSplit402ProductReadinessCliInput(["--brieff"], PRODUCT_STATUS_USAGE),
    ).toThrowErrorMatchingInlineSnapshot(`
      [Error: Usage: corepack pnpm product:status [--brief] [--workspace directory] [phase6-custody-evidence.txt] [phase7-staging-proof.txt]
      Unknown option: --brieff]
    `);
  });

  it("reads default evidence files from a launch workspace", () => {
    const directory = mkdtempSync(join(tmpdir(), "split402-readiness-"));
    writeFileSync(
      join(directory, "local-public-alpha-proof.json"),
      JSON.stringify({
        schema: "split402.local_public_alpha_proof.v1",
        status: "passed",
        launchApproval: "not_approved",
        generatedAt: "2026-06-29T20:00:00.000Z",
        checks: [
          { id: "repo_hygiene", status: "passed" },
          { id: "public_surface", status: "passed" },
          { id: "protocol_vectors", status: "passed" },
          { id: "router_alpha", status: "passed" },
          { id: "mcp_gateway_smoke", status: "passed" },
        ],
        notes: [],
      }),
    );
    writeFileSync(
      join(directory, "phase6-custody-evidence.txt"),
      "review_id: pending\napproval_decision: no-go\n",
    );
    writeFileSync(
      join(directory, "phase7-staging-proof.txt"),
      [
        "proof_id: pending",
        "approval_decision: no-go",
        "proof_date: 2026-06-29",
        "source_commit: 21113e7",
        "control_plane_url: https://control.example",
        "dashboard_url: https://dashboard.example",
        "demo_merchant_url: https://merchant.example",
        "hosted_preflight_evidence: attached: hosted-preflight.json",
        "agent_discovery_evidence: attached: agent-discovery.json",
        "paid_request_evidence: attached: paid-suite.log",
        "receipt_verification_evidence: attached: receipt-verification.json",
        "referrer_balance_evidence: attached: referrer-balance.json",
        "dashboard_summary_evidence: attached: dashboard-summary.json",
        "webhook_delivery_evidence: attached: webhook-delivery.json",
        "payout_obligation_evidence: attached: payout-obligation.json",
        "funding_balance_evidence: attached: funding-balance.json",
        "mcp_bundle_evidence: attached: mcp-bundle.json",
        "mcp_gateway_evidence: attached: mcp-gateway.jsonl",
        "artifact_manifest_evidence: attached: artifact-manifest.json",
        "commands_run: attached: commands.log",
        "approval_notes: checked evidence is intentionally incomplete",
        "",
      ].join("\n"),
    );

    const input = readSplit402ProductReadinessCliInput([
      "--brief",
      "--workspace",
      directory,
    ]);

    expect(input.brief).toBe(true);
    expect(input.workspaceDirectory).toBe(directory);
    expect(input.phase6EvidencePath).toBe(
      join(directory, "phase6-custody-evidence.txt"),
    );
    expect(input.localProofPath).toBe(
      join(directory, "local-public-alpha-proof.json"),
    );
    expect(input.report.localProof.ready).toBe(true);
    expect(input.phase7ProofPath).toBe(
      join(directory, "phase7-staging-proof.txt"),
    );
    expect(input.report.phase6.evidenceBundleChecked).toBe(true);
    expect(input.report.phase7.proofChecked).toBe(true);
    expect(input.report.launchDecision).toBe("no-go");
  });

  it("treats a missing local proof artifact as not checked", () => {
    const directory = mkdtempSync(join(tmpdir(), "split402-readiness-"));

    const input = readSplit402ProductReadinessCliInput([
      "--workspace",
      directory,
    ]);

    expect(input.localProofPath).toBe(
      join(directory, "local-public-alpha-proof.json"),
    );
    expect(input.report.localProof.checked).toBe(false);
  });

  it("rejects workspace mode mixed with explicit evidence paths", () => {
    expect(() =>
      readSplit402ProductReadinessCliInput([
        "--workspace=split402-launch-evidence",
        "phase6-custody-evidence.txt",
      ]),
    ).toThrowErrorMatchingInlineSnapshot(`
      [Error: Usage: corepack pnpm product:status [--brief] [--workspace directory] [phase6-custody-evidence.txt] [phase7-staging-proof.txt]
      Do not pass evidence file paths with --workspace.]
    `);
  });

  it("uses caller-specific usage text", () => {
    expect(() =>
      readSplit402ProductReadinessCliInput(
        ["one", "two", "three"],
        PRODUCT_LAUNCH_CHECKLIST_USAGE,
      ),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: Usage: corepack pnpm product:launch-checklist [--brief] [--workspace directory] [phase6-custody-evidence.txt] [phase7-staging-proof.txt]]`,
    );
  });
});
