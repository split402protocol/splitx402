# Phase 6: Payout Engine

Phase 6 starts architecture Milestone 4. The goal is to turn verified
commission accruals into merchant-funded USDC payout batches without double
paying, losing allocations, or hiding funding deficits.

## Current Status

Status: started.

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
- Added signed payout transaction records and PostgreSQL persistence for exact
  signed bytes, expected signature, sequence, attempt, blockhash metadata, and
  submitted state before broadcast.
- Added a Solana RPC broadcaster boundary that sends persisted signed bytes via
  `sendTransaction` and retries the same bytes across configured RPC URLs.
- Added payout transaction finality persistence and a Solana RPC finality monitor
  that reads `getSignatureStatuses`, reports confirmed, finalized, failed,
  retryable, or outcome-unknown results, and schedules retry timestamps.
- Added `0010_payout_batches.sql` for payout batches, payout items, payout
  allocations, and the `allocated` accrual status.
- Added `0011_payout_transactions.sql` for signed payout transaction
  persistence.
- Added control-plane tests for payout planning, Solana transaction planning and
  simulation, signer policy, signed-byte persistence, broadcast submission,
  finality monitoring, allocation persistence, and the HTTP payout routes.

## Why This Comes Next

Phase 4 made receipt ingestion durable and chain verification marks accruals
`available`. Phase 6 starts from those available accruals. Before Split402 signs
or broadcasts payout transactions, the control plane needs a deterministic way to
answer: who is eligible, how much is owed, which asset is involved, and whether
the merchant has enough funding.

## Remaining Milestone 4 Work

- Concrete local-dev or remote signer wiring.
- Worker wiring that applies transaction finality to payout batches, payout
  items, ledger closure, and webhook events.
- Reconciliation for unknown transaction outcomes.
- Referrer payout history and balance views.

## Acceptance Checks

- `corepack pnpm --filter @split402/control-plane test`
- `corepack pnpm --filter @split402/control-plane typecheck`
- `corepack pnpm --filter @split402/control-plane build`
- `corepack pnpm lint`
- `corepack pnpm typecheck`
- `corepack pnpm test`
- `corepack pnpm build`
