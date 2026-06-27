# Phase 2: Protocol Core And Test Vectors

Phase 2 is the first implementation slice of the revised Split402 plan. It maps to
Milestone 0 in the architecture spec:

- initialize pnpm monorepo and strict shared TypeScript config;
- implement `@split402/protocol`;
- add deterministic shared test vectors;
- prove canonicalization, signing, receipts, request digests, and commission math.

## Current Status

Status: implemented as the protocol-core baseline.

## What Changed

- Vendored the canonical architecture spec into
  `docs/reference/split402_protocol_architecture_v0.1.md`.
- Added `packages/protocol` as the compatibility baseline.
- Added `packages/test-vectors`.
- Converted the repo to a pnpm workspace.
- Added root scripts for protocol vector generation and vector checking.
- Updated CI to install and test through pnpm.
- Corrected visible project naming to Split402.

## Why This Comes First

The x402 extension, merchant demo, agent SDK, control plane, and payout worker all
depend on stable protocol artifacts. The first v2 step is therefore to preserve
known-good artifact behavior before changing extension or demo behavior.

## Boundary

This phase should not redesign Split402. The architecture spec defines the scope,
and this branch establishes the deterministic protocol floor for follow-up work.

## Acceptance Checks

- `corepack pnpm lint`
- `corepack pnpm typecheck`
- `corepack pnpm test`
- `corepack pnpm build`
- `corepack pnpm vectors:check`
- `corepack pnpm audit`
