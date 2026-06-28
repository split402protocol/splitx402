# Split402

[![CI](https://github.com/split402protocol/splitx402/actions/workflows/ci.yml/badge.svg)](https://github.com/split402protocol/splitx402/actions/workflows/ci.yml)
[![CodeQL](https://github.com/split402protocol/splitx402/actions/workflows/codeql.yml/badge.svg)](https://github.com/split402protocol/splitx402/actions/workflows/codeql.yml)
[![Secret Scan](https://github.com/split402protocol/splitx402/actions/workflows/secret-scan.yml/badge.svg)](https://github.com/split402protocol/splitx402/actions/workflows/secret-scan.yml)
![Status](https://img.shields.io/badge/status-public_alpha-orange)
![Runtime](https://img.shields.io/badge/node-%3E%3D22-339933)
![Protocol](https://img.shields.io/badge/x402-USDC-blue)

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
| `@split402/agent-sdk` | Buyer-side offer inspection, referral-claim creation, paid JSON calls, and receipt verification. |
| `@split402/router` | Public-alpha capability router with static providers, control-plane route discovery, budget enforcement, deterministic ranking, retry/fallback, pay-to wallet checks, and receipt verification for paid tools. |
| `@split402/merchant-sdk` | Merchant helpers for campaign caching, service-key rotation, payment IDs, operation digests, and durable receipt outbox delivery. |
| `@split402/demo-merchant` | Solana Devnet merchant API used to prove the x402 plus Split402 flow. |
| `@split402/demo-agent` | Runnable buyer/agent harness for setup, preflight, offer inspection, and paid-suite proof runs. |
| `@split402/mcp-demo` | MCP-facing paid-tool bundle and stdio gateway describing the demo tool, x402 payment requirement, Split402 campaign metadata, router-backed capability search/demo execution/receipt lookup, route-attribution proof, receipt verification, and proof commands. |
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
corepack pnpm product:evidence:init
corepack pnpm product:evidence:init --force
corepack pnpm product:launch-preflight --brief
corepack pnpm product:launch-checklist --brief
corepack pnpm product:launch-checklist --brief <phase6-custody-evidence.txt> <phase7-staging-proof.txt>
corepack pnpm product:status
corepack pnpm product:status --brief
corepack pnpm product:status <phase6-custody-evidence.txt> <phase7-staging-proof.txt>
```

`product:evidence:init` creates a local evidence workspace for the remaining
Phase 7 hosted proof and Phase 6 custody bundle. It refuses to overwrite
existing scaffold files; rerun with `--force` only when intentionally replacing
local scaffold content. `product:launch-preflight --brief` checks whether the
local launch workspace and required Phase 7 hosted proof environment values are
ready before collection starts. `product:launch-checklist --brief` prints the
exact remaining local validation, hosted proof, custody evidence, and combined
status commands; pass the Phase 6 and Phase 7 evidence paths to show checked,
blocked, or ready section statuses from real files. `product:status` reports the
current Split402 phase, whether the public-alpha hosted proof and production
custody evidence are checked, launch-gate percentages, and why the launch
decision remains `no-go` until both machine-checkable gates are satisfied.

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
corepack pnpm phase6:evidence:assemble
corepack pnpm phase6:evidence:status
corepack pnpm phase6:evidence:status <evidence-bundle.txt>
corepack pnpm phase6:evidence:bundle | corepack pnpm phase6:custody:check -
```

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
SPLIT402_PHASE7_SEED_CONFIRM=seed-hosted-staging corepack pnpm phase7:staging:seed
corepack pnpm phase7:staging-proof > phase7-staging-proof.txt
corepack pnpm phase7:hosted:preflight
# Confirm hosted control plane has SPLIT402_FUNDING_BALANCE_PROVIDER=solana-rpc.
corepack pnpm phase7:staging:collect-reads
SPLIT402_MCP_CONTROL_PLANE_URL="$SPLIT402_PHASE7_CONTROL_PLANE_URL" \
SPLIT402_MCP_CONTROL_PLANE_TOKEN="$SPLIT402_PHASE7_CONTROL_PLANE_TOKEN" \
SPLIT402_MCP_CAPABILITY=solana.wallet-risk \
SPLIT402_PHASE7_MCP_GATEWAY_EXECUTE=1 \
SPLIT402_MCP_SVM_PRIVATE_KEY=<funded-buyer-key-base58> \
corepack pnpm phase7:staging:collect-mcp-gateway
corepack pnpm demo:mcp-gateway:smoke
corepack pnpm phase7:staging:commands-template > phase7-staging-evidence/commands.log
corepack pnpm demo:mcp-bundle > phase7-staging-evidence/mcp-bundle.json
corepack pnpm demo:paid-suite > phase7-staging-evidence/paid-suite.log
corepack pnpm phase7:staging:derive-receipt-verification
corepack pnpm phase7:staging:manifest phase7-staging-proof.txt > phase7-staging-evidence/artifact-manifest.json
corepack pnpm phase7:staging:assemble > phase7-staging-proof.txt
corepack pnpm phase7:staging:status phase7-staging-proof.txt
```

The status check validates required proof fields, local attachment presence, and
the local attached artifact manifest hashes. It also parses hosted preflight,
read API evidence, paid-suite receipt verification, MCP bundle/gateway evidence,
command evidence, and funding-balance coverage before the proof can close. The
proof gate cross-checks those artifacts so discovered routes, dashboard summary,
referrer balance, payout obligation, webhook delivery, paid-suite receipts, and
MCP execution all describe the same hosted flow.

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
- [Architecture alignment note](docs/SPLIT402_ARCHITECTURE.md)
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
- [Security policy](SECURITY.md)
