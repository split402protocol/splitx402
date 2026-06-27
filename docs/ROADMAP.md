# Roadmap

This roadmap follows the Split402 protocol architecture v0.1 spec. The
`split402protocol/splitx402` repository is the canonical public implementation
line. The earlier `splitx402/ffff` repository remains a historical reference for
the first implementation slices.

## Current Snapshot

Split402 currently implements the USDC accrual-and-payout architecture up through
the first Phase 6 payout-engine boundaries. The protocol core, test vectors, x402
extension, demo merchant, demo agent, agent SDK, merchant SDK primitives,
control-plane ingestion, PostgreSQL adapters, outbox workers, Solana chain
verification, receipt economic-policy verification, public pending-only
merchant/origin registration, payout preview/allocation, payout transaction persistence,
broadcast/finality boundaries, local-dev signer, remote signer client, signer
appliance scaffold, signer deployment artifacts, rollup, payout lifecycle
outbox/webhook events, unknown-outcome reconciliation queue, referrer payout
views, payout reconciliation decision tooling, and idempotent payout ledger
closure are present. Chain verification rejection now creates terminal rejected
accrual state, finalized payout ledger closure marks allocated accruals paid,
and safe release can cancel pre-submission/problem payout batches back to
available accruals. The first `@split402/router` alpha package is present with
static providers, budget enforcement, ranking, fallback, and receipt
verification, and the MCP demo gateway now exposes router-backed
`split402.searchCapabilities`, `split402.execute`, and `split402.getReceipt`
tools in demo mode.

The MVP still uses normal x402 settlement to the merchant and records a
commission liability for later merchant-funded payout. Protocol fee is a
percentage of the referral commission via `protocolFeeBpsOfCommission`, not a
percentage of gross x402 payment. Atomic split settlement and `$SPLIT` bonding
remain later research.

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

Status: implemented with a recorded Devnet paid-suite proof.

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

Status: implemented foundation; later hardening continues through the merchant
SDK and payout phases.

Goal: implement architecture Milestone 2.

Deliverables:

- PostgreSQL migrations;
- wallet authentication;
- merchant/key/origin APIs;
- campaign version APIs;
- route draft/sign/activate/suspend/search flow;
- public receipt ingestion;
- chain verification worker;
- accrual and zero-sum ledger;
- outbox events.

Current slice:

- `@split402/control-plane` package;
- public receipt ingestion domain that verifies merchant-signed receipts;
- wallet authentication challenge, session, and refresh-token domain;
- `POST /v1/auth/challenges`, `POST /v1/auth/sessions`, and
  `POST /v1/auth/sessions/refresh`;
- PostgreSQL wallet-auth store for single-use challenges, hashed bearer
  sessions, and hashed rotating refresh tokens;
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
- optional owner-wallet auth gating for merchant mutations;
- PostgreSQL merchant registry adapter for merchant, origin, and service-key
  persistence;
- in-memory campaign registry with immutable version records, terms hashes, and
  signing bytes;
- `POST /v1/campaigns`, `GET /v1/campaigns/:campaignId`,
  `GET /v1/campaigns/:campaignId/versions/:version`, and
  `POST /v1/campaigns/:campaignId/versions`;
- owner-authorized `POST /v1/campaigns/:campaignId/activate` for the current
  version with registered merchant service-key signature verification;
- route draft/sign/activate/suspend APIs with canonical unsigned referral claims,
  referrer signature verification, active campaign scope checks, and
  merchant-owner-authorized suspension when auth is required;
- route search API for active route discovery by campaign, referrer, origin,
  operation id, status, and bounded result limit;
- payout-wallet rotation through a new referrer-signed route claim and immutable
  route version history;
- PostgreSQL campaign registry adapter with campaign, immutable version,
  operation, and activation persistence;
- PostgreSQL route registry adapter with active/suspended route status, operation
  scope, signed claim, duplicate-claim persistence, and route-version history;
- PostgreSQL outbox event persistence committed atomically with accepted receipts
  and accounting rows;
- PostgreSQL outbox claiming, retry scheduling, delivery marking, and dead-letter
  state transitions, with event-type filtering for independent workers;
- receipt chain-verification worker framework with a pluggable verifier and
  PostgreSQL state transition to available accruals;
- bounded/abortable chain-verification polling loop for deployable worker wiring;
- deployable chain-verification worker process entrypoint and package script;
- signed HTTP webhook dispatch worker loop and process entrypoint;
- durable control-plane runtime factory with PostgreSQL store wiring and
  required-by-default merchant auth policy;
