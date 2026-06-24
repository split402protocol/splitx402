# Roadmap

## Phase 0: Decisions

Goal: make the architecture explicit enough that implementation can begin without
constant protocol churn.

Status: in progress.

Deliverables:

- architecture opinion document;
- accepted Phase 0 decision record;
- MVP build plan;
- repository baseline and contribution/security docs;
- confirmed GitHub remote.

Exit criteria:

- decisions are recorded in `docs/decisions/`;
- the repo has a professional public face;
- Phase 1 implementation tasks are unambiguous.

## Phase 1: Skeleton Service

Goal: run one paid HTTP route using x402 on a test network.

Deliverables:

- TypeScript service scaffold;
- `GET /v1/health`;
- `GET /v1/paid-demo`;
- x402 payment challenge;
- local configuration and tests.

## Phase 2: Split Extension

Goal: attach and validate deterministic split manifests.

Deliverables:

- extension schema;
- split registry;
- split digest binding;
- mutation and expiry tests.

## Phase 3: Idempotency and Ledger

Goal: make paid retries and split allocation durable.

Deliverables:

- required payment id;
- SQLite payment store;
- split allocation table;
- deterministic rounding policy;
- replay tests.

## Phase 4: Payout Worker

Goal: turn ledger allocations into payout instructions.

Deliverables:

- dry-run worker;
- onchain payout adapter;
- payout batches;
- reconciliation job.

## Phase 5: Receipts and Disputes

Goal: prove the relationship between offer, payment, response, split, and payout.

Deliverables:

- signed offer/receipt support;
- receipt verification;
- refund and dispute policy.

