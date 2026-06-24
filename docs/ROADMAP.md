# Roadmap

This roadmap follows the Split402 protocol architecture v0.1 spec. The
`splitx402/ffff` repository is the implementation reference for the first slices of
that spec; this repository is the v2 implementation line.

## Phase 0: Repository Setup

Status: complete.

Goal: establish the repository, contribution surface, and initial architecture notes.

Note: the earliest Base/EVM assumptions are superseded. The canonical MVP scope is
Solana x402 `exact`, USDC, referral claims, signed offers/receipts, idempotent
commission accrual, and merchant-funded payouts.

## Phase 1: Transitional Runnable Service

Status: implemented as a transitional slice.

Goal: keep a minimal x402-shaped service online while the real Split402 protocol
packages are ported.

Deliverables:

- TypeScript service scaffold;
- health and discovery endpoints under the Split402 name;
- x402-shaped paid demo route;
- required `payment-identifier`;
- file-backed settlement event log;
- CI.

## Phase 2: Protocol Core And Test Vectors

Status: implemented.

Goal: implement architecture Milestone 0 by importing and preserving the deterministic
protocol package and test vectors from `ffff`.

Deliverables:

- pnpm workspace layout;
- `@split402/protocol`;
- `@split402/test-vectors`;
- canonical hashing;
- stable IDs;
- atomic amount parsing;
- commission math;
- request digest calculation;
- signing and verification helpers;
- fixture generation and checks.

## Phase 3: Single Merchant Devnet Demo

Status: started.

Goal: implement architecture Milestone 1.

Deliverables:

- Solana x402 paid API;
- Split402 x402 extension;
- Express request-context adapter;
- local merchant service signer;
- demo merchant app;
- buyer client with a valid referral claim;
- signed settlement receipt.

Current slice:

- `@split402/x402-extension` package imported from `ffff`;
- `@split402/express` request-context adapter imported from `ffff`;
- client payment payload enrichment;
- resource-server offer enrichment;
- Express request context capture for method, route template, params, query, body,
  and referral claim hints;
- demo merchant runtime with health, discovery, debug receipts, local campaign
  config, local service signer, and `/v1/risk`;
- `@split402/agent-sdk` buyer client for offer inspection, referral claim creation,
  paid JSON calls, and receipt verification;
- demo agent app with buyer setup, offer inspection, preflight, and paid-suite
  scripts for the Devnet receipt path;
- recorded existing-token Devnet paid-suite proof for valid and invalid-claim
  receipts;
- attribution validation before x402 verification;
- signed receipt enrichment after settlement;
- extension, adapter, demo merchant, and agent SDK tests.

## Phase 4: Control Plane And Persistent Ingestion

Status: started.

Goal: implement architecture Milestone 2.

Deliverables:

- PostgreSQL migrations;
- wallet authentication;
- merchant/key/origin APIs;
- campaign version APIs;
- route draft/sign/activate flow;
- public receipt ingestion;
- chain verification worker;
- accrual and zero-sum ledger;
- outbox events.

Current slice:

- `@split402/control-plane` package;
- public receipt ingestion domain that verifies merchant-signed receipts;
- Express control-plane app and `POST /v1/receipts` route for public receipt
  submissions;
- store interface boundary for durable receipt persistence;
- in-memory store for the first deterministic idempotency tests;
- PostgreSQL receipt ingestion store that persists receipts, accruals, ledger
  transactions, and ledger entries in one transaction;
- database uniqueness conflict mapping back to the public duplicate/conflict
  ingestion behavior;
- duplicate detection by receipt hash;
- conflict detection by receipt id, payment id, and settlement transaction;
- commission accrual creation only for credited attributed receipts;
- zero-sum ledger transaction model for merchant commission liability, referrer
  payable, and protocol fee payable;
- initial PostgreSQL migration for receipts, accruals, ledger transactions, and
  ledger entries.
- merchant, service-key, and origin registry foundation;
- `POST /v1/merchants`, `GET /v1/merchants/:merchantId`,
  `POST /v1/merchants/:merchantId/origins`,
  `POST /v1/merchants/:merchantId/keys`, and service-key revocation routes;
- receipt verifier key resolution through registered merchant service keys.

## Phase 5: Production Merchant SDK

Goal: implement architecture Milestone 3.

Deliverables:

- remote and cached campaign resolver;
- durable merchant receipt outbox;
- operation digest coverage;
- payment-identifier integration;
- service-key rotation;
- integration examples and compatibility docs.

## Phase 6: Payout Engine

Goal: implement architecture Milestone 4.

Deliverables:

- funding-wallet registration;
- payout preview;
- allocation selector;
- Solana transaction planner;
- isolated signer interface;
- broadcaster and finality monitor;
- payout reconciliation.

## Phase 7: Dashboard And Discovery

Goal: implement architecture Milestone 5.

Deliverables:

- merchant dashboard;
- referrer balances and routes;
- public reliability profile;
- route search;
- Bazaar metadata integration;
- MCP demo bundle;
- webhook management.

## Later: Token Bonding And Atomic Settlement

Architecture Milestones 6 and 7 remain intentionally later:

- `$SPLIT` route bonding after the USDC commission product works;
- `split-exact` atomic settlement research after accrual, payout, and idempotency
  behavior are proven.
