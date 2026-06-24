# Phase 1: Transitional Skeleton Service

Phase 1 added a runnable HTTP service with a single paid route. It remains useful as
a local host while the real Split402 protocol packages are ported from `ffff`.

## Current Status

Status: implemented as a transitional slice.

## What Exists

- Node.js and TypeScript service scaffold.
- `GET /v1/health`.
- `GET /.well-known/split402.json` service discovery metadata.
- `GET /v1/paid-demo` protected by an x402 payment guard.
- `GET /v1/payments/:paymentId` for inspecting recorded settlement events.
- Deterministic mock payment mode for local tests without spending testnet funds.
- Facilitator-backed x402 path from the earlier skeleton.
- Required `payment-identifier` declaration and validation.
- File-backed settlement log in `.data/settlements.jsonl`.
- Structured request logging.
- CI workflow for lint, typecheck, tests, vector checks, and audit after Phase 2.

## Acceptance Checks

- Unpaid paid-demo request returns HTTP 402 with `PAYMENT-REQUIRED`.
- Invalid payment signature returns HTTP 402.
- Valid mock payment returns HTTP 200 with `PAYMENT-RESPONSE`.
- Settlement response is recorded and queryable by payment id.
- Workspace checks pass through pnpm.

## Environment

Set these environment values for the temporary service:

```bash
SPLIT402_PAYMENT_MODE=mock
SPLIT402_PAY_TO=0xYourReceivingWallet
SPLIT402_NETWORK=eip155:84532
SPLIT402_FACILITATOR_URL=https://x402.org/facilitator
```

`SPLIT402_SYNC_FACILITATOR=false` is useful for offline startup checks. Keep it
`true` when proving the older facilitator-backed path.

## Scope Note

This phase is not the final Split402 architecture. The Solana/USDC protocol scope,
referral claims, signed offers/receipts, control plane, and payout flow are defined
by the v0.1 architecture spec and start landing in Phase 2 and later.
