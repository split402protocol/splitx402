# Split402

> Referral, attribution, and commission infrastructure for x402-paid APIs and
> agent tools.

Split402 is the project name. This repository, `split402protocol/splitx402`, is the
v2 implementation line for the same Split402 protocol work that started in
`splitx402/ffff`.

The source of truth for scope is the Split402 protocol architecture v0.1 spec in
[`docs/reference/split402_protocol_architecture_v0.1.md`](docs/reference/split402_protocol_architecture_v0.1.md).
The `ffff` repo is the first implementation pass built from that spec; this repo
continues it with a cleaner branch/PR history and staged delivery.

The MVP rule is:

- keep the commercial x402 payment in USDC;
- attach signed referral attribution through a Split402 x402 extension;
- settle the gross payment normally to the merchant;
- record a signed receipt and commission liability;
- pay referrers from a merchant-funded payout worker;
- leave atomic split settlement and `$SPLIT` route bonding out of the critical path
  until the payment loop works end to end.

## Status

Phase 4 has started. Phase 2 implemented architecture Milestone 0 by importing the
protocol package and deterministic test vectors from `splitx402/ffff`. Phase 3
implemented the x402 extension, Express adapter, demo merchant, agent SDK, demo
agent, and Devnet paid-suite proof. The current Phase 4 slice adds the first
`@split402/control-plane` receipt ingestion domain for signed receipt verification,
idempotent accrual creation, duplicate/conflict handling, a public
`POST /v1/receipts` ingestion API, and a zero-sum ledger model, plus the first
PostgreSQL receipt/accrual/ledger migration.

An existing-token Devnet paid-suite proof is recorded in
[`docs/proofs/phase3-paid-suite-2026-06-24.md`](docs/proofs/phase3-paid-suite-2026-06-24.md).

No production contracts or mainnet payment flows exist yet.

## Docs

- [Canonical architecture spec](docs/reference/split402_protocol_architecture_v0.1.md)
- [Architecture alignment note](docs/SPLIT402_ARCHITECTURE.md)
- [Phase 0 status](docs/PHASE_0.md)
- [Phase 1 status](docs/PHASE_1.md)
- [Phase 2 status](docs/PHASE_2.md)
- [Phase 3 status](docs/PHASE_3.md)
- [Phase 4 status](docs/PHASE_4.md)
- [MVP build plan](docs/BUILD_PLAN.md)
- [Architecture baseline decision](docs/decisions/0003-adopt-architecture-and-ffff-baseline.md)
- [Roadmap](docs/ROADMAP.md)
- [Security policy](SECURITY.md)

## Development

Use Corepack/pnpm for workspace commands:

```bash
corepack enable
corepack pnpm install
corepack pnpm dev
```

Useful checks:

```bash
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm vectors:check
corepack pnpm audit
```

By default the temporary service runs in `SPLIT402_PAYMENT_MODE=mock`, which emits
x402-shaped HTTP 402 challenges and accepts deterministic mock payment payloads for
local tests. Use `SPLIT402_PAYMENT_MODE=x402` only when exercising the older Phase 1
facilitator-backed path.
