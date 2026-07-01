# 0010: EVM Payment Identifiers In Signed Artifacts

## Status

Accepted for public alpha.

## Context

Split402 external x402 onboarding can discover Base/CDP x402 routes, but the
initial signed offer and receipt schemas only accepted Solana/base58 payment
asset and wallet identifiers. That meant a Base x402 route could expose valid
x402 exact payment metadata but still fail Split402 offer parsing once it added
`extensions.split402.info`.

## Decision

`Split402OfferV1` and `Split402ReceiptV1` now accept payment-settlement
identifiers in either of these forms:

- Solana/base58 public-key strings;
- EVM `0x` addresses.

This applies to offer `asset` and `payToWallet`, and to receipt `asset`,
`payerWallet`, and `payToWallet`.

Referral identity fields remain Solana Ed25519/base58 in this public-alpha
schema. Signing domains, signed field names, and canonical signing bytes are not
changed.

## Consequences

Base/EVM x402 providers can become router-ready after they return a valid
signed Split402 offer and merchant-signed receipt with matching EVM identifiers.
This does not approve production custody, hosted operations, or mainnet use.
Those remain gated by Phase 6 custody evidence and Phase 7 hosted proof.
