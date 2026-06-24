# Phase 4: Control Plane And Persistent Ingestion

Phase 4 starts architecture Milestone 2. The goal is to turn signed Split402
receipts from the demo payment path into idempotent, auditable commission records
that can later feed chain verification, payout selection, dashboards, and webhooks.

## Current Status

Status: started.

## What Changed

- Added `packages/control-plane`.
- Added an in-memory receipt ingestion domain for the first control-plane behavior
  slice.
- Added a receipt ingestion store interface for durable persistence.
- Added an Express control-plane app with `GET /v1/health`.
- Added public `POST /v1/receipts` ingestion for buyer, merchant, relay, or
  unknown receipt submissions.
- Added `PostgresReceiptIngestionStore` for durable receipt, accrual, ledger
  transaction, and ledger entry writes.
- Added transaction wrapping and rollback for PostgreSQL receipt persistence.
- Added database uniqueness conflict mapping so duplicate/conflict semantics remain
  stable if a concurrent write wins first.
- Added merchant, origin, and service-key registry types.
- Added an in-memory merchant registry for the current control-plane runtime and
  behavior tests.
- Added merchant creation, profile, origin registration, service-key registration,
  and service-key revocation routes.
- Added wallet authentication challenge and session types.
- Added in-memory single-use wallet authentication challenge/session storage.
- Added `POST /v1/auth/challenges` and `POST /v1/auth/sessions`.
- Added `PostgresWalletAuthStore` for durable single-use challenges and hashed
  bearer sessions.
- Added `0003_wallet_auth.sql` for auth challenge and session tables.
- Added optional auth gating for merchant creation, origin registration,
  service-key registration, and service-key revocation.
- Added campaign draft/version registry types.
- Added an in-memory campaign registry with immutable version records, canonical
  terms hashes, and signing bytes.
- Added `POST /v1/campaigns`, `GET /v1/campaigns/:campaignId`,
  `GET /v1/campaigns/:campaignId/versions/:version`, and
  `POST /v1/campaigns/:campaignId/versions`.
- Added owner-wallet auth gating for campaign creation and new campaign versions
  when auth is enabled.
- Added `POST /v1/campaigns/:campaignId/activate` for owner-authorized
  activation of the current campaign version with a registered Ed25519 merchant
  service-key signature.
- Added campaign activation checks for active merchant status, verified merchant
  origin ownership, valid service-key window, and immutable version signatures.
- Added route draft/sign/activate registry types with canonical unsigned referral
  claims, signing bytes, signature verification, and active route records.
- Added `POST /v1/routes/drafts`, `POST /v1/routes`, and
  `GET /v1/routes/:routeId`.
- Added active campaign, resource origin, campaign version, and operation-scope
  checks around route draft creation and activation.
- Added `PostgresRouteRegistry` for durable active route and signed referral-claim
  persistence.
- Added `0005_routes.sql` for route records, claim hashes, operation scopes, and
  campaign/referrer lookup indexes.
- Added `0006_outbox_events.sql` for durable pending worker/webhook events.
- Added outbox insertion to `PostgresReceiptIngestionStore` so accepted receipts
  commit a `receipt.accepted.v1` event in the same transaction as receipt,
  accrual, and ledger rows.
- Added `PostgresOutboxEventStore` for worker-facing event reads, ready-event
  claims, delivery marking, retry scheduling, and dead-letter transitions.
- Added a receipt chain-verification worker framework that claims
  `receipt.accepted.v1` events, calls a pluggable verifier, marks confirmed
  receipts as verified, moves accruals to `available`, and handles retry or
  dead-letter verifier outcomes.
- Added a bounded and abortable chain-verification polling loop around the worker
  framework with idle backoff, transient error handling, and result/error hooks for
  deployable runtime wiring.
- Added a Solana JSON-RPC signature-status verifier for receipt settlement
  signatures with confirmed/finalized commitment handling, retryable RPC failures,
  and rejected failed transactions.
- Extended the Solana verifier to fetch parsed transaction details and reject
  receipts whose settlement transaction does not prove the expected token mint,
  payer authority, pay-to owner evidence, and amount.
- Added `PostgresCampaignRegistry` for durable campaign, version, activation, and
  operation persistence.
- Added `0004_campaigns.sql` for campaign, campaign version, and campaign
  operation tables.
- Added a packaged PostgreSQL migration runner with checksum tracking.
- Added an opt-in live PostgreSQL integration harness that applies migrations in
  an isolated schema and exercises merchant, campaign, wallet-auth, receipt,
  accrual, and ledger persistence through real `pg`.
- Added merchant service-key resolution for receipt verification by `merchantId`,
  `kid`, purpose, and receipt issue time.
