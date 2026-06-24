# 0001: Phase 0 Protocol Decisions

Date: 2026-06-24
Status: superseded by 0003 where it conflicts with the Split402 architecture spec

## Context

This decision captured the first repository setup assumptions before the local
Split402 architecture spec and the `splitx402/ffff` implementation baseline were
made canonical for this repo.

The original decision used temporary repo-name-based naming and chose a narrower
Base/EVM-first skeleton. That helped get a runnable HTTP service started, but it is
not the canonical Split402 MVP scope.

## Superseded Choices

The following choices are superseded by
[`0003`](0003-adopt-architecture-and-ffff-baseline.md):

- project/protocol naming that did not preserve Split402;
- Base Sepolia as the first product network;
- repo-name-based extension/discovery naming;
- SQLite as the MVP source of truth;
- deferring the protocol package and shared test vectors.

## Still Useful

These principles remain consistent with the architecture spec:

- TypeScript on Node.js for the first implementation;
- x402 v2 `exact` before any custom split scheme;
- extension-first compatibility with existing x402 clients;
- one gross merchant settlement in the MVP;
- idempotency through the x402 `payment-identifier` extension;
- signed receipts and a durable commission ledger before mainnet use;
- atomic split settlement only after the accrual-and-payout loop is proven.
