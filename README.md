# Split402

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

## Current Status

Split402 is in staged public-alpha implementation. No production contracts or
mainnet payment flows exist yet.

| Area | Status |
| --- | --- |
| Protocol core and deterministic test vectors | Implemented |
| x402 extension, Express adapter, demo merchant | Implemented |
| Agent SDK and Devnet paid-suite harness | Implemented |
| Existing-token Devnet receipt proof | Recorded |
| Control-plane receipt ingestion API | Started |
| PostgreSQL receipt, accrual, and ledger persistence | Started |
| Merchant/key/origin registry APIs | Started |
| PostgreSQL merchant/key/origin persistence | Started |
| Wallet-authenticated merchant mutations | Started |
| PostgreSQL wallet-auth persistence | Started |
| Campaign draft/version APIs | Started |
| Campaign activation APIs | Started |
| PostgreSQL campaign persistence | Started |
| Route draft/sign/activate APIs | Started |
| PostgreSQL route persistence | Started |
| Live PostgreSQL migration/integration harness | Started |
| Chain verification worker and payout engine | Not implemented |
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
  Merchant["@split402/demo-merchant"]
  DemoAgent["@split402/demo-agent"]
  Control["@split402/control-plane"]

  Protocol --> Vectors
  Protocol --> Extension
  Protocol --> Agent
  Protocol --> Control
  Express --> Merchant
  Extension --> Merchant
  Agent --> DemoAgent
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
| `@split402/demo-merchant` | x402-protected merchant API for the Devnet demo. |
| `@split402/demo-agent` | Runnable buyer/agent harness for setup, preflight, and paid-suite proof. |
| `@split402/control-plane` | Receipt ingestion, merchant/key registry, accruals, ledger model, and PostgreSQL adapters. |

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
  Response["Return created, duplicate, conflict, or rejected"]

  Submit --> Schema
  Schema --> Key
  Key --> Signature
  Signature --> Idempotency
  Idempotency --> Receipt
  Receipt --> Accrual
  Accrual --> Ledger
  Ledger --> Response
  Idempotency -->|"existing canonical receipt"| Response
  Idempotency -->|"same id with different hash"| Response
```

The current Phase 4 control plane exposes:

```text
GET  /v1/health
POST /v1/auth/challenges
POST /v1/auth/sessions
POST /v1/receipts
POST /v1/merchants
GET  /v1/merchants/:merchantId
POST /v1/merchants/:merchantId/origins
POST /v1/merchants/:merchantId/keys
POST /v1/merchants/:merchantId/keys/:kid/revoke
POST /v1/campaigns
GET  /v1/campaigns/:campaignId
POST /v1/campaigns/:campaignId/activate
GET  /v1/campaigns/:campaignId/versions/:version
POST /v1/campaigns/:campaignId/versions
POST /v1/routes/drafts
POST /v1/routes
GET  /v1/routes/:routeId
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
  CampaignRows[("campaigns")]
  CampaignVersions[("campaign_versions")]
  CampaignOps[("campaign_operations")]
  Routes[("routes")]
  Challenges[("wallet_auth_challenges")]
  Sessions[("wallet_auth_sessions")]
  Receipts[("payment_receipts")]
  Accruals[("commission_accruals")]
  LedgerTx[("ledger_transactions")]
  LedgerEntries[("ledger_entries")]

  API --> Registry
  API --> RouteRegistry
  API --> Ingestion
  Registry --> Merchants
  Registry --> Origins
  Registry --> Keys
  Registry --> CampaignRows
  CampaignRows --> CampaignVersions
  CampaignVersions --> CampaignOps
  RouteRegistry --> Routes
  Routes --> CampaignRows
  API --> Challenges
  API --> Sessions
  Ingestion --> Receipts
  Ingestion --> Accruals
  Ingestion --> LedgerTx
  LedgerTx --> LedgerEntries
```

Merchant profiles, origins, service keys, and campaign versions can run in memory
for tests or through PostgreSQL adapters for durable control-plane state. Receipt
ingestion uses the same boundary: in-memory stores for deterministic behavior
tests, PostgreSQL stores for durable receipt, accrual, and ledger rows. Wallet auth
also uses the same store boundary, with PostgreSQL persisting single-use challenges
and hashed bearer sessions. Route activation records are also durable in
PostgreSQL, keyed by route id and canonical referral-claim hash so exact duplicate
activation is idempotent while conflicting claims are rejected.

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
- [Architecture baseline decision](docs/decisions/0003-adopt-architecture-and-ffff-baseline.md)
- [Security policy](SECURITY.md)
