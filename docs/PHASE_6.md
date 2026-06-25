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
- Added PostgreSQL selection for `available` commission accruals using the
  existing payout-selection index.
- Added `POST /v1/merchants/:merchantId/payouts/preview` for merchant payout
  previews.
- Added control-plane tests for payout planning and the HTTP preview route.

## Why This Comes Next

Phase 4 made receipt ingestion durable and chain verification marks accruals
`available`. Phase 6 starts from those available accruals. Before Split402 signs
or broadcasts payout transactions, the control plane needs a deterministic way to
answer: who is eligible, how much is owed, which asset is involved, and whether
the merchant has enough funding.

## Remaining Milestone 4 Work

- Merchant funding-wallet registration.
- Durable payout batches, items, and allocation rows.
- Allocation locking that prevents two workers from selecting the same accrual.
- Solana transfer transaction planning and simulation.
- Isolated payout signer policy.
- Broadcast, confirmation, finality, and retry handling.
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
