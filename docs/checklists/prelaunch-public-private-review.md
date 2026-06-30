# Pre-Launch Public/Private Review

Use this checklist before a real hosted launch, before publishing packages, and
before announcing the repository outside controlled public-alpha circles.

This is an operating review, not legal advice. Get counsel to review the final
license and commercial terms before mainnet custody, paid production routing, or
merchant contracts.

## Default Decision

Keep the public repository as the Apache-2.0 protocol foundation. Keep hosted
operations, custody, commercial routing, provider strategy, and live evidence
private unless a specific artifact is intentionally sanitized for release.

## Public By Default

These can stay public because integrators need to inspect or verify them:

- protocol schemas, signing bytes, hashes, verification helpers, and test
  vectors;
- SDK interfaces, x402 extension metadata, and reproducible local demos;
- router interfaces and public-alpha routing behavior;
- MCP demo gateway behavior when it is clearly labeled as demo/public-alpha;
- public architecture, roadmap, current state, security policy, and sanitized
  proof templates;
- non-secret Devnet examples.

## Private By Default

These should move to private infrastructure before launch:

- production router provider registry, ranking weights, reliability scoring,
  fraud policy, and commercial partner rules;
- hosted control-plane deployment values, private URLs, dashboard sessions,
  analytics, billing, and operator tooling;
- payout custody operations, signer secrets, funding-wallet policy, private
  network details, incident evidence, and live transaction bytes;
- merchant onboarding notes, compliance, disputes, account-risk reviews, and
  partner-identifying evidence;
- hosted MCP credentials, provider credentials, and real staging/mainnet proof
  artifacts that contain endpoints, tokens, wallets, or partner details.

## License Review

- Keep the public repository under Apache-2.0 unless counsel approves a
  different launch license.
- Do not reintroduce MIT in README, package metadata, GitHub About text, release
  notes, or package manifests.
- Keep every workspace package marked `"private": true` until that package has
  a release decision, versioning plan, npm/package registry policy, and support
  statement.
- Treat past public publication as irreversible. A license change, history
  rewrite, or private visibility change does not reliably pull back old clones,
  downloads, mirrors, or forks.

## Launch Review Questions

For every public file or artifact, answer yes before launch:

- Does this help outsiders integrate with or verify the public protocol?
- Is it free of secrets, private keys, tokens, private URLs, live transaction
  bytes, and partner-identifying details?
- Is public-alpha/mainnet status described honestly?
- Would a competitor being able to clone this file be acceptable?
- Is this covered by Apache-2.0 intentionally?

If any answer is no, keep the file private or sanitize it before publication.

## Required Commands

Run these before launch-facing updates:

```bash
corepack pnpm product:public-surface-check --brief
corepack pnpm repo:guard
corepack pnpm lint
```

The public-surface check must pass before Phase 7 hosted proof can be approved.
