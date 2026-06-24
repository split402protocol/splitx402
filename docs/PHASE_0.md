# Phase 0: Repository Setup

Phase 0 created the initial repository and planning surface.

## Current Status

Status: complete.

GitHub status: live at `split402protocol/splitx402`.

## Current Interpretation

The earliest Phase 0 notes treated this as a narrower repo-name-based Base/EVM
experiment.
That is superseded by
[`0003`](decisions/0003-adopt-architecture-and-ffff-baseline.md).

The canonical project direction is Split402:

- Solana x402 `exact` payments;
- USDC-denominated paid APIs and agent tools;
- Split402 referral claims attached through x402 extension metadata;
- merchant-signed offers and receipts;
- idempotent commission accrual;
- PostgreSQL as the MVP source of truth;
- merchant-funded batched USDC payouts;
- `$SPLIT` route bonding and atomic `split-exact` settlement later.

## Phase 0 Exit Criteria

- Phase 0 decision record exists.
- Roadmap and MVP build plan are documented.
- Repository has license, security, contribution, issue, and PR templates.
- GitHub remote exists and contains the Phase 0 commits.

## Next Phase

The current implementation path is Phase 2, which maps to architecture Milestone 0:
pnpm workspace, `@split402/protocol`, deterministic test vectors, signing helpers,
receipts, request digests, and commission math.
