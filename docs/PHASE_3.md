# Phase 3: Split402 x402 Extension

Phase 3 starts architecture Milestone 1, the single-merchant Devnet demo path.
The first slices port the x402 extension, Express request-context adapter, demo
merchant runtime, agent SDK, and demo agent from `ffff`.

## Current Status

Status: paid-suite proof recorded.

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
- Added `apps/demo-merchant`.
- Added demo merchant endpoints for root metadata, health, discovery, receipt debug,
  and the paid `/v1/risk` route.
- Added demo merchant tests for public metadata and unpaid x402 challenge behavior.
- Added `packages/agent-sdk`.
- Added buyer-side helpers for offer inspection, referral claim creation, paid JSON
  calls, receipt extraction, and offer/receipt verification.
- Added agent SDK tests for valid claims, invalid-claim fixtures, receipt extraction,
  and unpaid offer inspection.
- Added `apps/demo-agent`.
- Added demo scripts for buyer setup, demo mint setup, existing-token setup,
  merchant offer inspection, preflight readiness checks, and the paid-suite receipt
  harness.
- Added separate demo setup fee-payer support for demo mint creation.
- Recorded a Solana Devnet existing-token paid-suite proof in
  [`docs/proofs/phase3-paid-suite-2026-06-24.md`](proofs/phase3-paid-suite-2026-06-24.md).

## Why This Comes Next

The merchant demo needs protocol artifacts from Phase 2, an x402 extension layer
that can attach offers and receipts, an HTTP adapter that can bind the paid request
to a stable operation digest, a runnable merchant app that exposes the first paid
operation, a buyer-side SDK that can inspect the offer and carry referral
attribution into payment retries, and a runnable agent harness that can exercise the
same flow against funded Devnet assets.

## Remaining Milestone 1 Work

- Optional canonical 20 percent demo-mint rerun with a funded disposable setup fee
  payer.
- Control-plane ingestion, merchant SDK, and payout-engine work now continue in
  later phase documents.

## Acceptance Checks

- `corepack pnpm lint`
- `corepack pnpm typecheck`
- `corepack pnpm test`
- `corepack pnpm build`
- `corepack pnpm vectors:check`
- `corepack pnpm audit`
