# @split402/test-vectors

Language-neutral fixtures for Split402 protocol compatibility checks.

The fixtures are generated from `@split402/protocol` and cover canonical hashes,
request digests, referral claims, offers, attributions, receipts, and commission
math. They are the contract that keeps SDKs, demos, and future language ports
aligned.

## Commands

```bash
corepack pnpm --filter @split402/protocol vectors
corepack pnpm --filter @split402/protocol vectors:check
```

## Status

Implemented as the deterministic protocol fixture set for the current public
alpha. Any intentional protocol behavior change should update these fixtures and
explain the change in the relevant docs or decision record.
