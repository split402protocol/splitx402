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

## Relationship To `ffff`

`splitx402/ffff` is not a different product direction. It is the first implementation
repo built from the Split402 architecture. This repository continues that work as the
v2 implementation line.

Phase 2 starts by preserving the `ffff` protocol package and deterministic test
vectors. Future phases port the extension, demo merchant, demo agent, control plane,
ledger, payout engine, dashboard, discovery, route bonding, and `split-exact`
research in the order defined by the architecture spec.
