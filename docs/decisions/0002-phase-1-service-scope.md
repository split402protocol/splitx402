# 0002: Phase 1 Service Scope

Date: 2026-06-24
Status: accepted

## Context

Phase 1 needs a runnable service that proves the x402 HTTP skeleton before the
project expands into split manifests, receipts, or payout logic.

The public `splitx402/ffff` repository was reviewed as a reference. It contains a
larger Split402 monorepo with protocol packages, Solana Devnet demos, signed offers,
referral claims, receipts, and generated test vectors.

## Decision

Keep this repository as a focused single-package TypeScript service for Phase 1.

Use the Phase 0 direction:

- Base Sepolia first;
- x402 v2 `exact`;
- payment-identifier required;
- one paid HTTP demo route;
- settlement recording;
- no custom split scheme yet.

Adopt only the reference ideas that improve Phase 1 without changing scope:

- explicit facilitator sync control;
- service discovery metadata;
- clear local mock mode for unpaid/paid handshake tests.

## Consequences

- The codebase remains small enough to iterate quickly.
- The first pull request can be reviewed as service infrastructure rather than a full
  protocol suite.
- We avoid copying Solana-specific assumptions into a Base Sepolia MVP.
- The reference repository remains useful later for signed receipts, test vectors,
  agent SDK shape, and referral/commission workflows.

