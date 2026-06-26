# Split402 Build Plan

This plan follows the Split402 protocol architecture v0.1 spec and the current
`split402protocol/splitx402` implementation. The project is not changing names
or directions: **Split402** is the protocol/product, and `ffff` is only the
historical first implementation reference.

Canonical sources:

- [`docs/reference/split402_protocol_architecture_v0.1.md`](reference/split402_protocol_architecture_v0.1.md)
- [`split402protocol/splitx402`](https://github.com/split402protocol/splitx402)

Historical implementation reference:

- [`splitx402/ffff`](https://github.com/splitx402/ffff)

## Current Implementation Snapshot

The repository now contains the protocol core, test vectors, x402 extension,
Express adapter, demo merchant, demo agent, agent SDK, merchant SDK primitives,
control-plane ingestion, PostgreSQL persistence, outbox workers, Solana chain
verification, and the first payout-engine execution boundaries, including payout
lifecycle outbox/webhook events, an unknown-outcome reconciliation queue, and
referrer payout views, payout reconciliation decision tooling, remote signer
client wiring, and a production-packaged signer appliance scaffold. Phase 6
remains active for staging deployment validation and payout custody review.

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

Purpose: keep a minimal x402-shaped HTTP host available while this repository
ports the real Split402 protocol packages from the historical baseline.

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

Status: implemented with a recorded Devnet proof.

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

Status: implemented foundation; continuing hardening moved into the merchant SDK
and payout phases.

Deliverables:

- PostgreSQL migrations;
- wallet authentication;
- merchant, key, and origin APIs;
- campaign version APIs;
- route draft/sign/activate/suspend/search flow;
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
- add wallet authentication challenge/session/refresh flow;
- add PostgreSQL wallet-auth persistence for challenges, hashed sessions, and
  hashed rotating refresh tokens;
- expose a control-plane app and `POST /v1/receipts` route for public receipt
  submission;
- define the receipt ingestion store interface for durable receipt persistence;
- add the PostgreSQL receipt ingestion store;
- persist receipt, accrual, ledger transaction, and ledger entry rows in one
  transaction;
- map database uniqueness conflicts back into the existing duplicate/conflict
  ingestion response path;
- persist the receipt ingestion shape behind an in-memory store for the first
  behavior tests;
- make identical receipt submission idempotent;
- reject same-receipt-id, same-payment-id, or same-settlement-transaction conflicts;
- create one pending commission accrual for each valid credited attributed receipt;
- create a balanced ledger transaction for merchant liability, referrer payable,
  and protocol fee payable;
- add the first PostgreSQL migration for receipt, accrual, and ledger tables.
- add the merchant/key/origin registry foundation;
- expose merchant creation, profile, origin registration, service-key registration,
  and service-key revocation routes;
- gate merchant mutations with authenticated owner-wallet sessions when auth is
  enabled;
- add campaign draft and immutable-version APIs with canonical terms hashes and
  signing bytes;
- add owner-authorized campaign activation for the current version with registered
  merchant service-key signature verification;
- add route draft/sign/activate/suspend APIs with canonical unsigned referral
  claims, referrer signature verification, active campaign scope checks, and
  merchant-owner-authorized suspension when auth is required;
- add route search for active route discovery by campaign, referrer, origin,
  operation id, status, and bounded result limit;
- add payout-wallet rotation for routes by requiring a new referrer-signed claim
  and appending immutable route versions;
- add the PostgreSQL campaign registry adapter and migration for durable campaign,
  immutable version, operation, and activation state;
- add the PostgreSQL route registry adapter and migration for durable active and
  suspended routes, signed referral claims, and duplicate-claim idempotency;
- add the PostgreSQL route-version migration for immutable signed-claim history;
- add the PostgreSQL outbox migration and transaction insert for durable
  `receipt.accepted.v1` and `webhook.receipt.accepted.v1` worker events;
- add the PostgreSQL outbox worker store for claiming ready events by event type,
  retrying failures, marking delivery, and dead-lettering exhausted work;
- add the receipt chain-verification worker framework and PostgreSQL state update
  that makes confirmed accruals payout-eligible;
- add a bounded/abortable chain-verification polling loop around the worker
  framework for deployable runtime wiring;
- add a deployable chain-verification worker process entrypoint and package script
  that compose PostgreSQL stores, the Solana verifier, and polling loop from
  environment configuration;
- add a signed HTTP webhook dispatch worker loop and process entrypoint that
  deliver `webhook.receipt.accepted.v1` events from the durable outbox;
- add a durable control-plane runtime factory that wires PostgreSQL stores,
  receipt key resolution, wallet auth, and required-by-default merchant auth
  policy from runtime configuration;
- add a Solana JSON-RPC verifier for settlement signatures and parsed
  transaction transfer checks covering mint, payer authority, pay-to owner
  evidence, and amount;
- harden the Solana verifier with explicit pay-to associated token account
  derivation and comma-separated multi-provider RPC failover;
- add the packaged PostgreSQL migration runner and opt-in live integration harness
  for real database validation;
- resolve receipt verification keys through registered merchant service keys by
  `merchantId` and `kid`;
- add the PostgreSQL merchant registry adapter for durable merchant, origin, and
  service-key rows;
- add the first merchant/key/origin PostgreSQL migration.

## Architecture Milestone 3: Production Merchant SDK

Status: first SDK slice implemented.

Deliverables:

- remote and cached campaign resolver;
- durable merchant receipt outbox;
- payment-identifier integration;
- operation digest for GET and JSON POST;
- service-key rotation support;
- compile-ready integration example;
- package documentation and version compatibility matrix.

Current slice:

- add `@split402/merchant-sdk`;
- add a cached control-plane campaign resolver that refreshes active campaign
  terms remotely and serves the x402 extension synchronously from cache;
- add service-key provider support and an in-memory merchant key ring for
  current-key rotation with old-`kid` public-key lookup;
- add required x402 `payment-identifier` helpers for route declarations,
  Split402-compatible id generation, and fail-closed settled payload validation;
- add merchant operation digest helpers for production GET and JSON POST request
  shapes with JSON-compatibility validation;
- add a compile-checked Express/x402 merchant integration example and package
  compatibility matrix;
- add durable merchant receipt outbox store interfaces;
- add an in-memory outbox implementation for deterministic tests and examples;
- add a receipt outbox dispatcher with retry scheduling, max-attempt dead-lettering,
  and permanent conflict handling;
- add a control-plane receipt submitter that treats created and duplicate
  ingestion responses as accepted;
- document the outbox flow and production storage boundary.

Exit criteria:

- platform outage after settlement still returns a signed deferred receipt;
- outbox later records it without duplication;
- logical request retry cannot create a second payment or commission.

## Architecture Milestone 4: Payout Engine

Status: in progress.

Deliverables:

- funding-wallet registration;
- payout preview;
- selector and allocations;
- Solana transaction builder;
- signer policy;
- simulation and broadcasting;
- confirmation/finality monitor;
- reconciliation and unknown-outcome runbook;
- referrer payout history and balance views.

Current slice:

- add merchant payout-wallet registration for merchant-controlled payout funding
  wallets;
- add PostgreSQL persistence for merchant payout wallets;
- add a payout preview planner over `available` commission accruals;
- add an eligible-accrual selection interface with in-memory and PostgreSQL
  implementations;
- group preview items by merchant, asset, and destination payout wallet;
- apply recipient thresholds and max-recipient limits without mutating accrual
  state;
- report merchant funding coverage or deficit by asset;
- add durable payout batch, item, and allocation rows;
- mark selected accruals `allocated` with compare-and-set updates before
  inserting payout allocations;
- add worker-side PostgreSQL `FOR UPDATE SKIP LOCKED` selection for concurrent
  batch creation;
- add deterministic Solana transfer plan generation for allocated payout batches;
- add Solana RPC payout transaction simulation with per-transaction
  succeeded/failed/retry outcomes;
- add Solana payout signer interface and policy gate before isolated signing;
- add disposable local-dev signer wiring for Devnet payout tests;
- add remote signer client wiring with optional HMAC request authentication;
- add an isolated payout signer appliance scaffold with HMAC verification and
  Solana transaction signing;
- add payout signer auth key-ring rotation support;
- add payout signer metrics and safe audit events for signed/rejected attempts;
- add payout signer readiness checks, container packaging, and Kubernetes
  deployment starter artifacts;
- add payout signer HMAC timestamp freshness checks to reject replayed stale or
  future signing requests;
- add deployable payout signer JSONL audit logging for sanitized custody
  evidence;
- add a payout signer staging smoke check for health, readiness, metrics, and
  secret-exposure validation;
- add a Phase 6 signer smoke and secret-exposure review generator from staging
  smoke output and audit evidence;
- add a private signer ingress network policy starter for the custody evidence
  bundle;
- add a Phase 6 private signer networking review generator for signer selector,
  control-plane ingress, private service type, and denied public-ingress
  evidence;
- add machine-checkable signer policy evidence fields and a signer policy
  review template;
- add machine-checkable image provenance, emergency signer-auth revocation,
  payout key custody, and rollback drill evidence fields and templates;
- add a Phase 6 image provenance record generator for immutable image digest and
  dependency audit evidence;
- add a Phase 6 signer policy review generator for deployment policy evidence;
- add a Phase 6 payout signer key custody review generator for ownership,
  backup, recovery, access, and separation-of-duties evidence;
- add a Phase 6 emergency signer-auth revocation drill generator for old-key
  rejection, new-key success, metrics, audit-log, and reconciliation evidence;
- add a Phase 6 planned signer-auth rotation drill generator for dual-active
  deploy, control-plane rotation, previous-key retirement, health, metrics, and
  audit-log evidence;
- add a Phase 6 payout signer rollback drill generator for immutable image,
  secret-set, readiness, metrics, reconciliation, and safe batch-resume evidence;
- add a Phase 6 payout custody incident drill generator for pause,
  reconciliation, no-replacement-byte, smoke, metrics, audit, and resume
  evidence;
- add a Phase 6 unknown-outcome reconciliation drill generator for list,
  reconcile, recommended-action, persisted-status, and no-replacement-byte
  evidence;
- add a Phase 6 evidence status command that lists required evidence commands
  and summarizes custody-bundle blockers;
- add a Phase 6 custody evidence bundle scaffold command that emits validator
  fields in canonical order with safe defaults;
- add a Phase 6 custody evidence assembler that derives bundle fields from
  generated records, attachment paths, and explicit overrides;
- add a Phase 6 RPC failover review generator that validates the finality
  failover drill passed and observed status from the secondary RPC;
- add signed-byte payout transaction persistence and Solana broadcast submission
  boundary;
- add Solana payout transaction finality monitor with retry and outcome-unknown
  classification;
- add payout batch and item status rollup from transaction finality;
- add idempotent payout-batch ledger closure for finalized payouts;
- add payout submitted, confirmed, finalized, failed, and outcome-unknown
  internal and webhook outbox events;
- add an unknown-outcome payout reconciliation queue for merchant/operator review;
- add a payout reconciliation action endpoint and unknown-outcome runbook;
- add a Phase 6 custody review checklist and structured payout custody incident
  drill evidence;
- add a Phase 6 custody evidence validator for production go/no-go bundles;
- add a payout finality RPC failover drill and structured review record for
  custody evidence;
- expose `POST /v1/merchants/:merchantId/payout-wallets`;
- expose `POST /v1/merchants/:merchantId/payouts/preview`;
- expose `GET /v1/merchants/:merchantId/payouts/reconciliation`;
- expose `POST /v1/payout-batches/:batchId/reconcile`;
- expose `POST /v1/merchants/:merchantId/payout-batches`.

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

Current slice:

- public merchant reliability profile endpoint with verified-origin,
  receipt-key, webhook-key, payout-wallet, and discovery-readiness signals.
- referrer route listing endpoint for dashboard and discovery views.
- Bazaar-compatible resource metadata projection for active Split402 routes.
- merchant dashboard summary endpoint with readiness, campaign, operation, and
  route status rollups.
- merchant webhook delivery feed for pending, processing, delivered, and
  dead-letter webhook outbox events.
- MCP-facing paid-tool demo bundle with tool metadata, x402 payment details,
  Split402 campaign metadata, expected referral economics, and proof commands.
- merchant/referrer dashboard UI with a narrow control-plane read proxy for
  summaries, reliability profiles, webhook delivery, routes, balances, and
  payouts.
- Phase 7 staging proof scaffold, status validator, template, and runbook for
  hosted end-to-end evidence.
- merchant payout-obligation summary endpoint and dashboard view for pending,
  available, held, in-flight, paid, and outstanding commission liabilities.
- optional Solana RPC funding-balance provider so obligation views can report
  covered and deficit status for active payout wallets.

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
