# Contributing

SplitX402 is early-stage protocol infrastructure. Contributions should preserve the
project's current bias: compatibility first, explicit decisions, and testable payment
invariants.

## Working Principles

- Prefer x402 compatibility over custom protocol surface.
- Record protocol-impacting choices in `docs/decisions/`.
- Add tests before expanding payment or payout behavior.
- Keep mainnet deployment out of scope until replay, mutation, idempotency, and
  reconciliation checks are passing.

## Local Development

The implementation scaffold has not landed yet. Until Phase 1 begins, documentation
changes are the primary contribution type.

Expected Phase 1 commands:

```bash
npm install
npm test
npm run lint
npm run typecheck
```

## Pull Requests

Each pull request should include:

- a short summary of what changed;
- the decision or issue it supports;
- validation performed;
- any protocol, security, or migration concerns.

