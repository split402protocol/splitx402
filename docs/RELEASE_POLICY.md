# Release Policy

Split402 has no supported public release yet. The repository is currently a
public-alpha protocol foundation and reference implementation.

## Current Policy

- Do not publish npm packages, container images, hosted endpoints, or release
  tags as supported artifacts until a release decision is recorded.
- Keep every workspace package marked `"private": true` until the package has a
  versioning plan, support statement, registry policy, and launch approval.
- Do not claim production readiness, mainnet readiness, custody readiness, or
  commercial hosted availability from `main`.
- Use Apache-2.0 for the public repository. Keep private hosted operations,
  provider strategy, custody evidence, private URLs, credentials, and live
  transaction bytes outside the public license surface.

## Release Candidate Requirements

A release candidate must have:

- clean CI on the source commit;
- `corepack pnpm product:local-proof --brief` passing from a clean checkout;
- current protocol test vectors;
- signed-object and schema changes documented in `docs/decisions/` when
  applicable;
- public/private and license review completed from the launch checklist;
- no private operations, secrets, live transaction bytes, private URLs, partner
  details, or custody evidence in the public tree;
- explicit package/container artifacts selected for release;
- a support statement describing what is and is not supported.

## Public-Alpha Hosted Demo Requirements

Before a hosted public-alpha demo is announced:

- Phase 7 hosted proof must pass from the same source commit and hosted
  environment;
- the proof must include agent discovery, paid request, receipt verification,
  referrer balance, dashboard summary, webhook delivery, payout obligation,
  funding balance, MCP gateway evidence, commands run, and human approval;
- approval remains `no-go` until every proof gate is ready.

## Production Or Mainnet Requirements

Before production custody or mainnet use:

- Phase 6 custody evidence must pass with reviewed signer policy, private
  networking, key custody, smoke tests, incident drills, rollback drills,
  reconciliation drills, RPC failover, and image provenance;
- Phase 7 hosted proof must be approved;
- release notes must keep the non-atomic MVP trust boundary clear;
- counsel should review license, commercial terms, and support obligations.

## Publishing Checklist

Before publishing any public artifact:

```bash
corepack pnpm lint
corepack pnpm product:github-settings-review --template > split402-launch-evidence/github-settings-review.txt
corepack pnpm product:github-settings-review
corepack pnpm product:public-surface-check --brief
corepack pnpm repo:guard
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm vectors:check
corepack pnpm audit --audit-level high
corepack pnpm product:local-proof --brief
corepack pnpm product:launch-checklist --brief --workspace split402-launch-evidence
corepack pnpm product:status --brief --workspace split402-launch-evidence
```

`product:status` must stay `no-go` until real hosted and custody evidence is
provided. A passing local proof is necessary, but it does not approve public launch,
production custody, or mainnet use.
