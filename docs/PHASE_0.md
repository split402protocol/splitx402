# Phase 0: Decisions

Phase 0 turns SplitX402 from an idea into an implementation-ready protocol plan.

## Current Status

Local status: complete enough to begin Phase 1.

GitHub status: pending repository creation for `split402protocol/splitx402`.

## Accepted Decisions

- Runtime: TypeScript on Node.js.
- Network: Base Sepolia first.
- Asset: test USDC or the facilitator-supported test token on Base Sepolia.
- x402 scheme: v2 `exact`.
- SDK: prototype behind a local adapter using the currently published
  `@coinbase/x402` package while tracking x402 Foundation package movement.
- Split representation: `extensions.splitx402`.
- Settlement target: one vault, merchant, or splitter address.
- Split execution: internal ledger first, payout worker second.
- Persistence: SQLite for the MVP.
- Idempotency: require `payment-identifier` for every paid route.
- Receipts: add signed offers/receipts after the first vertical slice works.

## Phase 0 Exit Criteria

- Phase 0 decision record exists.
- Roadmap and MVP build plan are documented.
- Repository has license, security, contribution, issue, and PR templates.
- GitHub remote exists and contains the initial commit.

## Next Phase

Phase 1 starts with the smallest honest vertical slice:

1. TypeScript API service.
2. `GET /v1/health`.
3. `GET /v1/paid-demo`.
4. x402 `exact` challenge on Base Sepolia.
5. Required payment id.
6. SQLite payment/settlement storage.
7. Three-recipient split allocation endpoint.

