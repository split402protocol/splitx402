# Current State

Split402 is a public-alpha implementation of referral attribution and commission
accounting for x402-paid APIs.

In simple words: an agent pays a merchant through normal x402 USDC settlement and
attaches a signed Split402 referral claim. The merchant still receives the gross
x402 payment. Split402 records the referral commission as an auditable payable,
verifies the settlement, and later pays accumulated commissions from a
merchant-funded payout flow.

## What Is Built

```mermaid
flowchart LR
  Protocol["Protocol core"]
  Demo["x402 demo flow"]
  SDKs["Agent and merchant SDKs"]
  Control["Control plane"]
  Verification["Chain verification"]
  Payouts["Payout engine"]

  Protocol --> Demo
  Protocol --> SDKs
  Demo --> Control
  SDKs --> Control
  Control --> Verification
  Verification --> Payouts
```

| Area | State |
| --- | --- |
| Protocol primitives | Implemented: schemas, hashes, IDs, amount math, operation digests, signatures, and test vectors. |
| x402 integration | Implemented: Split402 offers, referral claims, request digests, and receipts around standard x402 settlement. |
| Demo path | Implemented for Solana Devnet paid-suite proof runs. |
| Agent SDK | Implemented for offer inspection, claim creation, paid calls, and receipt verification. |
| Merchant SDK | Implemented for campaign caching, service-key rotation helpers, payment identifiers, operation digests, and receipt outbox primitives. |
| Control plane | Implemented foundation: receipt ingestion, merchant/campaign/route registries, wallet auth, PostgreSQL persistence, outbox workers, chain verification, and signed webhooks for accepted receipts and payout lifecycle events. |
| Payout engine | In progress: preview, allocation, Solana transfer planning, simulation, signer policy, local-dev signer, remote signer client, signer appliance scaffold, signer deployment artifacts, signed-byte persistence, broadcast boundary, finality monitor, rollup, lifecycle events, unknown-outcome reconciliation queue, referrer payout views, and ledger closure are present. |

## What Is Not Built Yet

- The original x402 payment is not atomically split onchain in the MVP.
- `$SPLIT` route bonding is not in the critical path yet.
- Mainnet production operation is not approved.
- Phase 6 still needs staging deployment validation, custody review, and
  incident-response review before any mainnet payout custody.

## Current Direction

The near-term objective is to finish the USDC accrual-and-payout loop before
researching atomic `split-exact` settlement or token-bonded route discovery.
