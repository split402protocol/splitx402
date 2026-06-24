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

Phase 0 is in progress: protocol decisions, repository baseline, and MVP boundaries.
No production contracts or mainnet payment flows exist yet.

## Docs

- [Architecture opinion](docs/SPLITX402_ARCHITECTURE.md)
- [MVP build plan](docs/BUILD_PLAN.md)
- [Phase 0 decisions](docs/decisions/0001-phase-0-protocol-decisions.md)
- [Roadmap](docs/ROADMAP.md)
- [Security policy](SECURITY.md)

## Suggested First Build

Start with a TypeScript service that protects one HTTP endpoint with x402, requires a
`payment-identifier`, records settlement, and allocates split shares in an internal
ledger. Add onchain payout only after the quote, settlement, idempotency, and
reconciliation loop is working on testnet.

## Development

The implementation has not been scaffolded yet. Phase 1 should initialize the
TypeScript service, tests, formatting, and local development commands described in
the build plan.