- Solana JSON-RPC verifier for receipt settlement signatures and parsed transfer
  checks, including pay-to associated token account derivation and
  multi-provider RPC failover;
- packaged PostgreSQL migration runner with checksum tracking and an opt-in live
  integration harness;
- receipt verifier key resolution through registered merchant service keys.

## Phase 5: Production Merchant SDK

Status: first SDK slice implemented.

Goal: implement architecture Milestone 3.

Deliverables:

- remote and cached campaign resolver;
- durable merchant receipt outbox;
- operation digest coverage;
- payment-identifier integration;
- service-key rotation;
- integration examples and compatibility docs.

Current slice:

- `@split402/merchant-sdk` package;
- cached control-plane campaign resolver for active campaign terms;
- service-key provider/key-ring rotation support;
- required x402 `payment-identifier` helpers;
- operation digest helpers for production GET and JSON POST requests;
- compile-checked Express/x402 integration example and compatibility matrix;
- durable receipt outbox interfaces;
- in-memory receipt outbox store for tests and examples;
- control-plane receipt submitter;
- retrying receipt outbox dispatcher with dead-letter behavior.

## Phase 6: Payout Engine

Status: in progress.

Goal: implement architecture Milestone 4.

Deliverables:

- funding-wallet registration;
- payout preview;
- allocation selector;
- Solana transaction planner;
- isolated signer interface;
- broadcaster and finality monitor;
- payout reconciliation.

Current slice:

- merchant payout-wallet registration API and persistence;
- payout preview planner for available accruals;
- deterministic eligible-accrual filtering by merchant, asset, campaign, route,
  timestamp, and limit;
- recipient grouping by asset and payout wallet;
- minimum-threshold and max-recipient controls;
- funding coverage and deficit reporting;
- PostgreSQL eligible-accrual selector;
- durable payout batch, item, and allocation rows;
- compare-and-set allocation that moves selected accruals from `available` to
  `allocated`;
- worker-side PostgreSQL `FOR UPDATE SKIP LOCKED` selection for concurrent batch
  creation;
- deterministic Solana transfer plan generation for allocated payout batches;
- Solana RPC payout transaction simulation with per-transaction
  succeeded/failed/retry outcomes;
- Solana payout signer interface and policy gate before isolated signing;
- disposable local-dev signer wiring for Devnet payout tests;
- remote signer client wiring with optional HMAC request authentication;
- isolated payout signer appliance scaffold with HMAC verification and Solana
  transaction signing;
- payout signer auth key-ring rotation support;
- payout signer metrics and safe audit events for signed/rejected attempts;
- payout signer readiness checks, container build path, and Kubernetes
  deployment starter artifacts;
- payout signer HMAC timestamp freshness checks to reject replayed stale or
  future signing requests;
- deployable payout signer JSONL audit logging for sanitized custody evidence;
- payout signer staging smoke checks for health, readiness, metrics, and
  secret-exposure validation;
- Phase 6 signer smoke and secret-exposure review generation from staging smoke
  output and audit evidence;
- private signer ingress network policy starter for custody evidence;
- Phase 6 private signer networking review generation for signer selector,
  control-plane ingress, private service type, and denied public-ingress
  evidence;
- machine-checkable signer policy evidence fields and signer policy review
  template;
- machine-checkable image provenance, emergency signer-auth revocation, payout
  key custody, and rollback drill evidence fields and templates;
- Phase 6 image provenance record generation for immutable image digest and
  dependency audit evidence;
- Phase 6 signer policy review generation for deployment policy evidence;
- Phase 6 payout signer key custody review generation for ownership, backup,
  recovery, access, and separation-of-duties evidence;
- Phase 6 emergency signer-auth revocation drill generation for old-key
  rejection, new-key success, metrics, audit-log, and reconciliation evidence;
- Phase 6 planned signer-auth rotation drill generation for dual-active deploy,
  control-plane rotation, previous-key retirement, health, metrics, and audit-log
  evidence;
- Phase 6 payout signer rollback drill generation for immutable image,
  secret-set, readiness, metrics, reconciliation, and safe batch-resume evidence;
- Phase 6 payout custody incident drill generation for pause, reconciliation,
  no-replacement-byte, smoke, metrics, audit, and resume evidence;
- Phase 6 unknown-outcome reconciliation drill generation for list, reconcile,
  recommended-action, persisted-status, and no-replacement-byte evidence;
- Phase 6 evidence status reporting for required evidence commands and
  custody-bundle blockers;
- Phase 6 custody evidence bundle scaffolding in canonical validator order;
- Phase 6 custody evidence bundle assembly from generated records, attachment
  paths, and explicit overrides;
