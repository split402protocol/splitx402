# Phase 5: Production Merchant SDK

Phase 5 starts architecture Milestone 3. The goal is to turn the demo merchant
integration into production merchant building blocks that preserve signed receipts,
survive control-plane outages, and keep x402 retry/idempotency behavior explicit.

## Current Status

Status: first SDK slice implemented.

## What Changed

- Added `packages/merchant-sdk`.
- Added `CachedControlPlaneCampaignResolver` for active campaign refresh from
  the control plane and synchronous x402 extension resolution from a local cache.
- Added service-key provider support in the x402 extension plus
  `InMemoryMerchantServiceKeyRing` for rotating the current signing key while
  still resolving older public keys by `kid`.
- Added x402 `payment-identifier` helpers that declare the extension as required,
  generate Split402-compatible payment ids, and fail closed when settled payloads
  are missing an identifier.
- Added merchant operation digest helpers for production GET and JSON POST
  request shapes, with JSON-compatibility checks before hashing.
- Added a compile-checked Express/x402 integration example and compatibility
  matrix in `packages/merchant-sdk`.
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

The package-level SDK deliverables are now represented in code and docs. The
next hardening step is wiring these primitives into a deployable merchant runtime
and exercising the full outage/retry path against a live x402 flow.

## Acceptance Checks

- `corepack pnpm --filter @split402/merchant-sdk test`
- `corepack pnpm --filter @split402/merchant-sdk typecheck`
- `corepack pnpm --filter @split402/merchant-sdk build`
- `corepack pnpm --filter @split402/x402-extension test`
- `corepack pnpm --filter @split402/x402-extension typecheck`
- `corepack pnpm --filter @split402/x402-extension build`
- `corepack pnpm lint`
- `corepack pnpm typecheck`
- `corepack pnpm test`
- `corepack pnpm build`
