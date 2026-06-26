# 0004: Protocol Fee Basis Points Of Commission

Status: accepted

Date: 2026-06-26

## Context

Split402 campaigns already carried a protocol-fee concept, and the ledger
already had a `protocol_fee_payable` account. The signed offer, signed receipt,
receipt arithmetic, x402 extension, SDK parsing, and test vectors did not carry
one canonical protocol-fee field end to end, so protocol fee effectively behaved
as zero in the enforceable receipt path.

Split402's public-alpha business model is a share of the referral commission,
not a share of the buyer's gross x402 payment.

## Decision

Use one canonical signed field:

```ts
protocolFeeBpsOfCommission: number;
```

The calculation is:

```text
commission = floor(requiredAmountAtomic * commissionBps / 10_000)
protocolFee = floor(commission * protocolFeeBpsOfCommission / 10_000)
referrerCredit = commission - protocolFee
```

This field is present on signed offers and signed receipts. Receipt arithmetic
verification rejects receipts whose `commissionAmountAtomic`,
`protocolFeeAtomic`, or `referrerCreditAtomic` do not match the signed basis
points and required amount.

Campaign input may still accept deprecated `protocolFeeBps` during the
transition, but it is normalized to `protocolFeeBpsOfCommission`. If both fields
are supplied with different values, campaign creation fails.

## Consequences

- Test vectors include `protocolFeeBpsOfCommission` in signed offer and receipt
  objects.
- Referrer accruals are created for `referrerCreditAtomic`, not the gross
  commission amount.
- Ledger ingestion records:
  - merchant commission liability as the negative full commission;
  - referrer payable as the referrer credit;
  - protocol fee payable as the protocol fee.
- Documentation must not describe protocol fee as basis points of gross payment
  unless the protocol is explicitly versioned.

## Non-Goals

This decision does not introduce atomic split settlement, protocol-token
bonding, governance, or a custom facilitator.
