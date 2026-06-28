# Phase 1: Transitional Skeleton Service

Phase 1 added a runnable HTTP service with a single paid route. It remains useful
as a local host while the full Split402 protocol packages land in this repository.

## Current Status

Status: implemented as a transitional slice.

## What Exists

- Node.js and TypeScript service scaffold.
- `GET /v1/health`.
- `GET /.well-known/split402.json` service discovery metadata.
- `GET /v1/paid-demo` protected by an x402 payment guard.
- `GET /v1/payments/:paymentId` for inspecting recorded settlement events.
- Deterministic mock payment mode for local tests without spending testnet funds.
- Legacy facilitator-backed EVM x402 path from the earlier skeleton. This is not
  the canonical Solana Split402 product path.
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
SPLIT402_PAY_TO=11111111111111111111111111111111
SPLIT402_NETWORK=solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1
SPLIT402_ASSET=usdc-devnet
SPLIT402_FACILITATOR_URL=https://x402.org/facilitator
```

`SPLIT402_SYNC_FACILITATOR=false` is useful for offline startup checks. Keep it
`true` only when explicitly proving the older facilitator-backed EVM path with
`SPLIT402_PAYMENT_MODE=x402`, an `eip155:*` network, and an EVM `payTo` address.

## Scope Note

This phase is not the final Split402 architecture. The Solana/USDC protocol scope,
referral claims, signed offers/receipts, control plane, router, MCP gateway, and
payout flow are defined by the v0.1 architecture spec and implemented in later
workspace packages and apps.
