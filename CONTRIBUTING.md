# Contributing

Split402 is early-stage protocol infrastructure. Contributions should preserve
the project's bias toward x402 compatibility, explicit protocol decisions, and
testable payment invariants.

## Working Principles

- Keep the project name `Split402`.
- Prefer compatibility with standard x402 payment flows over custom settlement
  surface.
- Keep USDC referral accrual and merchant-funded payout as the MVP path.
- Record protocol-impacting choices in `docs/decisions/`.
- Treat monetary values as atomic integer amounts, never floating-point numbers.
- Add or update tests before expanding payment, receipt, ledger, or payout
  behavior.
- Keep mainnet deployment out of scope until replay, mutation, idempotency,
  verification, and reconciliation checks are passing.

## Local Development

```bash
corepack enable
corepack pnpm install
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm vectors:check
```

Focused package checks are usually faster while developing:

```bash
corepack pnpm --filter @split402/protocol test
corepack pnpm --filter @split402/control-plane test
```

## Documentation

Update the public docs when a change affects protocol behavior, package scope,
API routes, environment variables, migrations, or operational assumptions.

Relevant entry points:

- `README.md` for the public project overview;
- `docs/BUILD_PLAN.md` for implementation sequencing;
- `docs/ROADMAP.md` for phase-level status;
- `docs/PHASE_*.md` for detailed phase notes;
- `docs/decisions/` for architecture decisions.

## Pull Requests

Each pull request should include:

- a short summary of what changed;
- the phase, decision, or issue it supports;
- validation performed;
- any protocol, security, migration, or reconciliation concerns.

Prefer small, reviewable slices. If a branch depends on earlier implementation
work, make the dependency clear in the pull request description.
