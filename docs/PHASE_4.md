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

## Why This Comes Next

Phase 3 proves that a normal x402 payment can return a signed Split402 receipt.
The next backend requirement is making that receipt durable and idempotent: the
same receipt must not create duplicate commissions, conflicting payment records must
be rejected, and every credited receipt must become one auditable accrual backed by
a zero-sum ledger transaction.

## Remaining Milestone 2 Work

- PostgreSQL adapter for the receipt ingestion store.
- Wallet authentication.
- Merchant, key, and origin APIs.
- Campaign version APIs.
- Route draft, sign, and activate flow.
- Public HTTP receipt ingestion endpoint.
- Chain verification worker.
- Outbox event persistence.
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
