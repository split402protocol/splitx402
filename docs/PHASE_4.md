# Phase 4: Control Plane And Persistent Ingestion

Phase 4 starts architecture Milestone 2. The goal is to turn signed Split402
receipts from the demo payment path into idempotent, auditable commission records
that can later feed chain verification, payout selection, dashboards, and webhooks.

## Current Status

Status: started.

Main branch currently contains the receipt-ingestion, merchant registry,
wallet-auth, PostgreSQL receipt/merchant/auth persistence, and campaign
draft/version/activation foundation. Wallet-auth refresh-token rotation, route
draft/activation/suspension, durable campaign and route persistence, outbox
stores, chain-verification workers, Solana verifier slices, runtime wiring, and a
deployable chain-worker entrypoint are staged in the active implementation PR
stack.

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
- Reworked the README with protocol diagrams, package graph, control-plane flow,
  endpoint overview, and usage examples.

## Why This Comes Next

Phase 3 proves that a normal x402 payment can return a signed Split402 receipt.
The next backend requirement is making that receipt durable and idempotent: the
same receipt must not create duplicate commissions, conflicting payment records must
be rejected, and every credited receipt must become one auditable accrual backed by
a zero-sum ledger transaction.

## Remaining Milestone 2 Work

- Merge the active PR stack for durable campaign persistence, routes, route
  suspension, outbox events, chain verification, Solana verification, runtime
  wiring, chain-worker entrypoint, and wallet-auth refresh tokens.
- Route search API and immutable route/search history.
- Payout-wallet rotation.
- Webhook dispatch loop and webhook worker process entrypoint.
- Immutable campaign and route history.

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
