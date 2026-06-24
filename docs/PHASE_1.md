# Phase 1: Skeleton Service

Phase 1 turns the documented architecture into a runnable HTTP service with a single
paid route.

## Current Status

Status: implemented on `codex/phase-1-skeleton-service`, pending review and merge.

## What Exists

- Node.js and TypeScript service scaffold.
- `GET /v1/health`.
- `GET /.well-known/splitx402.json` service discovery metadata.
- `GET /v1/paid-demo` protected by an x402 payment guard.
- `GET /v1/payments/:paymentId` for inspecting recorded settlement events.
- Official `@x402/express`, `@x402/core`, `@x402/evm`, and `@x402/extensions`
  integration path for real x402 mode.
- Deterministic mock payment mode for local tests without spending testnet funds.
- Required `payment-identifier` declaration and validation.
- File-backed settlement log in `.data/settlements.jsonl`.
- Structured request logging.
- CI workflow for lint, typecheck, and tests.

## Acceptance Checks

- Unpaid paid-demo request returns HTTP 402 with `PAYMENT-REQUIRED`.
- Invalid payment signature returns HTTP 402.
- Valid mock payment returns HTTP 200 with `PAYMENT-RESPONSE`.
- Settlement response is recorded and queryable by payment id.
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and
  `npm audit --audit-level high` pass locally.

## Real x402 Mode

Set these environment values before using the facilitator-backed path:

```bash
SPLITX402_PAYMENT_MODE=x402
SPLITX402_PAY_TO=0xYourReceivingWallet
SPLITX402_NETWORK=eip155:84532
SPLITX402_FACILITATOR_URL=https://x402.org/facilitator
```

`SPLITX402_SYNC_FACILITATOR=false` is useful for offline startup checks. Keep it
`true` when proving the real payment path.

## Reference Checked

The public `splitx402/ffff` repository was reviewed during this phase. It is a more
advanced Split402 monorepo with protocol packages, Solana Devnet demos, signed
referral offers, receipts, and test vectors.

Useful ideas adopted here:

- explicit facilitator sync configuration;
- service discovery metadata;
- clear local-demo boundaries.

Ideas deferred:

- monorepo package split;
- Solana Devnet as the first network;
- signed referral/commission artifacts;
- offline language-neutral test vectors.

