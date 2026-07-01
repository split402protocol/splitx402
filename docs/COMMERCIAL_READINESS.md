# Commercial Readiness

Split402 is not commercially launched yet. This document defines the public
commercial boundary that must stay true before Split402 is offered to real
merchants, referrers, agents, or hosted-tool providers.

## Current Commercial Status

- Public alpha only.
- No supported public release yet.
- No production hosted service commitment.
- No production custody approval.
- No production mainnet approval.
- Workspace packages remain `"private": true` until a release decision is
  recorded.

The current MVP is referral attribution and commission accounting around normal
x402 payments. It is not atomic on-chain payment splitting. The merchant
receives the gross x402 payment, Split402 verifies signed attribution evidence,
records a commission liability, and later pays referrers through a
merchant-funded payout flow after verification and custody gates.

## Required Public Disclosures

Before any customer-facing launch, public terms and onboarding material must
state all of the following:

- Split402 does not guarantee atomic on-chain split settlement in the MVP.
- A valid Split402 receipt proves a merchant-signed commission obligation, not
  that the merchant payout wallet is solvent.
- Referrers are exposed to merchant solvency, payout delay, chain verification,
  payout policy, and dispute/reversal risk.
- Protocol fees are calculated from the referral commission, using
  `protocolFeeBpsOfCommission`.
- Public-alpha integrations are experimental and may require schema, SDK,
  router, dashboard, or payout changes before production use.
- Production custody, hosted operations, and mainnet use require Phase 6 and
  Phase 7 approval before any customer-facing launch claim.

## Commercial Terms Still Needed

The first customer-ready terms package must cover:

| Area | Required decision |
| --- | --- |
| Merchant obligation | When a merchant owes commission, how long it remains payable, and what evidence controls disputes. |
| Referrer risk | Clear acknowledgement that commissions are later payables, not immediate atomic splits. |
| Payout schedule | Minimum payout thresholds, payout cadence, funding-deficit handling, retry policy, and failed-payout treatment. |
| Protocol fee | Fee rate, fee base, rounding, collection timing, refunds, and whether fees change by campaign. |
| Reversals and disputes | Who can reverse, hold, reject, or claw back accruals, and what evidence is required. |
| Merchant funding | Required payout-wallet funding, deficit visibility, notices, and suspension rules. |
| Provider listing | Criteria for router listing, delisting, reliability scoring, and provider metadata freshness. |
| Data and privacy | What wallet, payment, route, receipt, webhook, dashboard, and analytics data is stored. |
| Support | Supported versions, response expectations, vulnerability reporting, and public-alpha limitations. |
| Jurisdiction and compliance | Entity, governing law, sanctions/compliance posture, taxes, and accounting responsibility. |

## Pre-Launch Commercial Gate

Commercial launch remains blocked until all are true:

```text
[ ] Phase 7 hosted public-alpha proof is approved from the same source commit.
[ ] Phase 6 custody evidence is approved for the deployed payout signer path.
[ ] GitHub public/private/license review is approved.
[ ] Public terms disclose the non-atomic MVP trust boundary.
[ ] Public terms disclose merchant solvency and later-payout risk.
[ ] Public terms define payout schedule, funding deficits, disputes, reversals, and fees.
[ ] Package/release policy identifies which artifacts are supported.
[ ] Mainnet canary, if any, is approved separately and does not claim production launch.
```

Until this gate passes, use this language:

```text
Split402 is public alpha. It provides verifiable referral attribution and
commission accounting for x402 APIs. It is not production ready, not mainnet
approved, and the MVP does not atomically split the original x402 payment
onchain.
```
