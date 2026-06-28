# 0008: Payout Allocation Release Boundary

Status: accepted

Date: 2026-06-26

## Context

Payout batches move commission accruals from `available` to `allocated` so the
same earnings cannot be selected twice. If planning, signing, or pre-submission
checks fail, those allocations can otherwise remain stuck even though no payment
was safely submitted.

## Decision

Add an explicit release operation for payout batches:

```text
POST /v1/payout-batches/:batchId/release-allocations
```

The operation is allowed only for safe statuses:

```text
draft, planned, signing, failed, cancelled
```

It is blocked for statuses where payment may already be in flight or final:

```text
submitted, confirmed, finalized, outcome_unknown
```

When release succeeds, the batch becomes `cancelled`, its payout items become
`released`, and allocated commission accruals mapped to those items return to
`available`.

## Consequences

- A signer-policy failure, byte-verification failure, or pre-submission funding
  issue can be unwound without losing referrer earnings.
- Ambiguous chain outcomes remain fail-closed. `outcome_unknown` cannot release
  allocations until a future reconciliation policy proves release is safe.
- Release is not a payout retry system and does not make production custody
  approved.
