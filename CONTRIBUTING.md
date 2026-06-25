# Contributing

Split402 is early-stage protocol infrastructure. Contributions should preserve the
project's current bias: compatibility first, explicit decisions, and testable payment
invariants.

## Working Principles

- Prefer x402 compatibility over custom protocol surface.
- Record protocol-impacting choices in `docs/decisions/`.
- Add tests before expanding payment or payout behavior.
- Keep mainnet deployment out of scope until replay, mutation, idempotency, and
  reconciliation checks are passing.

## Local Development

Expected local commands:

```bash
corepack pnpm install
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm vectors:check
```

For persistence work, also run the opt-in PostgreSQL harness against an empty test
database:

```powershell
$env:SPLIT402_TEST_DATABASE_URL="postgresql://split402:split402@localhost:5432/split402_test"
corepack pnpm test:postgres
```

## Pull Requests

Each pull request should include:

- a short summary of what changed;
- the decision or issue it supports;
- validation performed;
- any protocol, security, or migration concerns.
