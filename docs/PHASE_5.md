# Phase 5: Production Merchant SDK

Phase 5 starts architecture Milestone 3. The goal is to turn the demo merchant
integration into production merchant building blocks that preserve signed receipts,
survive control-plane outages, and keep x402 retry/idempotency behavior explicit.

## Current Status

Status: started.

## What Changed

- Added `packages/merchant-sdk`.
- Added `MerchantReceiptOutboxStore` interfaces for durable merchant-local
  receipt persistence.
- Added `InMemoryMerchantReceiptOutboxStore` for deterministic tests and examples.
- Added receipt hash conflict detection so the same receipt id cannot be enqueued
  with different signed receipt contents.
- Added `ControlPlaneReceiptSubmitter` for `POST /v1/receipts` submissions with
  merchant source tagging.
- Added `MerchantReceiptOutboxDispatcher` with retry scheduling, accepted
  duplicate handling, permanent rejection dead-lettering, and max-attempt
  dead-lettering.
- Added package documentation for the receipt outbox flow and production storage
  boundary.

## Why This Comes Next

Phase 4 made receipt ingestion durable and idempotent in the control plane. The
merchant side needs the same reliability boundary: after a successful x402
settlement, a merchant should be able to preserve the signed Split402 receipt and
retry ingestion later without creating duplicate commissions.

## Remaining Milestone 3 Work

- Remote and cached campaign resolver.
- Operation digest coverage for production GET and JSON POST integrations.
- Explicit x402 `payment-identifier` integration.
- Service-key rotation support.
- Compile-ready merchant integration example and compatibility matrix.

## Acceptance Checks

- `corepack pnpm --filter @split402/merchant-sdk test`
- `corepack pnpm --filter @split402/merchant-sdk typecheck`
- `corepack pnpm --filter @split402/merchant-sdk build`
- `corepack pnpm lint`
- `corepack pnpm typecheck`
- `corepack pnpm test`
- `corepack pnpm build`
