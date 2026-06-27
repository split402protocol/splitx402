# Phase 7 Staging Proof Runbook

Use this runbook to close the Phase 7 dashboard/discovery demo gate. The proof
must show that an agent can discover a Split402 route, pay the x402 API, verify
the Split402 receipt, and inspect referrer earnings without manual database
work.

For a repeatable local hosted-staging stack, start with
[`phase7-hosted-staging.md`](phase7-hosted-staging.md), then return to this
proof sequence.

## Commands

```bash
corepack pnpm phase7:staging:init
corepack pnpm phase7:staging-proof > phase7-staging-proof.txt
corepack pnpm phase7:hosted:preflight
corepack pnpm phase7:staging:collect-reads
corepack pnpm phase7:staging:collect-mcp-gateway
corepack pnpm dashboard
corepack pnpm demo:mcp-bundle
corepack pnpm demo:paid-suite
# Capture payout obligations with SPLIT402_FUNDING_BALANCE_PROVIDER=solana-rpc
# and attach covered/deficit funding evidence to funding_balance_evidence.
corepack pnpm phase7:staging:manifest phase7-staging-proof.txt > phase7-staging-evidence/artifact-manifest.json
corepack pnpm phase7:staging:assemble > phase7-staging-proof.txt
corepack pnpm phase7:staging:status phase7-staging-proof.txt
```

`phase7:staging:init` creates a `phase7-staging-evidence/` directory README and
`phase7-staging.env` attachment-path template. It does not create evidence
artifact files; those must be captured from the hosted staging run.
`phase7:staging:collect-reads` captures the control-plane read evidence for
referrer routes, referrer balances, dashboard summary, webhook delivery, payout
obligations, and funding-balance coverage using the staging merchant and
referrer environment variables.
`phase7:staging:collect-mcp-gateway` captures `mcp-gateway.jsonl` by sending
`initialize`, `tools/list`, and `split402.searchCapabilities` requests through
the MCP gateway. Set `SPLIT402_MCP_CONTROL_PLANE_URL` and, when needed,
`SPLIT402_MCP_CAPABILITY` so the transcript proves hosted route discovery.
`phase7:hosted:preflight` captures `hosted-preflight.json` with control-plane
health, dashboard health, dashboard session state, locked dashboard access
without a viewer token, and successful dashboard access with the viewer token
before the payment proof run.
`phase7:staging:manifest` records SHA-256 hashes for local attached artifacts
and remote references for URL-based artifacts. Generate it after the evidence
files exist and before the final assemble/status check.
The MCP gateway transcript is attached as `mcp_gateway_evidence`; it proves
hosted route discovery in addition to the stable `mcp-bundle.json` evidence.

The status report includes `gateStatuses`; each gate is marked `ready`,
`missing`, `placeholder`, `invalid`, or `not_checked` with blockers attached to
the evidence field that must be fixed. When a proof file path is supplied,
`artifactStatuses` also verifies that local `attached:` artifact paths exist
relative to the proof file directory, and `manifestStatus` verifies that local
artifact sizes and SHA-256 hashes still match `artifact-manifest.json`. Remote
`http(s)` artifact URLs are marked as remote references. `fundingBalanceStatus`
parses the local funding-balance artifact and rejects unresolved funding so the
proof shows whether each asset is covered or exactly how much is missing.

## Required Evidence

```mermaid
flowchart LR
  Preflight["Hosted preflight"]
  Discovery["Agent route discovery"]
  Payment["x402 paid request"]
  Receipt["Split402 receipt verification"]
  Earnings["Referrer balances and payouts"]
  Dashboard["Dashboard summary"]
  Webhooks["Webhook delivery feed"]
  Funding["Funding balance coverage"]
  Mcp["MCP gateway discovery"]
  Approval["Approved proof record"]

  Preflight --> Discovery
  Discovery --> Payment
  Payment --> Receipt
  Receipt --> Earnings
  Earnings --> Dashboard
  Dashboard --> Webhooks
  Webhooks --> Funding
  Funding --> Mcp
  Mcp --> Approval
```

Attach response captures or artifact paths for every field in
`docs/templates/phase7-staging-proof.txt`, or set the
`SPLIT402_PHASE7_ASSEMBLE_*` attachment variables and run
`corepack pnpm phase7:staging:assemble`. Leave `approval_decision` as `no-go`
until all attached evidence is from the same staging environment and source
commit. Include `artifact_manifest_evidence` from
`corepack pnpm phase7:staging:manifest`.

The validator requires:

- `proof_date` in `YYYY-MM-DD` format;
- `source_commit` as a 7-40 character git SHA;
- all URL fields as `http://` or `https://` URLs;
- every evidence field as either `attached: <artifact-path>` or an `http(s)`
  artifact URL.
- local `attached:` artifact paths must exist when
  `corepack pnpm phase7:staging:status <phase7-staging-proof.txt>` checks a
  proof file.
- `hosted_preflight_evidence` must be a local attached
  `hosted-preflight.json` artifact whose checks passed against the proof's
  control-plane and dashboard URLs.
- `funding_balance_evidence` must be a local attached
  `funding-balance.json` artifact containing a merchant obligation summary.
  Each asset must report `covered` with `fundingDeficitAtomic: "0"` or
  `deficit` with a positive `fundingDeficitAtomic`; `unknown` funding status
  does not close the gate.
- local `attached:` artifacts must match the generated artifact manifest when
  the manifest is also attached locally.
