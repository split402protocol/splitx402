# Phase 3: Split402 x402 Extension

Phase 3 starts architecture Milestone 1, the single-merchant Devnet demo path.
The first slices port the x402 extension and Express request-context adapter from
`ffff`.

## Current Status

Status: started.

## What Changed

- Added `packages/x402-extension`.
- Added client-side Split402 payment payload enrichment.
- Added resource-server offer enrichment.
- Added attribution validation before x402 verification.
- Added signed receipt enrichment after settlement.
- Added extension tests for valid referral claims, invalid referral claims, and
  receipt signing behavior.
- Added `packages/express`.
- Added Express middleware for deriving the Split402 request context.
- Added Express adapter tests for route templates, params, query values, body values,
  fallback context, and referral claim hints.

## Why This Comes Next

The merchant demo needs protocol artifacts from Phase 2, an x402 extension layer
that can attach offers and receipts, and an HTTP adapter that can bind the paid
request to a stable operation digest. These packages are the bridge between
protocol-core objects and the merchant runtime.

## Remaining Milestone 1 Work

- Solana x402 paid demo API.
- In-memory campaign resolver wired into the demo merchant.
- Local merchant service signer.
- Buyer client with a valid referral claim.
- End-to-end Devnet receipt path.

## Acceptance Checks

- `corepack pnpm lint`
- `corepack pnpm typecheck`
- `corepack pnpm test`
- `corepack pnpm build`
- `corepack pnpm vectors:check`
- `corepack pnpm audit`
