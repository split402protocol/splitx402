# GitHub Public Profile

This file is the canonical public GitHub profile contract for
`split402protocol/splitx402`. Keep the repository About box aligned with this
file before public-alpha launch announcements.

## Repository Metadata

Description: Agent payment routing and verifiable referral accounting for x402 APIs.

Homepage: unset until a hosted public docs or demo URL is live and proof-gated.

Topics:

- agents
- mcp
- payments
- protocol
- solana
- typescript
- usdc
- x402

License: Apache-2.0 for the public repository. Private hosted operations,
production custody infrastructure, provider strategy, real staging evidence,
and commercial deployment details remain outside this public license surface.

## Launch Boundary

The public GitHub repository should present Split402 as an open protocol
foundation and public-alpha implementation. It should not present the private
hosted router, commercial provider strategy, custody operations, production
dashboard, or real staging/mainnet evidence as public repository contents.

## Contributor Metadata

Contributors are generated from commit author metadata in Git history. The
README cannot hide or rename that box. Before a real launch, keep new commits on
the organization identity and avoid rewriting public history unless there is an
explicit migration plan and every collaborator understands the force-push risk.

## Maintenance

Recommended GitHub UI settings:

- About description: use the exact Description line above.
- Website: leave blank until hosted evidence is ready.
- Topics: use the exact topic list above.
- Releases and packages: publish only when installable artifacts are ready.

Run this check before launch-facing updates:

```bash
corepack pnpm product:public-surface-check --brief
```
