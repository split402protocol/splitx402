# SplitX402

> x402-compatible split revenue infrastructure for paid HTTP resources.

SplitX402 is a proposed x402-compatible payment architecture for charging once over
HTTP and distributing the resulting revenue across multiple recipients.

The key direction is:

- stay compatible with normal x402 clients;
- express split intent as an x402 extension;
- settle first to a deterministic merchant/vault address;
- distribute splits through a ledger and payout worker until true atomic split
  settlement is worth the added protocol and contract complexity.

## Status

Phase 1 skeleton service is underway on a feature branch. No production contracts or
mainnet payment flows exist yet.

## Docs

- [Architecture opinion](docs/SPLITX402_ARCHITECTURE.md)
- [Phase 0 status](docs/PHASE_0.md)
- [Phase 1 status](docs/PHASE_1.md)
- [MVP build plan](docs/BUILD_PLAN.md)
- [Phase 0 decisions](docs/decisions/0001-phase-0-protocol-decisions.md)
- [Phase 1 service scope](docs/decisions/0002-phase-1-service-scope.md)
- [Roadmap](docs/ROADMAP.md)
- [Security policy](SECURITY.md)

## Suggested First Build

Start with a TypeScript service that protects one HTTP endpoint with x402, requires a
`payment-identifier`, records settlement, and allocates split shares in an internal
ledger. Add onchain payout only after the quote, settlement, idempotency, and
reconciliation loop is working on testnet.

## Development

Copy `.env.example` to `.env`, then run:

```bash
npm install
npm run dev
```

Useful checks:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm audit --audit-level high
```

By default the service runs in `SPLITX402_PAYMENT_MODE=mock`, which emits x402-shaped
HTTP 402 challenges and accepts deterministic mock payment payloads for local tests.
Use `SPLITX402_PAYMENT_MODE=x402` for the real facilitator-backed middleware path.
