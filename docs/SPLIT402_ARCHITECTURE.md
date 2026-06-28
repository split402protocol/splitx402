# Split402 Architecture Alignment

The canonical architecture source for this repo is:

- [`reference/split402_protocol_architecture_v0.1.md`](reference/split402_protocol_architecture_v0.1.md)

That spec defines Split402 as a referral, attribution, and commission layer for
x402-paid APIs and agent tools on Solana.

## MVP Shape

The MVP does not change x402 settlement semantics:

1. Buyer or agent requests a paid resource.
2. Merchant returns normal x402 `402 Payment Required` plus a Split402 extension.
3. Buyer attaches a signed referral claim to the x402 payment payload.
4. Existing x402 Solana `exact` settlement pays the merchant in USDC.
5. Merchant signs a Split402 receipt and records a commission liability.
6. Merchant-funded payout worker periodically pays referrers in USDC.

## What Is Not In The Critical Path

- `$SPLIT` route bonding;
- Anchor programs;
- custom facilitators;
- atomic split settlement;
- cross-chain or fiat payout rails.

Those are later milestones after the USDC referral-payment loop works end to end.

## Historical Baseline

This repository is now the canonical public Split402 implementation repository.

Phase 2 started by preserving deterministic protocol package behavior and test
vectors. The current repository has since evolved the x402 extension, demo
merchant, demo agent, agent SDK, control plane, merchant SDK, ledger, outbox
workers, chain verification, and the first payout-engine boundaries, including
payout lifecycle outbox/webhook events, local-dev signer wiring, remote signer
client wiring, signer deployment artifacts, machine-checkable custody review
gates, an unknown-outcome reconciliation queue, referrer payout views, Phase 7
dashboard/discovery surfaces, hosted-staging proof tooling, and dashboard
viewer-session gating for evidence capture. `$SPLIT` route bonding and
`split-exact` atomic settlement remain later milestones.
