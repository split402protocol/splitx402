# Split402

[![CI](https://github.com/split402protocol/splitx402/actions/workflows/ci.yml/badge.svg)](https://github.com/split402protocol/splitx402/actions/workflows/ci.yml)
![Status](https://img.shields.io/badge/status-public_alpha-orange)
![Runtime](https://img.shields.io/badge/node-%3E%3D22-339933)

> Referral, attribution, and commission infrastructure for x402-paid APIs and
> agent tools.

Split402 lets merchants sell API calls through standard x402 payment flows while
recording verifiable referral commissions for agents, apps, and route publishers.
The MVP keeps the commercial payment simple: the buyer pays the merchant in USDC,
the merchant receives the gross x402 settlement, and Split402 records an auditable
commission liability that can later be paid from a merchant-funded payout worker.

In plain terms: an agent can pay USDC for an x402 API call and attach a signed
Split402 referral claim. If the merchant campaign says the referral commission is
10 percent, Split402 records that 10 percent as an owed commission to the
referrer's payout wallet while the merchant still receives the normal x402
settlement.

Split402 is the project name. This repository, `split402protocol/splitx402`, is
the v2 implementation line for the protocol work that started in
`splitx402/ffff`. The canonical scope is defined in the
[Split402 protocol architecture v0.1 spec](docs/reference/split402_protocol_architecture_v0.1.md).

## What Split402 Does

Split402 is an accrual-and-payout protocol for referral revenue on top of normal
x402 payments.

| Step | Result |
| --- | --- |
| Buyer or agent pays an x402-protected API in USDC. | The merchant receives the normal gross x402 settlement. |
| The request carries a signed Split402 referral claim. | The merchant can attribute the sale to a route, app, or agent. |
| The merchant signs a Split402 receipt after settlement. | The control plane can verify who paid, which campaign applied, and which referral wallet should be credited. |
| The control plane records a commission accrual. | A 10 percent campaign records `1000` bps as owed to the referrer. |
| A later payout worker pays accumulated commissions. | Referrers receive USDC from a merchant-funded payout flow. |

```mermaid
flowchart LR
  Payment["1. x402 USDC payment"]
  Merchant["2. Merchant receives gross settlement"]
  Receipt["3. Merchant signs Split402 receipt"]
  Ledger["4. Split402 records referral commission"]
  Payout["5. Merchant-funded payout pays referrer"]

  Payment --> Merchant
  Merchant --> Receipt
  Receipt --> Ledger
  Ledger --> Payout
```

## Protocol Model

```mermaid
flowchart LR
  Buyer["Buyer or agent"]
  Merchant["x402 merchant API"]
  Facilitator["x402 facilitator"]
  Solana["Solana settlement"]
  Control["Split402 control plane"]
  Referrer["Referrer payout wallet"]

  Buyer -->|"1. Request paid API"| Merchant
  Merchant -->|"2. 402 response + Split402 offer"| Buyer
  Buyer -->|"3. x402 payment + referral claim"| Merchant
  Merchant -->|"4. Verify and settle x402 payment"| Facilitator
  Facilitator --> Solana
  Merchant -->|"5. Signed Split402 receipt"| Buyer
  Merchant -->|"6. Receipt ingestion"| Control
  Buyer -.->|"optional receipt submission"| Control
  Control -->|"7. Accrual + ledger liability"| Referrer
```

The important design choice: Split402 does not fork x402 settlement for the MVP.
It adds signed attribution, signed receipts, idempotent accruals, and a ledger
around the existing x402 payment path.

## Payment Sequence

```mermaid
sequenceDiagram
  participant B as Buyer agent
  participant M as Merchant API
  participant X as x402 facilitator
  participant S as Solana
  participant C as Split402 control plane

  B->>M: Call paid resource
  M-->>B: 402 Payment Required with Split402 offer
  B->>B: Verify offer and attach referral claim
  B->>M: Retry with x402 payment payload
  M->>M: Validate attribution and request digest
  M->>X: Verify x402 payment
  X-->>M: Payment valid
  M->>X: Settle
  X->>S: Submit settlement transaction
  S-->>X: Confirmed transaction
  X-->>M: Settlement response
  M->>M: Sign Split402 receipt
  M-->>B: Paid response + receipt
  M->>C: Submit receipt
  C->>C: Verify key, enforce idempotency, create accrual
```

## Commission Accounting

Split402 does not take funds from the x402 transaction in the current MVP. It
records what the merchant owes after a successful paid call.

| Example | Value |
| --- | --- |
| API price | `1.00 USDC` |
| x402 settlement | `1.00 USDC` paid to the merchant |
| Campaign commission | `1000` bps, or 10 percent |
| Split402 accrual | `0.10 USDC` owed to the referrer |
| Payout timing | Later, after chain verification and payout selection |

```mermaid
flowchart LR
  Gross["Buyer pays 1.00 USDC"]
  Settle["x402 settles 1.00 USDC to merchant"]
  Terms["Campaign terms: 1000 bps"]
  Accrual["Ledger records 0.10 USDC payable"]
  Verify["Chain verification"]
  Batch["Payout batch"]

  Gross --> Settle
  Settle --> Terms
  Terms --> Accrual
  Accrual --> Verify
  Verify --> Batch
```

## Current Status

Split402 is in staged public-alpha implementation. No production contracts or
mainnet payment flows exist yet.

| Area | Status |
| --- | --- |
| Protocol core and deterministic test vectors | Implemented |
| x402 extension, Express adapter, demo merchant | Implemented |
| Agent SDK and Devnet paid-suite harness | Implemented |
| Existing-token Devnet receipt proof | Recorded |
| Merchant SDK cached campaign resolver, key rotation, payment IDs, operation digests, receipt outbox, and integration example | Started |
| Control-plane receipt ingestion API | Started |
| PostgreSQL receipt, accrual, and ledger persistence | Started |
| Merchant/key/origin registry APIs | Started |
| PostgreSQL merchant/key/origin persistence | Started |
| Wallet-authenticated merchant mutations | Started |
| PostgreSQL wallet-auth persistence | Started |
| Wallet-auth refresh token flow | Started |
| Campaign draft/version APIs | Started |
| Campaign activation APIs | Started |
| PostgreSQL campaign persistence | Started |
| Route draft/sign/activate/suspend APIs | Started |
| Route search API | Started |
| Route payout rotation and immutable route versions | Started |
| PostgreSQL route persistence | Started |
| Outbox event persistence | Started |
| Outbox claim/retry/dead-letter APIs | Started |
| Chain verification worker framework | Started |
| Chain verification polling loop | Started |
| Chain verification worker process entrypoint | Started |
| Webhook dispatch worker process entrypoint | Started |
| Durable control-plane runtime factory | Started |
| Production auth policy wiring | Started |
| Solana RPC signature-status verifier | Started |
| Solana transaction transfer verifier | Started |
| Live PostgreSQL migration/integration harness | Started |
| Payout engine preview, funding-wallet registry, batch allocation, Solana transfer planning, simulation, signer policy, signed-byte persistence, broadcaster boundary, finality monitor, and ledger closure | Started |
| `$SPLIT` bonding and atomic split settlement | Later research |

The latest Devnet proof is recorded in
[docs/proofs/phase3-paid-suite-2026-06-24.md](docs/proofs/phase3-paid-suite-2026-06-24.md).

## Repository Map

```mermaid
flowchart TB
  Protocol["@split402/protocol"]
  Vectors["@split402/test-vectors"]
  Extension["@split402/x402-extension"]
  Express["@split402/express"]
  Agent["@split402/agent-sdk"]
  MerchantSdk["@split402/merchant-sdk"]
  Merchant["@split402/demo-merchant"]
  DemoAgent["@split402/demo-agent"]
  Control["@split402/control-plane"]

  Protocol --> Vectors
  Protocol --> Extension
  Protocol --> Agent
  Protocol --> Control
  Express --> Merchant
  Extension --> Merchant
  Extension --> MerchantSdk
  Agent --> DemoAgent
  MerchantSdk --> Control
  Merchant --> DemoAgent
  Control -->|"receipt ingestion, registry, ledger"| Protocol
```

| Package | Purpose |
| --- | --- |
| `@split402/protocol` | Schemas, canonical hashes, IDs, amount math, operation digests, signing, and offline verification. |
| `@split402/test-vectors` | Language-neutral fixtures generated from the protocol package. |
| `@split402/x402-extension` | Split402 offer, attribution, and receipt hooks around x402 settlement. |
| `@split402/express` | Request-context adapter for stable operation digest inputs. |
| `@split402/agent-sdk` | Buyer-side offer inspection, referral claim creation, paid calls, and receipt verification. |
| `@split402/merchant-sdk` | Merchant-side cached campaign resolver, service-key rotation helpers, x402 payment-identifier helpers, operation digest helpers, durable receipt outbox, control-plane ingestion retry helpers, and compile-checked examples. |
| `@split402/demo-merchant` | x402-protected merchant API for the Devnet demo. |
| `@split402/demo-agent` | Runnable buyer/agent harness for setup, preflight, and paid-suite proof. |
| `@split402/control-plane` | Receipt ingestion, merchant/key registry, merchant payout-wallet registry, accruals, ledger model, payout preview and batch allocation planning, and PostgreSQL adapters. |

## Control-Plane Process

```mermaid
flowchart TD
  Submit["POST /v1/receipts"]
  Schema["Validate receipt schema"]
  Key["Resolve merchant service key by merchantId + kid"]
  Signature["Verify merchant receipt signature"]
  Idempotency["Check receipt/payment/settlement uniqueness"]
  Receipt["Insert receipt"]
  Accrual["Create pending commission accrual"]
  Ledger["Create zero-sum ledger transaction"]
  Outbox["Insert outbox event"]
  Response["Return created, duplicate, conflict, or rejected"]

  Submit --> Schema
  Schema --> Key
  Key --> Signature
  Signature --> Idempotency
  Idempotency --> Receipt
  Receipt -->|"credited receipt"| Accrual
  Accrual --> Ledger
  Ledger --> Outbox
  Receipt -->|"zero-credit receipt"| Outbox
  Outbox --> Response
  Idempotency -->|"existing canonical receipt"| Response
  Idempotency -->|"same id with different hash"| Response
```

## Accrual Lifecycle

```mermaid
stateDiagram-v2
  [*] --> ReceiptAccepted: signed receipt ingested
  ReceiptAccepted --> PendingChainVerification: commission accrual created
  PendingChainVerification --> Available: settlement signature confirmed
  PendingChainVerification --> Held: policy or risk hold
  PendingChainVerification --> DeadLetter: repeated verifier failure
  Available --> Allocated: payout batch allocation
  Allocated --> Paid: payout finalized
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
GET  /v1/routes/:routeId/versions
GET  /v1/routes/:routeId
POST /v1/merchants/:merchantId/payouts/preview
POST /v1/merchants/:merchantId/payout-batches
```

## Persistence Layout

```mermaid
flowchart LR
  API["Control-plane API"]
  Registry["Merchant and campaign registry"]
  RouteRegistry["Route registry"]
  Ingestion["Receipt ingestion store"]
  Merchants[("merchants")]
  Origins[("merchant_origins")]
  Keys[("merchant_keys")]
  PayoutWallets[("merchant_payout_wallets")]
  CampaignRows[("campaigns")]
  CampaignVersions[("campaign_versions")]
  CampaignOps[("campaign_operations")]
  Routes[("routes")]
  RouteVersions[("route_versions")]
  Challenges[("wallet_auth_challenges")]
  Sessions[("wallet_auth_sessions")]
  RefreshTokens[("wallet_auth_refresh_tokens")]
  Receipts[("payment_receipts")]
  Accruals[("commission_accruals")]
  LedgerTx[("ledger_transactions")]
  LedgerEntries[("ledger_entries")]
  PayoutBatches[("payout_batches")]
  PayoutItems[("payout_items")]
  PayoutAllocations[("payout_allocations")]
  Outbox[("outbox_events")]

  API --> Registry
  API --> RouteRegistry
  API --> Ingestion
  Registry --> Merchants
  Registry --> Origins
  Registry --> Keys
  Registry --> PayoutWallets
  Registry --> CampaignRows
  CampaignRows --> CampaignVersions
  CampaignVersions --> CampaignOps
  RouteRegistry --> Routes
  Routes --> RouteVersions
  Routes --> CampaignRows
  API --> Challenges
  API --> Sessions
  Sessions --> RefreshTokens
  Ingestion --> Receipts
  Ingestion --> Accruals
  Ingestion --> LedgerTx
  LedgerTx --> LedgerEntries
  Ingestion --> PayoutBatches
  PayoutBatches --> PayoutItems
  PayoutItems --> PayoutAllocations
  PayoutAllocations --> Accruals
  Ingestion --> Outbox
```

Merchant profiles, origins, service keys, payout funding wallets, and campaign
versions can run in memory for tests or through PostgreSQL adapters for durable
control-plane state. Receipt ingestion uses the same boundary: in-memory stores
for deterministic behavior tests, PostgreSQL stores for durable receipt, accrual,
and ledger rows. Wallet auth also uses the same store boundary, with PostgreSQL
persisting single-use challenges, hashed bearer sessions, and hashed rotating
refresh tokens. Route activation and suspension records are also durable in
PostgreSQL and searchable by campaign, referrer, origin, operation, status, and
limit. Routes are keyed by route id and canonical referral-claim hash so exact
duplicate activation is idempotent while conflicting claims are rejected.
Payout-wallet rotation creates a new referrer-signed claim for the same route and
appends it to immutable `route_versions`, while the `routes` row points at the
latest current version for discovery. Historical receipts keep their original
claim hash and payout wallet evidence.
When merchant auth is required, route suspension is limited to the owner wallet
of the route campaign's merchant. Accepted receipts also create pending
chain-verification and webhook outbox events in the same PostgreSQL transaction,
giving workers a durable feed for chain verification, payout selection,
dashboards, and webhooks. The PostgreSQL outbox store can claim ready events by
event type, mark them delivered, or reschedule/dead-letter failures without
creating duplicate worker work. The first chain-verification worker framework can
process `receipt.accepted.v1` events with a pluggable verifier and make
confirmed accruals available for future payout selection. The webhook dispatch
worker processes `webhook.receipt.accepted.v1` events and sends signed HTTP POST
envelopes to a configured endpoint. The first Solana verifier checks settlement
signature status through one or more JSON-RPC providers and parses confirmed
transaction data to reject receipts whose token mint, payer authority, pay-to
wallet or associated token account, or amount do not match the receipt. The first
payout-engine slice can register merchant-controlled payout funding wallets,
query eligible available accruals, group them by asset and destination wallet,
apply recipient thresholds and limits, report funding coverage or deficit through
`POST /v1/merchants/:merchantId/payouts/preview`, and create planned payout
batches that mark selected accruals `allocated` exactly once. PostgreSQL-backed
batch creation can also select eligible accruals inside the allocation
transaction with `FOR UPDATE SKIP LOCKED` so concurrent payout workers do not
claim the same rows. The first Solana payout planner derives source and
destination token accounts, emits idempotent associated-token-account creation
steps, and creates transfer-checked instruction plans for allocated batches.
The Solana simulation boundary validates serialized transactions against the
plan, calls `simulateTransaction`, and reports succeeded, failed, or retryable
outcomes. The signer boundary now requires a matching network, funding wallet,
source token account, USDC mint, allowed SPL Token program, destination/amount
list hash, amount caps, serialized transaction coverage, and successful
simulation before it delegates to an isolated signing function. Signed payout
transaction rows now persist the exact signed bytes, expected signature,
sequence, attempt, blockhash metadata, and submitted state before broadcast.
The Solana broadcaster boundary sends those identical signed bytes through
`sendTransaction` and can retry across RPC URLs. The finality monitor reads
`getSignatureStatuses`, reports confirmed, finalized, failed, retryable, or
outcome-unknown results, and returns explicit retry timestamps. Transaction
status now rolls up conservatively to payout batches and items, including
finalized, failed, and outcome-unknown states. Finalized payout batches can now
close the referrer payable and merchant commission liability ledger accounts
exactly once through an idempotent payout-batch ledger transaction. Concrete
signer wiring, payout webhook events, and reconciliation are still remaining
hardening steps.

## MVP Rules

- Keep x402 commercial payments in USDC.
- Attach referral attribution through a Split402 x402 extension.
- Settle the gross payment normally to the merchant.
- Record a signed receipt and commission liability.
- Pay referrers later from a merchant-funded payout worker.
- Keep atomic split settlement and `$SPLIT` route bonding out of the critical path
  until the payment loop works end to end.

## Quick Start

Use Corepack and pnpm:

```bash
corepack enable
corepack pnpm install
```

Run the core validation suite:

```bash
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm vectors:check
corepack pnpm audit --audit-level high
```

Run the optional live PostgreSQL harness against an empty test database:

```powershell
$env:SPLIT402_TEST_DATABASE_URL="postgresql://split402:split402@localhost:5432/split402_test"
corepack pnpm test:postgres
```

Create a durable control-plane app backed by PostgreSQL:

```ts
import { createControlPlaneRuntimeFromEnv } from "@split402/control-plane";

const runtime = createControlPlaneRuntimeFromEnv();
runtime.app.listen(process.env.PORT ?? 4020);
```

The runtime reads `SPLIT402_DATABASE_URL` or `DATABASE_URL`, wires PostgreSQL
merchant, campaign, route, auth, receipt, and outbox stores, and defaults
`SPLIT402_CONTROL_PLANE_AUTH_POLICY` to `required` for merchant mutations.

Run the deployable chain-verification worker process:

```bash
corepack pnpm worker:chain
```

The worker reads `SPLIT402_CHAIN_WORKER_NETWORK`,
`SPLIT402_CHAIN_WORKER_SOLANA_RPC_URL` or the comma-separated
`SPLIT402_CHAIN_WORKER_SOLANA_RPC_URLS` failover list, and optional
polling/retry settings from the environment, then claims `receipt.accepted.v1`
outbox events and verifies Solana settlement receipts through JSON-RPC.

Run the deployable webhook dispatch worker process:

```bash
corepack pnpm worker:webhook
```

The worker reads `SPLIT402_WEBHOOK_WORKER_URL`,
`SPLIT402_WEBHOOK_WORKER_SECRET`, and optional polling/retry settings from the
environment, then claims `webhook.receipt.accepted.v1` outbox events and POSTs
signed JSON webhook envelopes with `split402-webhook-signature`.

Run the demo merchant and agent flows:

```bash
corepack pnpm demo:merchant
corepack pnpm demo:inspect-offer
corepack pnpm demo:preflight
corepack pnpm demo:paid-suite
```

By default, the transitional root service runs in `SPLIT402_PAYMENT_MODE=mock`,
which emits x402-shaped HTTP 402 challenges and accepts deterministic mock payment
payloads for local tests. Use `SPLIT402_PAYMENT_MODE=x402` only when exercising
the older Phase 1 facilitator-backed path.

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

Register a merchant service key, then submit receipts:

```bash
curl -X POST http://localhost:4020/v1/auth/challenges \
  -H "content-type: application/json" \
  -d '{"wallet":"<owner-wallet>","network":"solana:devnet","purpose":"merchant-session"}'

curl -X POST http://localhost:4020/v1/auth/sessions \
  -H "content-type: application/json" \
  -d '{"challengeId":"<challenge-id>","signature":"<owner-wallet-signature>"}'

curl -X POST http://localhost:4020/v1/auth/sessions/refresh \
  -H "content-type: application/json" \
  -d '{"refreshToken":"<refresh-token>"}'

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

## Documentation

- [Canonical architecture spec](docs/reference/split402_protocol_architecture_v0.1.md)
- [Architecture alignment note](docs/SPLIT402_ARCHITECTURE.md)
- [MVP build plan](docs/BUILD_PLAN.md)
- [Roadmap](docs/ROADMAP.md)
- [Phase 0 status](docs/PHASE_0.md)
- [Phase 1 status](docs/PHASE_1.md)
- [Phase 2 status](docs/PHASE_2.md)
- [Phase 3 status](docs/PHASE_3.md)
- [Phase 4 status](docs/PHASE_4.md)
- [Phase 5 status](docs/PHASE_5.md)
- [Phase 6 status](docs/PHASE_6.md)
- [Architecture baseline decision](docs/decisions/0003-adopt-architecture-and-ffff-baseline.md)
- [Security policy](SECURITY.md)
