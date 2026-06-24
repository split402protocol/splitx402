# Split402 Build Plan

This plan follows the Split402 protocol architecture v0.1 spec and the
`splitx402/ffff` implementation built from it. The project is not changing names or
directions: **Split402** is the protocol/product, `ffff` is the first implementation
repo, and this repository is the v2 implementation line.

Canonical source:

- [`docs/reference/split402_protocol_architecture_v0.1.md`](reference/split402_protocol_architecture_v0.1.md)

Implementation reference:

- [`splitx402/ffff`](https://github.com/splitx402/ffff)

## Architecture Rule

The fastest safe build is:

```text
x402 USDC payment
+ signed referral attribution
+ signed operation-bound receipt
+ idempotent commission ledger
+ merchant-controlled batched payout
```

Do not put `$SPLIT`, an Anchor program, or a custom facilitator in the critical path
until this loop works end to end and produces real paid API usage.

## Repository Phase 0: Setup And Direction

Status: complete, with earlier Base/EVM assumptions superseded by the architecture
baseline decision.

Deliverables:

- GitHub repository setup;
- initial security/contribution templates;
- initial architecture notes;
- `splitx402/ffff` reviewed as the implementation baseline.

Exit criteria:

- repo exists on GitHub;
- docs explain that Split402 is the project name;
- docs identify the v0.1 architecture spec as canonical.

## Repository Phase 1: Transitional Runnable Service

Status: implemented as a transitional slice.

Purpose: keep a minimal x402-shaped HTTP host available while v2 ports the real
Split402 protocol packages from `ffff`.

Deliverables:

- TypeScript HTTP service;
- `GET /v1/health`;
- `GET /.well-known/split402.json`;
- `GET /v1/paid-demo`;
- x402-shaped mock payment mode;
- facilitator-backed x402 path from the original skeleton;
- required `payment-identifier`;
- file-backed settlement log;
- CI for lint, typecheck, and tests.

Exit criteria:

- unpaid request returns HTTP 402;
- invalid payment signature returns HTTP 402;
- valid mock payment returns HTTP 200;
- settlement event is recorded and queryable by payment id;
- CI passes.

## Repository Phase 2: Architecture Milestone 0

Status: implemented.

Goal: implement the architecture spec's Milestone 0, using `ffff` as the compatibility
baseline for deterministic protocol artifacts.

Deliverables:

- pnpm monorepo and strict shared TypeScript config;
- `@split402/protocol` package;
- `@split402/test-vectors` package;
- prefixed cryptographic ID generator;
- atomic amount parser/serializer using `bigint`;
- JCS canonicalization wrapper and fixtures;
- schemas for referral claims, offers, attributions, and receipts;
- operation canonicalization and request digest;
- Ed25519 signing and verification helpers;
- commission calculation and tests;
- offline vector generation and vector checking;
- CI for lint, typecheck, unit tests, vectors, and dependency audit.

Exit criteria:

- offline code can create and verify the protocol artifacts currently covered by
  `ffff`;
- test vectors are deterministic across repeated runs;
- monetary code contains no floating-point accounting;
- root CI runs service and protocol checks together.

## Architecture Milestone 1: Single Merchant Devnet Demo

Status: started.

Goal: port and evolve the `ffff` merchant demo into a Solana/x402 Split402 demo.

Deliverables:

- demo x402 Solana paid API;
- Express request-context adapter;
- Split402 x402 extension;
- in-memory campaign resolver;
- local merchant service signer;
- buyer client with a valid referral claim;
- signed receipt returned after settlement.

Current slice:

- port `@split402/x402-extension` from `ffff`;
- port `@split402/express` from `ffff`;
- preserve client-side attribution enrichment behavior;
- preserve resource-server offer and receipt hooks;
- preserve request-context capture for operation digest inputs;
- port `apps/demo-merchant` from `ffff`;
- expose health, discovery, debug receipts, and paid risk-score route;
- port `@split402/agent-sdk` from `ffff`;
- expose buyer-side offer inspection, referral-claim creation, paid JSON call, and
  receipt verification helpers;
- port `apps/demo-agent` from `ffff`;
- expose buyer setup, token setup, offer inspection, preflight, and paid-suite demo
  scripts;
- support a separate disposable fee payer for demo mint setup;
- record an existing-token Devnet paid-suite proof with valid and invalid-claim
  receipts;
- validate required and optional attribution before settlement;
- keep valid/invalid claim behavior, Express adapter behavior, demo merchant
  metadata/challenge behavior, and agent SDK offer/receipt behavior covered by tests.

Exit criteria:

- one Devnet API call returns a verifiable receipt with the expected commission;
- invalid claim does not accrue;
- x402 payment settlement itself remains unchanged.

## Architecture Milestone 2: Control Plane And Ingestion

Status: started.

Deliverables:

- PostgreSQL migrations;
- wallet authentication;
- merchant, key, and origin APIs;
- campaign version APIs;
- route draft/sign/activate flow;
- public receipt ingestion;
- chain verification worker;
- accrual and zero-sum ledger;
- outbox events.

Exit criteria:

- receipt submitted by merchant or buyer produces one accrual total;
- duplicate and conflict behavior matches the spec;
- campaign and route history is immutable and auditable.

Current slice:

- add `@split402/control-plane`;
- verify submitted Split402 receipts with merchant service public keys;
- persist the receipt ingestion shape behind an in-memory store for the first
  behavior tests;
- make identical receipt submission idempotent;
- reject same-receipt-id, same-payment-id, or same-settlement-transaction conflicts;
- create one pending commission accrual for each valid credited attributed receipt;
- create a balanced ledger transaction for merchant liability, referrer payable,
  and protocol fee payable;
- add the first PostgreSQL migration for receipt, accrual, and ledger tables.

## Architecture Milestone 3: Production Merchant SDK

Deliverables:

- remote and cached campaign resolver;
- durable merchant receipt outbox;
- payment-identifier integration;
- operation digest for GET and JSON POST;
- service-key rotation support;
- compile-ready integration example;
- package documentation and version compatibility matrix.

Exit criteria:

- platform outage after settlement still returns a signed deferred receipt;
- outbox later records it without duplication;
- logical request retry cannot create a second payment or commission.

## Architecture Milestone 4: Payout Engine

Deliverables:

- funding-wallet registration;
- payout preview;
- selector and allocations;
- Solana transaction builder;
- signer policy;
- simulation and broadcasting;
- confirmation/finality monitor;
- reconciliation and unknown-outcome runbook;
- referrer payout history.

Exit criteria:

- Devnet payout closes ledger obligation exactly once;
- RPC timeout after broadcast cannot cause a duplicate payout;
- insufficient funds is visible and does not lose allocations.

## Architecture Milestone 5: Dashboard And Discovery

Deliverables:

- merchant campaign dashboard;
- referrer balances and routes;
- public merchant payment-reliability profile;
- route search;
- Bazaar metadata integration;
- MCP demo bundle;
- webhook management.

Exit criteria:

- an agent can discover a route, pay an API, and verify earnings without manual
  database work;
- merchant can inspect and fund all outstanding obligations.

## Architecture Milestone 6: `$SPLIT` Route Bonding

Deliverables:

- standard SPL token integration;
- Anchor route-bond program;
- bond indexing;
- objective challenge/slash process;
- ranking signals that cap stake influence;
- governance-controlled parameters.

Exit criteria:

- core USDC payments still work without `$SPLIT`;
- bonded routes are discoverable;
- no subjective slash can execute without the defined evidence and authority path.

## Architecture Milestone 7: Atomic Settlement Research

Deliverables:

- `split-exact` scheme specification;
- Anchor split-payment program or equivalent facilitator mechanism;
- x402 client/server/facilitator prototype;
- exact recipient and rounding rules;
- migration plan from accrued receipts to atomic receipts.

Exit criteria:

- buyer-signed transaction deterministically pays merchant and referrer in one
  settlement;
- facilitator cannot redirect funds;
- replay and duplicate behavior passes the same idempotency suite.
