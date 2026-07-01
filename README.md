# Split402

[![CI](https://github.com/split402protocol/splitx402/actions/workflows/ci.yml/badge.svg)](https://github.com/split402protocol/splitx402/actions/workflows/ci.yml)
[![CodeQL](https://github.com/split402protocol/splitx402/actions/workflows/codeql.yml/badge.svg)](https://github.com/split402protocol/splitx402/actions/workflows/codeql.yml)
[![Secret Scan](https://github.com/split402protocol/splitx402/actions/workflows/secret-scan.yml/badge.svg)](https://github.com/split402protocol/splitx402/actions/workflows/secret-scan.yml)
![Status](https://img.shields.io/badge/status-public_alpha-orange)
![Runtime](https://img.shields.io/badge/node-%3E%3D22-339933)
![Protocol](https://img.shields.io/badge/x402-USDC-blue)
![License](https://img.shields.io/badge/license-Apache--2.0-blue)

> Referral, attribution, commission accounting, and payout infrastructure for
> x402-paid APIs and agent tools.

Split402 lets an agent pay a merchant through a normal x402 USDC flow and attach
a signed referral claim to that paid request. If the merchant campaign says the
referral earns 10 percent, Split402 records that commission as a payable to the
referrer's payout wallet, verifies the underlying settlement, and later moves
eligible commissions into merchant-funded payout batches. Campaigns may also set
a protocol fee as a percentage of the referral commission, not as a percentage of
the gross buyer payment.

The important money model is simple:

- The buyer or agent pays the merchant through standard x402 settlement.
- The merchant receives the gross x402 payment.
- Split402 records a signed receipt, attribution evidence, and commission
  liability.
- A later payout worker pays accumulated USDC commissions from a
  merchant-controlled funding wallet.

Split402 is the protocol and product name. This repository,
`split402protocol/splitx402`, is the canonical public implementation repository.
The canonical protocol scope is captured in the
[Split402 protocol architecture v0.1 spec](docs/reference/split402_protocol_architecture_v0.1.md).

This public repository is the open protocol foundation, not the full production
business machine. Production router operations, hosted control-plane
configuration, commercial provider registries, payout custody operations, and
real staging/mainnet evidence belong in private Split402 infrastructure. See
[Public and private boundary](docs/PUBLIC_PRIVATE_BOUNDARY.md).

## Protocol In One Picture

```mermaid
flowchart LR
  Agent["Buyer agent"]
  Merchant["x402 merchant API"]
  Facilitator["x402 facilitator"]
  Chain["Solana USDC settlement"]
  Receipt["Signed Split402 receipt"]
  Control["Split402 control plane"]
  Ledger["Commission ledger"]
  Payout["Merchant-funded payout batch"]
  Referrer["Referrer payout wallet"]

  Agent -->|"1. Calls paid API"| Merchant
  Merchant -->|"2. 402 challenge + Split402 offer"| Agent
  Agent -->|"3. x402 payment + signed referral claim"| Merchant
  Merchant -->|"4. Verify and settle x402 payment"| Facilitator
  Facilitator --> Chain
  Merchant -->|"5. Return paid response + receipt"| Agent
  Merchant -->|"6. Submit receipt"| Control
  Control -->|"7. Verify, dedupe, accrue"| Ledger
  Ledger -->|"8. Allocate eligible accruals"| Payout
  Payout -->|"9. Pay USDC commission later"| Referrer
```

## What Split402 Does Today

| Capability | Current implementation |
| --- | --- |
| x402-compatible paid API flow | Implemented through the x402 extension, Express adapter, demo merchant, and agent SDK. |
| Signed referral claims | Implemented in `@split402/protocol` and carried through x402 extension metadata. |
| Signed merchant offers and receipts | Implemented with Ed25519 service keys and offline verification helpers. |
| Idempotent receipt ingestion | Implemented in the control plane with receipt, payment, settlement, and hash conflict checks. |
| Commission ledger | Implemented as zero-sum accounting rows for merchant liability, referrer payable, and protocol fee payable. |
| Chain verification | Implemented as an outbox-driven Solana JSON-RPC worker for settlement signature and transfer checks. |
| Webhooks | Implemented for accepted-receipt and payout lifecycle events with signed delivery envelopes and retry/dead-letter handling. |
| Merchant SDK reliability boundary | Implemented with cached campaign lookup, service-key rotation helpers, payment identifiers, operation digests, and merchant-local receipt outbox primitives. |
| Capability router | Implemented public-alpha router with static providers, control-plane route discovery, budget filtering, deterministic ranking, fallback, pay-to wallet checks, and fail-closed receipt verification. |
| Dashboard and discovery | Implemented for public-alpha operations: reliability profiles, dashboard summaries, webhook feeds, referrer routes, balances, payouts, hosted-staging viewer sessions, and proof capture. |
| Payout engine | In progress: preview, allocation, safe allocation release, Solana transfer planning, simulation, signer policy, local-dev signer, remote signer client, signer appliance scaffold, signer deployment artifacts, signed-byte persistence, broadcast boundary, finality monitor, rollup, payout lifecycle events, unknown-outcome reconciliation queue, referrer payout views, and idempotent ledger closure are implemented. |
| Atomic split settlement | Later research. The MVP does not split the original x402 transaction onchain. |
| `$SPLIT` bonding | Later research after the USDC accrual-and-payout loop clears public-alpha proof and custody gates. |

## Commission Example

```mermaid
flowchart LR
  Pay["Agent pays 1.00 USDC"]
  Gross["x402 settles 1.00 USDC to merchant"]
  Terms["Campaign commission: 2000 bps"]
  Fee["Protocol fee: 1000 bps of commission"]
  Liability["Split402 records 0.18 USDC referrer payable"]
  ProtocolFee["Split402 records 0.02 USDC protocol payable"]
  Verify["Chain verification marks accrual available"]
  Batch["Payout batch sends 0.18 USDC later"]

  Pay --> Gross
  Gross --> Terms
  Terms --> Fee
  Fee --> Liability
  Fee --> ProtocolFee
  Liability --> Verify
  Verify --> Batch
```

| Item | Value |
| --- | --- |
| API price | `1.00 USDC` |
| x402 settlement | `1.00 USDC` paid to the merchant |
| Campaign commission | `2000` bps, equal to `0.20 USDC` |
| Protocol fee | `1000` bps of commission, equal to `0.02 USDC` |
| Split402 accrual | `0.18 USDC` owed to the referrer |
| Payout source | Merchant-controlled USDC payout wallet |
| Payout timing | Later, after verification, eligibility, allocation, and finality checks |

This is why Split402 is different from an atomic onchain splitter today: it does
not redirect part of the buyer's x402 payment in the MVP. It makes the referral
commission auditable, idempotent, and payable after settlement.

Self-referral policy is evaluated against the settled payer and, where known, the
merchant owner. A referrer may use the same wallet for identity and payout; that
alone is not treated as self-referral.

## End-To-End Sequence

```mermaid
sequenceDiagram
  participant A as Agent
  participant M as Merchant API
  participant X as x402 facilitator
  participant S as Solana
  participant C as Split402 control plane
  participant W as Workers
  participant R as Referrer wallet

  A->>M: Request paid resource
  M-->>A: 402 Payment Required with signed Split402 offer
  A->>A: Verify offer and sign referral claim
  A->>M: Retry with x402 payment and referral claim
  M->>M: Validate attribution and operation digest
  M->>X: Verify and settle x402 payment
  X->>S: Submit USDC settlement
  S-->>X: Settlement confirmation
  X-->>M: Settlement accepted
  M->>M: Sign Split402 receipt
  M-->>A: Paid response plus receipt
  M->>C: Submit receipt
  C->>C: Verify key, dedupe, create accrual and ledger rows
  C->>W: Durable receipt and webhook outbox events
  W->>S: Verify settlement evidence
  W->>C: Mark accrual available
  C->>C: Allocate available accruals into payout batch
  W->>S: Broadcast merchant-funded payout transaction
  S-->>W: Finalized payout
  W->>C: Close payout ledger exactly once and enqueue payout finalized events
  W->>R: Referrer receives USDC
```

## Repository Map

```mermaid
flowchart TB
  Protocol["@split402/protocol"]
  Vectors["@split402/test-vectors"]
  Extension["@split402/x402-extension"]
  Express["@split402/express"]
  Agent["@split402/agent-sdk"]
  Router["@split402/router"]
  MerchantSdk["@split402/merchant-sdk"]
  Merchant["@split402/demo-merchant"]
  DemoAgent["@split402/demo-agent"]
  McpDemo["@split402/mcp-demo"]
  Dashboard["@split402/dashboard"]
  Control["@split402/control-plane"]

  Protocol --> Vectors
  Protocol --> Extension
  Protocol --> Agent
  Protocol --> Router
  Protocol --> MerchantSdk
  Protocol --> Control
  Express --> Merchant
  Extension --> Merchant
  Extension --> MerchantSdk
  Agent --> DemoAgent
  Agent --> Router
  DemoAgent --> McpDemo
  MerchantSdk --> Merchant
  MerchantSdk --> Control
  Merchant --> DemoAgent
  Merchant --> McpDemo
  Control --> Dashboard
  Control -->|"receipt ingestion, registry, ledger, payouts"| Protocol
```

| Package | Purpose |
| --- | --- |
| `@split402/protocol` | Canonical schemas, hashes, IDs, amount math, operation digests, signing, and offline verification. |
| `@split402/test-vectors` | Language-neutral fixtures generated from the protocol package. |
| `@split402/x402-extension` | Split402 offer, attribution, and receipt hooks around standard x402 settlement. |
| `@split402/express` | Express request-context adapter for stable operation-digest inputs. |
| `@split402/agent-sdk` | Buyer-side offer inspection, referral-claim creation, SVM/EVM paid JSON calls, and receipt verification. |
| `@split402/router` | Public-alpha capability router with static providers, control-plane route discovery, external x402 onboarding discovery, GET/POST SVM/EVM provider execution, budget enforcement, deterministic ranking, retry/fallback, pay-to wallet checks, and receipt verification for paid tools. |
| `@split402/merchant-sdk` | Merchant helpers for campaign caching, service-key rotation, payment IDs, operation digests, and durable receipt outbox delivery. |
| `@split402/demo-merchant` | Solana Devnet merchant API used to prove the x402 plus Split402 flow. |
| `@split402/demo-agent` | Runnable buyer/agent harness for setup, preflight, offer inspection, and paid-suite proof runs. |
| `@split402/mcp-demo` | MCP-facing paid-tool bundle and stdio gateway describing the demo tool, x402 payment requirement, Split402 campaign metadata, router-backed capability search/demo execution/external x402 onboarding/receipt lookup, route-attribution proof, receipt verification, and proof commands. |
| `@split402/dashboard` | Merchant/referrer operations UI with a narrow read proxy for dashboard summaries, reliability profiles, webhook delivery, routes, balances, and payouts. |
| `@split402/control-plane` | Receipt ingestion, auth, merchant/campaign/route registries, outbox workers, chain verification, accrual ledger, payout preview, allocation, transaction persistence, broadcast/finality boundaries, and payout ledger closure. |
| `@split402/payout-signer` | Isolated payout signer appliance with HMAC request authentication, policy checks, Solana transaction signing, readiness/metrics endpoints, JSONL audit logging, and container deployment artifacts. |

## Control-Plane Lifecycle

```mermaid
stateDiagram-v2
  [*] --> ReceiptSubmitted
  ReceiptSubmitted --> ReceiptAccepted: valid signature and unique evidence
  ReceiptAccepted --> PendingChainVerification: commission accrual created
  PendingChainVerification --> Available: settlement verified
  PendingChainVerification --> Rejected: settlement rejected
  Available --> Allocated: payout batch allocation
  Allocated --> Released: safe allocation release
  Allocated --> Submitted: payout transaction broadcast
  Submitted --> Finalized: chain finality
  Submitted --> OutcomeUnknown: timeout or ambiguous RPC outcome
  Submitted --> Failed: chain failure
  Finalized --> Paid: payout ledger closes once
```

The current control plane exposes:

```text
GET  /v1/health
POST /v1/auth/challenges
POST /v1/auth/sessions
POST /v1/auth/sessions/refresh
POST /v1/receipts
POST /v1/merchants
GET  /v1/merchants/:merchantId
GET  /v1/merchants/:merchantId/reliability-profile
GET  /v1/merchants/:merchantId/dashboard-summary
GET  /v1/merchants/:merchantId/webhook-events
GET  /v1/merchants/:merchantId/payout-obligations
POST /v1/merchants/:merchantId/origins
POST /v1/merchants/:merchantId/keys
POST /v1/merchants/:merchantId/keys/:kid/revoke
POST /v1/merchants/:merchantId/payout-wallets
POST /v1/campaigns
GET  /v1/campaigns/:campaignId
POST /v1/campaigns/:campaignId/activate
GET  /v1/campaigns/:campaignId/versions/:version
POST /v1/campaigns/:campaignId/versions
POST /v1/routes/drafts
POST /v1/routes
POST /v1/routes/:routeId/suspend
POST /v1/routes/:routeId/rotate-payout
GET  /v1/routes/search
GET  /v1/routes/:routeId/bazaar-resources
GET  /v1/routes/:routeId/versions
GET  /v1/routes/:routeId
POST /v1/merchants/:merchantId/payouts/preview
GET  /v1/merchants/:merchantId/payouts/reconciliation
POST /v1/payout-batches/:batchId/reconcile
POST /v1/merchants/:merchantId/payout-batches
POST /v1/payout-batches/:batchId/release-allocations
GET  /v1/referrers/:referrerWallet/balances
GET  /v1/referrers/:referrerWallet/payouts
GET  /v1/referrers/:referrerWallet/routes
```

## Persistence Layout

```mermaid
flowchart LR
  API["Control-plane API"]
  Registry["Merchant, campaign, route registry"]
  Auth["Wallet auth"]
  Ingestion["Receipt ingestion"]
  Verification["Chain verifier"]
  Payouts["Payout engine"]
  Webhooks["Webhook worker"]

  Merchants[("merchants")]
  Campaigns[("campaigns / versions / operations")]
  Routes[("routes / route_versions")]
  Sessions[("wallet_auth_sessions / refresh_tokens")]
  Receipts[("payment_receipts")]
  Accruals[("commission_accruals")]
  Ledger[("ledger_transactions / ledger_entries")]
  Outbox[("outbox_events")]
  Batches[("payout_batches / items / allocations")]
  Transactions[("payout_transactions / payout_transaction_items")]

  API --> Registry
  API --> Auth
  API --> Ingestion
  API --> Payouts
  Registry --> Merchants
  Registry --> Campaigns
  Registry --> Routes
  Auth --> Sessions
  Ingestion --> Receipts
  Ingestion --> Accruals
  Ingestion --> Ledger
  Ingestion --> Outbox
  Verification --> Outbox
  Verification --> Accruals
  Payouts --> Batches
  Payouts --> Transactions
  Payouts --> Ledger
  Webhooks --> Outbox
```

## Quick Start

Use Node.js 22 and Corepack:

```bash
corepack enable
corepack pnpm install
```

Run the normal validation suite:

```bash
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm vectors:check
corepack pnpm audit --audit-level high
```

Check the combined product readiness gates:

```bash
corepack pnpm product:evidence:init --help
corepack pnpm product:evidence:init
corepack pnpm product:evidence:init --missing
corepack pnpm product:evidence:init --refresh-source
corepack pnpm product:evidence:init --force
corepack pnpm product:local-proof --help
corepack pnpm product:local-proof --brief
corepack pnpm product:local-proof --brief --output split402-launch-evidence/local-public-alpha-proof.json
corepack pnpm product:github-settings-review --template --output split402-launch-evidence/github-settings-review.txt
corepack pnpm product:github-settings-review --from-github --output split402-launch-evidence/github-settings-review.txt
corepack pnpm product:public-surface-check --brief
corepack pnpm product:launch-preflight --help
corepack pnpm product:launch-preflight --brief
corepack pnpm product:launch-preflight --brief --workspace split402-launch-evidence
corepack pnpm product:launch-checklist --help
corepack pnpm product:launch-checklist --brief
corepack pnpm product:launch-checklist --brief --workspace split402-launch-evidence
corepack pnpm product:launch-checklist --brief <phase6-custody-evidence.txt> <phase7-staging-proof.txt>
corepack pnpm product:status --help
corepack pnpm product:status
corepack pnpm product:status --brief
corepack pnpm product:status --brief --workspace split402-launch-evidence
corepack pnpm product:status <phase6-custody-evidence.txt> <phase7-staging-proof.txt>
corepack pnpm product:mainnet-canary --brief --workspace split402-launch-evidence
```

`product:evidence:init` creates a local evidence workspace for the remaining
Phase 7 hosted proof and Phase 6 custody bundle, including local env templates
for attachment paths. It refuses to overwrite existing scaffold files; use
`--missing` to create only absent scaffold files in a partial workspace,
`--refresh-source` to update only stale scaffold `source_commit` values before
evidence collection, and rerun with `--force` only when intentionally replacing
local scaffold content.
`product:launch-preflight --brief --workspace split402-launch-evidence` checks
whether the local launch workspace, scaffold `source_commit` values, Phase 6
custody evidence env paths, and required Phase 7 hosted proof identity,
environment, webhook, and collector values are ready before collection starts.
It also confirms the guarded mainnet canary env points at the private dry-run
and rollback evidence templates, while keeping mainnet approval outside the
local preflight.
The Phase 6 launch evidence workspace is devnet-only until separate mainnet
approval, so preflight requires
`SPLIT402_PHASE6_EVIDENCE_NETWORK=solana:devnet`.
It also verifies that hosted proof and MCP live execution URLs are valid
http(s) URLs and that MCP live execution uses the same hosted control-plane URL
and token as the Phase 7 proof. For the public-alpha proof, MCP live execution
must target `SPLIT402_MCP_CAPABILITY=solana.wallet-risk` so evidence matches the
documented router/MCP demo. The brief output includes redacted summaries of the
Phase 6 custody env file and Phase 7 hosted env file so operators can see which
values are missing or configured without printing tokens, private keys, or
custody values. It reads the local env files with dotenv-style parsing, so quoted
values are handled the same way as the evidence collectors.
When required preflight inputs are ready, the next action reminds operators to
run the GitHub settings/public-private license review and keep that record with
launch evidence before collection.
`product:launch-checklist --brief` prints the exact remaining public/private
license review, local validation, hosted proof, custody evidence, combined
status, and guarded mainnet canary commands; pass
`--workspace split402-launch-evidence` or the Phase 6 and Phase 7 evidence
paths to show checked, blocked, or ready section statuses from real files.
`product:local-proof --brief` proves the local public-alpha repository hygiene,
public/private license surface, protocol vectors, router alpha tests, and
runnable MCP gateway smoke path before hosted evidence collection. Pass
`--output split402-launch-evidence/local-public-alpha-proof.json` to save that
proof beside the launch evidence workspace. This is an adoption-layer smoke proof
only; it does not approve hosted Phase 7, production custody, mainnet, or
commercial operations. The saved proof records the source commit, and
`product:local-proof` fails unless the source worktree is clean.
`product:status --workspace` also treats saved proof as stale if it does not
match the current checkout or if the source worktree has uncommitted changes.
`product:github-settings-review --template --output split402-launch-evidence/github-settings-review.txt`
writes a fillable UTF-8 review record for the live GitHub repository settings in
[`docs/GITHUB_REPOSITORY_SETTINGS.md`](docs/GITHUB_REPOSITORY_SETTINGS.md).
The launch evidence workspace includes
`split402-launch-evidence/github-settings-review.txt` as the intended saved
review artifact.
Run
`product:github-settings-review --from-github --output split402-launch-evidence/github-settings-review.txt`
to generate a no-go review record from the live GitHub API. The command can run
without review env values; it writes placeholder reviewer and evidence fields
until a human review fills them. It checks the About description, topics,
homepage posture, branch protection, pull-request/codeowner review, required
checks, force-push/deletion blocks, blank issue intake, releases, and package
visibility where the GitHub token can read it. Human review must still confirm
security advisories and any UI-only evidence before changing the record to
approved.
Use `--output` instead of shell redirection so Windows PowerShell does not write
the evidence file in an incompatible encoding. An approved review must include
real reviewer, `SPLIT402_GITHUB_SETTINGS_REVIEW_METHOD`, and
`SPLIT402_GITHUB_SETTINGS_EVIDENCE_SOURCE` values, such as an attached private
UI/API evidence record.
`product:public-surface-check --brief` can also be run alone to verify that
launch-facing files still present Apache-2.0, link the public/private boundary,
and do not drift back to old launch-facing license claims.
`product:status` reports the current Split402
phase, whether the GitHub public/private license review, public-alpha hosted
proof, and production custody evidence are checked, launch-gate percentages,
exact evidence-env setup commands, and why the launch decision remains `no-go`
until every machine-checkable launch gate is satisfied. When the concise status
hides extra actions, it prints the exact
Phase 6 and Phase 7 status commands to run for the full blocker list.
`product:mainnet-canary --brief --workspace split402-launch-evidence` is the
guarded preflight for the first tiny mainnet canary. It does not broadcast
transactions. It remains `no-go` until `product:status` is `go`, the canary is
explicitly acknowledged as referral accounting rather than atomic split
settlement, and a one-merchant/one-route/one-wallet dry-run and rollback plan
are attached. With `--workspace`, it auto-loads
`split402-launch-evidence/mainnet-canary.env`, resolves `attached:` dry-run and
rollback artifact paths relative to that private workspace, and validates the
required artifact fields and `source_commit` match before reporting ready. Shell
environment variables override local file values.

Generate the Phase 6 image provenance review record after building immutable
signer and control-plane images:

```bash
corepack pnpm phase6:image-provenance
```

Generate the Phase 6 signer policy review record from deployed signer policy
values:

```bash
corepack pnpm phase6:signer-policy
```

Generate the Phase 6 payout signer key custody review record:

```bash
corepack pnpm phase6:key-custody
```

Generate the Phase 6 private signer network policy review record:

```bash
corepack pnpm phase6:network-policy
```

Generate the Phase 6 signer smoke and secret-exposure review record:

```bash
corepack pnpm signer:payout:smoke
corepack pnpm phase6:signer-smoke
```

Generate the Phase 6 emergency signer-auth revocation drill record:

```bash
corepack pnpm phase6:emergency-revocation
```

Generate the Phase 6 planned signer-auth rotation drill record:

```bash
corepack pnpm phase6:rotation-drill
```

Generate the Phase 6 payout signer rollback drill record:

```bash
corepack pnpm phase6:rollback-drill
```

Generate the Phase 6 payout custody incident drill record:

```bash
corepack pnpm phase6:incident-drill
```

Generate the Phase 6 unknown-outcome reconciliation drill record:

```bash
corepack pnpm phase6:reconciliation-drill
```

Generate the Phase 6 RPC failover review record after running the finality
failover drill:

```bash
corepack pnpm payout:finality:failover-drill
corepack pnpm phase6:rpc-failover
```

List the Phase 6 evidence commands and check the current custody bundle:

```bash
corepack pnpm phase6:evidence:bundle
# Review split402-launch-evidence/phase6-evidence.env first; regenerate only if missing:
corepack pnpm phase6:evidence:env-template split402-launch-evidence split402-launch-evidence/phase6-evidence.env
corepack pnpm phase6:evidence:assemble --evidence-env-file split402-launch-evidence/phase6-evidence.env split402-launch-evidence/phase6-custody-evidence.txt
corepack pnpm phase6:evidence:status --brief split402-launch-evidence/phase6-custody-evidence.txt
corepack pnpm phase6:custody:check split402-launch-evidence/phase6-custody-evidence.txt
```

`product:evidence:init` creates `split402-launch-evidence/phase6-evidence.env`.
Review that generated file before editing it. Use `phase6:evidence:env-template`
only to recreate the local, commented `.env` helper when it is missing. Pass a
custom launch evidence directory when not using the default:
`corepack pnpm phase6:evidence:env-template evidence/launch evidence/launch/phase6-evidence.env`.
`phase6:evidence:assemble` auto-loads the default launch env file when present;
for any other directory, pass `--evidence-env-file <path>` and an explicit
output file path.
`phase6:evidence:status` and `phase6:custody:check` resolve `attached:`
artifact paths relative to the custody bundle directory and fail readiness if
any referenced artifact is missing.
Keep private URLs, secrets, private keys, and transaction bytes out of the file
and out of Git.

Run the optional live PostgreSQL harness against an empty test database:

```powershell
$env:SPLIT402_TEST_DATABASE_URL="postgresql://split402:split402@localhost:5432/split402_test"
corepack pnpm test:postgres
```

Run a durable control-plane app backed by PostgreSQL:

```bash
corepack pnpm control-plane:migrate
corepack pnpm control-plane
```

The runtime reads `SPLIT402_DATABASE_URL` or `DATABASE_URL`, wires PostgreSQL
merchant, campaign, route, auth, receipt, payout, and outbox stores, and defaults
`SPLIT402_CONTROL_PLANE_AUTH_POLICY` to `required` for merchant mutations.

Run the worker processes alongside it:

```bash
corepack pnpm worker:chain
corepack pnpm worker:webhook
```

Run the dashboard:

```bash
corepack pnpm dashboard
```

For hosted staging, set `SPLIT402_DASHBOARD_VIEWER_TOKEN` so dashboard API
routes require a viewer session cookie or `x-split402-dashboard-token` header
while `/health` remains available for uptime probes.

Launch the Phase 7 staging stack:

```bash
cp deploy/phase7-staging/phase7-staging.env.example deploy/phase7-staging/phase7-staging.env
docker compose -f deploy/phase7-staging/compose.yaml up postgres control-plane dashboard
```

Phase 7 proof flow:

```mermaid
flowchart LR
  Stack["Hosted staging stack"]
  Migrate["Migration job"]
  Preflight["Hosted preflight artifact"]
  Reads["Control-plane read artifacts"]
  Paid["Paid agent suite"]
  Manifest["Artifact manifest hashes"]
  Status["Machine status gate"]
  Review["Launch review"]

  Stack --> Migrate
  Migrate --> Preflight
  Preflight --> Reads
  Reads --> Paid
  Paid --> Manifest
  Manifest --> Status
  Status --> Review
```

Prepare and check the Phase 7 staging proof:

```bash
corepack pnpm phase7:staging:init
corepack pnpm product:local-proof --brief --output split402-launch-evidence/local-public-alpha-proof.json
SPLIT402_PHASE7_SEED_CONFIRM=seed-hosted-staging corepack pnpm phase7:staging:seed
corepack pnpm phase7:staging-proof --evidence-env-file split402-launch-evidence/phase7-staging.env split402-launch-evidence/phase7-staging-proof.txt
corepack pnpm phase7:hosted:preflight --evidence-env-file split402-launch-evidence/phase7-staging.env
# Confirm hosted control plane has SPLIT402_FUNDING_BALANCE_PROVIDER=solana-rpc.
corepack pnpm phase7:staging:collect-reads --evidence-env-file split402-launch-evidence/phase7-staging.env
SPLIT402_MCP_CONTROL_PLANE_URL="$SPLIT402_PHASE7_CONTROL_PLANE_URL" \
SPLIT402_MCP_CONTROL_PLANE_TOKEN="$SPLIT402_PHASE7_CONTROL_PLANE_TOKEN" \
SPLIT402_MCP_CAPABILITY=solana.wallet-risk \
SPLIT402_PHASE7_MCP_GATEWAY_EXECUTE=1 \
SPLIT402_MCP_SVM_PRIVATE_KEY=<funded-buyer-key-base58> \
corepack pnpm phase7:staging:collect-mcp-gateway --evidence-env-file split402-launch-evidence/phase7-staging.env
corepack pnpm demo:mcp-gateway:smoke
corepack pnpm phase7:staging:commands-template split402-launch-evidence/phase7-staging-evidence/commands.log
corepack pnpm demo:mcp-bundle split402-launch-evidence/phase7-staging-evidence/mcp-bundle.json
corepack pnpm demo:paid-suite split402-launch-evidence/phase7-staging-evidence/paid-suite.log
corepack pnpm phase7:staging:derive-receipt-verification --evidence-env-file split402-launch-evidence/phase7-staging.env split402-launch-evidence/phase7-staging-evidence/paid-suite.log split402-launch-evidence/phase7-staging-evidence/receipt-verification.json
corepack pnpm phase7:staging:manifest split402-launch-evidence/phase7-staging-proof.txt split402-launch-evidence/phase7-staging-evidence/artifact-manifest.json
corepack pnpm phase7:staging:assemble --evidence-env-file split402-launch-evidence/phase7-staging.env split402-launch-evidence/phase7-staging-proof.txt
corepack pnpm phase7:staging:status --brief split402-launch-evidence/phase7-staging-proof.txt
```

The Phase 7 collection and assembly commands auto-load
`split402-launch-evidence/phase7-staging.env` or
`phase7-staging-evidence/phase7-staging.env` when present. Use
`--evidence-env-file <path>` for custom launch evidence directories.

The status check validates required proof fields, local attachment presence, and
the local attached artifact manifest hashes. It also parses hosted preflight,
read API evidence, paid-suite receipt verification, MCP bundle/gateway evidence,
command evidence, and funding-balance coverage before the proof can close. The
command evidence must include `corepack pnpm product:public-surface-check --brief`
so hosted proof cannot pass after license, About-description, or
public/private-boundary drift. The proof gate cross-checks those artifacts so
discovered routes, dashboard summary, referrer balance, payout obligation,
webhook delivery, paid-suite receipts, and MCP execution all describe the same
hosted flow.

Run the demo merchant and agent flows:

```bash
corepack pnpm demo:merchant
corepack pnpm demo:inspect-offer
corepack pnpm demo:mcp-bundle
corepack pnpm demo:preflight
corepack pnpm demo:paid-suite
```

Run the MCP stdio gateway for clients that want direct MCP tool discovery:

```bash
corepack pnpm demo:mcp-gateway
```

Inspect an external x402 API as an onboarding candidate without making a paid
call:

```bash
corepack pnpm demo:discover-external-x402 https://x402.example \
  --capability crypto.price \
  --match-path /price \
  --provider-id-prefix example-provider
```

See [External x402 Provider Onboarding](docs/runbooks/external-x402-provider-onboarding.md)
for readiness meanings, required Split402 offer fields, provider next actions,
field-level `split402OfferErrors` for malformed extensions, and the Base/EVM
boundary: signed offers and receipts can carry EVM asset and wallet identifiers
for public-alpha routing, but hosted proof, custody, and mainnet approvals
remain separate gates.

Run the deterministic gateway smoke proof:

```bash
corepack pnpm demo:mcp-gateway:smoke
```

## Receipt Ingestion Example

```ts
import {
  InMemoryMerchantRegistry,
  InMemoryReceiptIngestionStore,
  ReceiptIngestor,
  WalletAuthenticator,
  createControlPlaneApp,
  createMerchantReceiptKeyResolver
} from "@split402/control-plane";

const merchantRegistry = new InMemoryMerchantRegistry();
const receiptStore = new InMemoryReceiptIngestionStore();
const authenticator = new WalletAuthenticator();

const ingestor = new ReceiptIngestor(receiptStore, {
  resolveMerchantPublicKey: createMerchantReceiptKeyResolver(merchantRegistry)
});

export const app = createControlPlaneApp({
  ingestor,
  merchantRegistry,
  auth: { authenticator }
});
```

Submit receipts after registering a merchant and service key:

```bash
curl -X POST http://localhost:4020/v1/auth/challenges \
  -H "content-type: application/json" \
  -d '{"wallet":"<owner-wallet>","network":"solana:devnet","purpose":"merchant-session"}'

curl -X POST http://localhost:4020/v1/auth/sessions \
  -H "content-type: application/json" \
  -d '{"challengeId":"<challenge-id>","signature":"<owner-wallet-signature>"}'

curl -X POST http://localhost:4020/v1/merchants \
  -H "authorization: Bearer <access-token>" \
  -H "content-type: application/json" \
  -d '{"slug":"demo-merchant","displayName":"Demo Merchant","ownerWallet":"<owner-wallet>"}'

curl -X POST http://localhost:4020/v1/merchants/<merchant-id>/keys \
  -H "authorization: Bearer <access-token>" \
  -H "content-type: application/json" \
  -d '{"kid":"kid_demo_merchant_1","publicKey":"<service-public-key>"}'

curl -X POST http://localhost:4020/v1/receipts \
  -H "content-type: application/json" \
  -d @receipt-submission.json
```

## Current Phase

Split402 is in public alpha and actively in Phase 7: dashboard, discovery, and
agent-facing demo packaging. The repository already contains the protocol core,
x402 extension, demo path, MCP demo bundle and stdio gateway,
merchant/referrer dashboard UI, merchant SDK primitives, control-plane
ingestion, durable PostgreSQL adapters, outbox workers, chain verification,
payout-engine boundaries, merchant dashboard summaries, payout-obligation views
with optional Solana RPC funding balances, route discovery, referrer views,
webhook management, a hosted-staging compose stack, control-plane migration job,
dashboard viewer gate with expiring sessions, and machine-checkable Phase 7
staging proof gates.

Phase 6 production hardening remains a launch gate:

- staging deployment of the production-packaged signer appliance;
- production payout custody and incident-response review;
- production security review before any mainnet use.

The recorded Phase 3 Devnet paid-suite proof is in
[docs/proofs/phase3-paid-suite-2026-06-24.md](docs/proofs/phase3-paid-suite-2026-06-24.md).
The current Phase 7 hosted proof remains pending until real staging evidence is
assembled and approved.

## Documentation

- [Canonical architecture spec](docs/reference/split402_protocol_architecture_v0.1.md)
- [Current state](docs/CURRENT_STATE.md)
- [GitHub public profile](docs/GITHUB_PUBLIC_PROFILE.md)
- [GitHub repository settings](docs/GITHUB_REPOSITORY_SETTINGS.md)
- [Public and private boundary](docs/PUBLIC_PRIVATE_BOUNDARY.md)
- [Release policy](docs/RELEASE_POLICY.md)
- [Commercial readiness](docs/COMMERCIAL_READINESS.md)
- [Architecture alignment note](docs/SPLIT402_ARCHITECTURE.md)
- [Pre-launch public/private review checklist](docs/checklists/prelaunch-public-private-review.md)
- [Phase 6 custody review checklist](docs/checklists/phase6-custody-review.md)
- [Phase 6 custody evidence template](docs/templates/phase6-custody-evidence.txt)
- [Phase 6 image provenance template](docs/templates/phase6-image-provenance.txt)
- [Phase 6 signer policy review template](docs/templates/phase6-signer-policy-review.txt)
- [Phase 6 signer smoke review template](docs/templates/phase6-signer-smoke-review.txt)
- [Phase 6 emergency revocation drill template](docs/templates/phase6-emergency-revocation-drill.txt)
- [Phase 6 key custody review template](docs/templates/phase6-key-custody-review.txt)
- [Phase 6 network policy review template](docs/templates/phase6-network-policy-review.txt)
- [Phase 6 rotation drill template](docs/templates/phase6-rotation-drill.txt)
- [Phase 6 rollback drill template](docs/templates/phase6-rollback-drill.txt)
- [Phase 6 incident drill template](docs/templates/phase6-incident-drill.txt)
- [Phase 6 reconciliation drill template](docs/templates/phase6-reconciliation-drill.txt)
- [Phase 6 RPC failover review template](docs/templates/phase6-rpc-failover-review.txt)
- [Payout custody incident drill](docs/runbooks/payout-custody-incident-drill.md)
- [Payout reconciliation runbook](docs/runbooks/payout-reconciliation.md)
- [Payout signer deployment runbook](docs/runbooks/payout-signer-deployment.md)
- [Payout signer key rotation runbook](docs/runbooks/payout-signer-key-rotation.md)
- [Payout signer observability runbook](docs/runbooks/payout-signer-observability.md)
- [Mainnet canary runbook](docs/runbooks/mainnet-canary.md)
- [Phase 7 hosted staging runbook](docs/runbooks/phase7-hosted-staging.md)
- [MVP build plan](docs/BUILD_PLAN.md)
- [Roadmap](docs/ROADMAP.md)
- [Phase 0 status](docs/PHASE_0.md)
- [Phase 1 status](docs/PHASE_1.md)
- [Phase 2 status](docs/PHASE_2.md)
- [Phase 3 status](docs/PHASE_3.md)
- [Phase 4 status](docs/PHASE_4.md)
- [Phase 5 status](docs/PHASE_5.md)
- [Phase 6 status](docs/PHASE_6.md)
- [Phase 7 status](docs/PHASE_7.md)
- [Phase 7 staging proof runbook](docs/runbooks/phase7-staging-proof.md)
- [Phase 7 staging proof template](docs/templates/phase7-staging-proof.txt)
- [Architecture baseline decision](docs/decisions/0003-adopt-split402-architecture-baseline.md)
- [Public/private and license decision](docs/decisions/0009-public-private-boundary-and-apache-license.md)
- [EVM payment identifier decision](docs/decisions/0010-evm-payment-identifiers-in-signed-artifacts.md)
- [Security policy](SECURITY.md)
- [Support policy](SUPPORT.md)

## License

This public repository is licensed under
[Apache-2.0](LICENSE). Private Split402 hosted services, commercial operations,
production deployment configuration, custody tooling, provider registries, and
non-public evidence are not automatically licensed by this repository.
Run `corepack pnpm product:public-surface-check --brief` before launch-facing
updates to verify that the public repository still presents the Apache-2.0
protocol foundation and keeps private operations outside the public license
surface.
