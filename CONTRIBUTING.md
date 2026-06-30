# Contributing

Split402 is early-stage protocol infrastructure. Contributions should preserve the
project's current bias: compatibility first, explicit decisions, and testable payment
invariants.

## Working Principles

- Prefer x402 compatibility over custom protocol surface.
- Preserve Split402 as the protocol and product name. Use `splitx402` only when
  referring to the literal GitHub repository path.
- Record protocol-impacting choices in `docs/decisions/`.
- Add tests before expanding payment or payout behavior.
- Keep mainnet deployment out of scope until replay, mutation, idempotency, and
  reconciliation checks are passing.
- Keep production operations, custody evidence, private endpoints, provider
  credentials, and commercial router strategy outside the public repository
  unless a sanitized artifact is intentionally approved for release.
- Contributions to this public repository are submitted under Apache-2.0 unless
  an explicit written agreement says otherwise.
- `corepack pnpm repo:guard` rejects tracked launch evidence, raw environment
  files, and common private key or credential artifacts.

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

## Issues

Use the structured GitHub issue forms for public bug reports, integration
questions, and roadmap phase tasks. Do not open public issues for suspected
vulnerabilities, private keys, replay or settlement bypasses, payout
duplication, auth/session weaknesses, private URLs, provider credentials, live
transaction bytes, partner details, or custody evidence.

Use GitHub Security Advisories for private vulnerability reports.