- Phase 6 RPC failover review generation that validates the finality drill
  passed and observed status from the secondary RPC;
- signed-byte payout transaction persistence and Solana broadcast submission
  boundary;
- Solana payout transaction finality monitor with retry and outcome-unknown
  classification;
- payout batch and item status rollup from transaction finality;
- safe payout allocation release for draft, planned, signing, failed, and
  cancelled batches;
- idempotent payout-batch ledger closure for finalized payouts;
- payout submitted, confirmed, finalized, failed, and outcome-unknown internal
  and webhook outbox events;
- unknown-outcome payout reconciliation queue for merchant/operator review;
- Phase 6 custody review checklist and structured payout custody incident drill
  evidence;
- Phase 6 custody evidence validator for production go/no-go bundles;
- payout finality RPC failover drill and structured review record for custody
  evidence;
- `POST /v1/merchants/:merchantId/payout-wallets`;
- `POST /v1/merchants/:merchantId/payouts/preview`;
- `GET /v1/merchants/:merchantId/payouts/reconciliation`;
- `POST /v1/payout-batches/:batchId/reconcile`;
- `POST /v1/payout-batches/:batchId/release-allocations`;
- `POST /v1/merchants/:merchantId/payout-batches`;
- `GET /v1/referrers/:referrerWallet/balances`;
- `GET /v1/referrers/:referrerWallet/payouts`.

Current hardening:

- public merchant creation rejects caller-supplied approval status and creates
  pending merchants;
- public merchant-origin registration rejects caller-supplied approval status
  and verification timestamps and creates pending origins;
- receipt ingestion can run a control-plane policy verifier before accrual
  creation.
- chain-verification rejection moves pending accruals to `rejected`.
- finalized payout ledger closure moves allocated accruals to `paid`.
- allocation release cancels only safe pre-submission/problem batches and moves
  their allocated accruals back to `available`; submitted, confirmed,
  finalized, and outcome-unknown batches remain blocked.

## Phase 7: Dashboard And Discovery

Goal: implement architecture Milestone 5.

Deliverables:

- merchant dashboard;
- referrer balances and routes;
- public reliability profile;
- route search;
- Bazaar metadata integration;
- MCP demo bundle and narrow stdio gateway;
- Split402 capability router;
- adoption-grade runnable MCP gateway;
- webhook management.

Current slice:

- public merchant reliability profile endpoint that reports verified origins,
  active receipt/webhook keys, active payout wallets, and discovery readiness.
- referrer route listing endpoint that reuses route-search filters for
  dashboard and discovery views.
- Bazaar-compatible resource metadata projection for active Split402 routes.
- merchant dashboard summary endpoint for readiness, campaign, operation, and
  route status rollups.
- merchant webhook delivery feed for pending, processing, delivered, and
  dead-letter webhook outbox events.
- MCP-facing paid-tool demo bundle and narrow stdio gateway with tool metadata, x402
  payment details, Split402 campaign metadata, expected referral economics, and
  proof commands.
- `@split402/router` public-alpha package with static providers, budget
  enforcement, deterministic ranking, retry/fallback, and fail-closed receipt
  verification.
- Router-backed MCP demo tools for capability search, demo execution results,
  and session receipt lookup. The execution path is explicitly demo/mock mode,
  not production MCP hosting.
- merchant/referrer dashboard UI with a narrow control-plane read proxy for
  summaries, reliability profiles, webhook delivery, routes, balances, and
  payouts.
- optional dashboard viewer gate with signed, expiring sessions for hosted
  staging evidence captures.
- hosted-staging compose stack with PostgreSQL, control plane, migration job,
  dashboard, optional demo merchant, and optional workers.
- Phase 7 staging proof scaffold, hosted preflight collector, read collector,
  artifact manifest validator, funding-balance semantic validator, status
  validator, template, and runbooks for hosted end-to-end evidence.
- merchant payout-obligation summary endpoint and dashboard view for pending,
  available, held, in-flight, paid, and outstanding commission liabilities.
- optional Solana RPC funding-balance provider so obligation views can report
  covered and deficit status for active payout wallets.

Pending Phase 7 adoption layer:

- Hosted/router-backed staging proof with real environment evidence. Do not
  claim full MCP compatibility beyond the implemented stdio tool interface.

## Later: Token Bonding And Atomic Settlement

Architecture Milestones 6 and 7 remain intentionally later:

- `$SPLIT` route bonding after the USDC commission product works;
- `split-exact` atomic settlement research after accrual, payout, and idempotency
  behavior are proven.
