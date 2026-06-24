# 0002: Phase 1 Service Scope

Date: 2026-06-24
Status: superseded by 0003 where it conflicts with the Split402 architecture spec

## Context

Phase 1 needed a runnable service that proved the x402 HTTP skeleton before the
project expanded into full Split402 protocol packages, referral claims, receipts,
control-plane storage, or payout logic.

The public `splitx402/ffff` repository and the local architecture spec define the
broader Split402 direction: Solana Devnet demos, signed offers, referral claims,
receipts, deterministic test vectors, persistent ingestion, ledger accounting, and
merchant-funded payouts.

## Decision

Keep the Phase 1 service as a temporary runnable HTTP host and test target. Do not
treat its narrower EVM/Base assumptions as the Split402 product direction.

The Phase 1 service should use the canonical Split402 name in visible metadata:

- `GET /.well-known/split402.json`;
- service name `Split402`;
- `SPLIT402_*` environment variables.

## Consequences

- Phase 1 remains useful for local handshake tests.
- Phase 2 can port the `ffff` protocol package and test vectors without being blocked
  by the service skeleton.
- Later phases should replace or absorb the skeleton into the Solana Devnet merchant
  demo described by the architecture spec.