- Added `0002_merchants_keys_origins.sql` for merchant, origin, and key tables.
- Added `PostgresMerchantRegistry` for durable merchant, origin, and service-key
  state.
- Added merchant public-key resolution at ingestion time.
- Added receipt schema parsing and merchant signature verification.
- Added duplicate handling by canonical receipt hash.
- Added conflict handling by receipt id, payment id, and settlement transaction.
- Added pending commission accrual creation for valid attributed credited receipts.
- Added zero-credit receipt recording without accrual creation.
- Added balanced ledger transaction creation for commission accruals.
- Added `0001_receipt_ingestion.sql` with receipt, accrual, ledger transaction, and
  ledger entry tables.
- Added focused ingestion tests for creation, duplicate submission, conflicts,
  invalid signatures, and unattributed zero-credit receipts.
- Added HTTP tests for health, receipt creation, duplicate submission, invalid
  source values, and malformed submission envelopes.
- Added PostgreSQL adapter tests for transaction writes, row mapping, rollback, and
  uniqueness-conflict mapping.
- Added PostgreSQL merchant registry tests for profile loading, key resolution,
  revocation windows, and uniqueness-conflict mapping.
- Added merchant registry tests for key resolution, historical receipt verification
  after later key rotation, and post-revocation receipt rejection.
- Added wallet authentication tests for signed challenge exchange, challenge replay,
  session expiry, and auth-gated merchant mutations.
- Added PostgreSQL wallet-auth tests for durable challenge consumption, token hash
  persistence, and replay rejection.
- Added campaign registry and HTTP tests for immutable version creation, terms
  hashes, signing bytes, owner-authenticated campaign mutations, and merchant
  signature activation.
- Added route registry and HTTP tests for unsigned draft creation, signed route
  activation, duplicate activation idempotency, invalid signatures, and conflicting
  route claims.
- Added PostgreSQL campaign registry tests for draft persistence, immutable
  version persistence, operation rows, activation state, and conflict mapping.
- Added PostgreSQL route registry tests for route persistence, duplicate claim
  idempotency, and same-route/different-claim conflicts.
- Extended the live PostgreSQL integration harness to apply the route migration
  and persist one activated route row.
- Added PostgreSQL receipt-ingestion tests for committed outbox payloads and
  rollback behavior, plus live harness coverage for the outbox table.
- Added PostgreSQL outbox worker tests for ready-event claiming, retry delay
  enforcement, delivery marking, and dead-letter behavior.
- Added chain-verification worker tests for confirmed, retryable, and malformed
  receipt events, plus PostgreSQL coverage for verified receipt/accrual state.
- Added chain-verification loop tests for bounded idle polling, abort handling,
  and transient processor errors.
- Added Solana RPC verifier tests for confirmed/finalized signatures, missing
  signatures, RPC errors, failed transactions, malformed responses, and network
  mismatches.
- Added Solana transaction verifier tests for missing transaction details,
  malformed transaction responses, mint mismatches, pay-to owner mismatches, payer
  authority mismatches, insufficient transfer amounts, and transaction meta
  failures.
- Added `corepack pnpm test:postgres` for live PostgreSQL validation when
  `SPLIT402_TEST_DATABASE_URL` is set.
- Reworked the README with protocol diagrams, package graph, control-plane flow,
  endpoint overview, and usage examples.

## Why This Comes Next

Phase 3 proves that a normal x402 payment can return a signed Split402 receipt.
The next backend requirement is making that receipt durable and idempotent: the
same receipt must not create duplicate commissions, conflicting payment records must
be rejected, and every credited receipt must become one auditable accrual backed by
a zero-sum ledger transaction.

## Remaining Milestone 2 Work

- Wallet-auth refresh token flow.
- Production auth policy wiring for the deployable runtime.
- Deployable control-plane runtime wiring.
- Full x402 SVM settlement-verifier parity, including explicit associated token
  account derivation and multi-provider RPC hardening.
- Webhook dispatch loop and deployable worker runtime wiring.
- Route suspension, payout-wallet rotation, and route search history.

## Acceptance Checks

- `corepack pnpm --filter @split402/control-plane test`
- `corepack pnpm --filter @split402/control-plane typecheck`
- `corepack pnpm --filter @split402/control-plane build`
- `corepack pnpm lint`
- `corepack pnpm typecheck`
- `corepack pnpm test`
- `corepack pnpm build`
- `corepack pnpm vectors:check`
- `corepack pnpm audit`
- Optional live database check:
  `SPLIT402_TEST_DATABASE_URL=... corepack pnpm test:postgres`
