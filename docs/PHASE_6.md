# Phase 6: Payout Engine

Phase 6 starts architecture Milestone 4. The goal is to turn verified
commission accruals into merchant-funded USDC payout batches without double
paying, losing allocations, or hiding funding deficits.

## Current Status

Status: in progress. The payout engine now has preview, allocation, transaction
planning, simulation, signer-policy checks, signed-byte persistence, broadcast
submission, local-dev signer wiring, remote signer client wiring, signer
appliance scaffold, signer deployment artifacts, finality monitoring, status
rollup, idempotent ledger closure, and payout lifecycle outbox/webhook events,
plus an unknown-outcome reconciliation queue and referrer payout views.

## What Changed

- Added a `PayoutAccrualStore` read boundary for payout-eligible accruals.
- Added `filterPayoutEligibleAccruals` for deterministic in-memory selection.
- Added `createPayoutPreview` for grouping available accruals by asset and
  destination wallet.
- Added recipient minimum-threshold and max-recipient preview controls.
- Added funding-balance inputs so previews can report covered or deficit states.
- Added merchant payout-wallet records for merchant-controlled payout funding
  wallets.
- Added `POST /v1/merchants/:merchantId/payout-wallets` with the existing
  merchant owner-auth policy.
- Added `0009_merchant_payout_wallets.sql` for durable funding-wallet
  registration.
- Added PostgreSQL selection for `available` commission accruals using the
  existing payout-selection index.
- Added `POST /v1/merchants/:merchantId/payouts/preview` for merchant payout
  previews.
- Added `PayoutBatchStore` and `createPayoutBatchPlan` for planned payout
  batches.
- Added `POST /v1/merchants/:merchantId/payout-batches` to allocate currently
  available accruals into a durable batch.
- Added worker-safe payout batch creation that selects eligible PostgreSQL
  accruals inside the allocation transaction with `FOR UPDATE SKIP LOCKED`.
- Added deterministic Solana payout transaction planning that derives source and
  destination token accounts, adds idempotent associated-token-account creation
  steps, and emits transfer-checked instruction plans for allocated batches.
- Added a Solana RPC payout simulation boundary that validates serialized
  transactions against the plan, calls `simulateTransaction`, and reports
  per-transaction succeeded, failed, or retryable outcomes.
- Added a Solana payout signer interface and policy-enforced signing boundary
  that checks the configured network, funding wallet, source token account, USDC
  mint, allowed SPL Token program, destination/amount list hash, amount caps,
  serialized transaction coverage, and successful simulation before delegating
  to an isolated signing function.
- Added a disposable local-dev Solana payout signer factory that loads explicit
  key material or `SPLIT402_PAYOUT_SIGNER_*` environment variables, verifies the
  signer address against the payout policy, signs serialized transactions, and
  returns the expected transaction signature.
- Added a remote Solana payout signer client that loads
  `SPLIT402_REMOTE_PAYOUT_SIGNER_*` environment variables, posts policy-checked
  signing requests to an isolated signer, and optionally authenticates requests
  with HMAC-SHA256 over `timestamp.body`.
- Added `@split402/payout-signer`, an isolated signer appliance scaffold that
  verifies HMAC requests, rechecks the visible payout policy surface, signs
  Solana transactions with configured key material, and exposes
  `/v1/solana/payouts/sign`.
- Added payout signer HMAC auth key-ring support so operators can run
  active/retired control-plane authentication keys during rotation.
- Added payout signer metrics and safe audit events for signed/rejected signing
  attempts without logging private keys, shared secrets, or transaction bytes.
- Added payout signer readiness checks, a production container build path, and a
  Kubernetes deployment starter manifest.
- Added payout signer HMAC timestamp freshness checks to reject replayed stale
  or future signing requests.
- Added deployable payout signer JSONL audit logging for sanitized custody and
  incident-response evidence.
- Added a payout signer staging smoke check for health, readiness, metrics, and
  secret-exposure validation.
- Added signed payout transaction records and PostgreSQL persistence for exact
  signed bytes, expected signature, sequence, attempt, blockhash metadata, and
  submitted state before broadcast.
- Added a Solana RPC broadcaster boundary that sends persisted signed bytes via
  `sendTransaction` and retries the same bytes across configured RPC URLs.
- Added payout transaction finality persistence and a Solana RPC finality monitor
  that reads `getSignatureStatuses`, reports confirmed, finalized, failed,
  retryable, or outcome-unknown results, and schedules retry timestamps.
- Added payout batch finality rollup so submitted, confirmed, finalized, failed,
  expired, and outcome-unknown transaction states update payout batch and item
  status conservatively.
- Added idempotent payout-batch ledger closure for finalized batches so referrer
  payable and merchant commission liability accounts close exactly once.
- Added finalized-payout internal and webhook outbox events that commit
  atomically with first-time payout-batch ledger closure and remain idempotent on
  repeated closure calls.
- Added payout submitted, confirmed, failed, and outcome-unknown internal and
  webhook outbox events that commit atomically with payout transaction state
  updates and batch rollup.
- Added an unknown-outcome reconciliation queue and
  `GET /v1/merchants/:merchantId/payouts/reconciliation` so merchants/operators
  can list payout batches that must be rechecked onchain before any retry.
- Added `POST /v1/payout-batches/:batchId/reconcile` to requery payout
  transaction finality, persist confirmed/finalized/failed/outcome-unknown
  observations through the existing rollup path, and return a retry decision.
- Added an operator runbook for unknown payout outcomes at
  `docs/runbooks/payout-reconciliation.md`.
- Added a Phase 6 custody review checklist at
  `docs/checklists/phase6-custody-review.md`.
- Added a payout custody incident drill at
  `docs/runbooks/payout-custody-incident-drill.md`.
- Added referrer-facing balance and payout history views with
  `GET /v1/referrers/:referrerWallet/balances` and
  `GET /v1/referrers/:referrerWallet/payouts`.
- Added `0010_payout_batches.sql` for payout batches, payout items, payout
  allocations, and the `allocated` accrual status.
- Added `0011_payout_transactions.sql` for signed payout transaction
  persistence.
- Added control-plane tests for payout planning, Solana transaction planning and
  simulation, signer policy, signed-byte persistence, broadcast submission,
  finality monitoring, batch/item rollup, payout ledger closure, allocation
  persistence, referrer payout views, and the HTTP payout routes.

## Why This Comes Next

Phase 4 made receipt ingestion durable and chain verification marks accruals
`available`. Phase 6 starts from those available accruals. Before Split402 signs
or broadcasts payout transactions, the control plane needs a deterministic way to
answer: who is eligible, how much is owed, which asset is involved, and whether
the merchant has enough funding.

## Remaining Milestone 4 Work

- Complete staging deployment validation evidence for the packaged signer
  appliance.
- Complete every pending gate in
  `docs/checklists/phase6-custody-review.md`.
- Validate the completed custody evidence bundle with
  `corepack pnpm phase6:custody:check <evidence-bundle.txt>`.

## Acceptance Checks

- `corepack pnpm --filter @split402/control-plane test`
- `corepack pnpm --filter @split402/control-plane typecheck`
- `corepack pnpm --filter @split402/control-plane build`
- `corepack pnpm lint`
- `corepack pnpm typecheck`
- `corepack pnpm test`
- `corepack pnpm build`
- `corepack pnpm phase6:custody:check <evidence-bundle.txt>`
