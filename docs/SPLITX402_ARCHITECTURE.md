# SplitX402 Architecture Opinion

## My Read

x402 is a good foundation for this because it keeps payments in the normal HTTP
request-response loop. In v2, the protocol is explicitly split into core types,
scheme/network logic, and transport representation. That is exactly the modularity
SplitX402 should use.

My strong opinion: do not fork x402 for the MVP. Build SplitX402 as an extension and
service layer around x402. Normal buyers should still see a standard
`PaymentRequired` object, choose a supported `accepts` entry, sign one
`PaymentPayload`, and retry the request with `PAYMENT-SIGNATURE`.

## What SplitX402 Adds

SplitX402 should add revenue allocation, not a new payment rail.

The core product primitive is a split manifest:

```json
{
  "version": 1,
  "splitId": "spl_...",
  "allocationId": "alloc_...",
  "recipients": [
    { "address": "0x...", "bps": 7000, "role": "provider" },
    { "address": "0x...", "bps": 2000, "role": "creator" },
    { "address": "0x...", "bps": 1000, "role": "platform" }
  ],
  "totalBps": 10000,
  "expiresAt": 1790000000,
  "digest": "0x..."
}
```

This manifest should be advertised in `PaymentRequired.extensions.splitx402`. The
resource server should also bind its digest into the internal payment record, receipt,
and payout ledger.

## MVP Flow

1. Client requests a protected resource.
2. Resource server returns HTTP 402 with standard x402 payment requirements.
3. The selected `payTo` is a merchant/vault/splitter address, not every final
   recipient.
4. `extensions.splitx402` advertises the split manifest and digest.
5. Client pays using a standard x402 scheme such as `exact`.
6. Server verifies and settles through a facilitator.
7. Server returns the resource and records a payment intent keyed by
   `payment-identifier`.
8. Split ledger allocates the settled amount by basis points.
9. Payout worker distributes funds, initially in a test/fake mode, then by onchain
   transfer batches or a splitter contract.

## Why Not Atomic Multi-Recipient First

x402 `exact` is designed around an authorization for a specific token amount and a
single recipient. Trying to force many recipients into the first version would create
client compatibility and verification risk.

For the first release, I would accept one x402 payment to a controlled settlement
address and make split distribution a verifiable downstream responsibility. Once
volume or trust requirements demand it, move `payTo` to a non-custodial split
contract or introduce a formal `split-exact` scheme.

## Main Components

- Quote builder: creates x402 `PaymentRequired` objects and attaches the split
  extension.
- Split registry: stores immutable split templates, recipient addresses, basis
  points, validity windows, and revision history.
- Payment middleware: integrates the x402 SDK/facilitator and enforces required
  extensions.
- Idempotency cache: requires `payment-identifier` and prevents double processing.
- Settlement recorder: stores facilitator settlement responses and chain tx hashes.
- Split ledger: computes and freezes recipient allocations from settled payments.
- Payout worker: executes or simulates payouts from the merchant/vault address.
- Reconciliation job: compares payment intents, settlement responses, ledger rows,
  and onchain payout state.

## Data Model Sketch

```text
SplitTemplate(id, version, status, network, asset, total_bps, created_at)
SplitRecipient(template_id, address, role, bps)
PaymentIntent(id, payment_identifier, resource_url, method, amount, asset, network,
              pay_to, split_template_id, split_digest, status)
Settlement(payment_intent_id, facilitator, tx_hash, payer, amount, response_json)
SplitAllocation(payment_intent_id, recipient, bps, amount, status)
PayoutBatch(id, network, asset, tx_hash, status, created_at)
PayoutItem(batch_id, allocation_id, recipient, amount, status)
```

## Security Opinions

- Require `payment-identifier` from day one. Retry safety is not a nice-to-have for
  payments.
- Treat split manifests as immutable once referenced by a quote.
- Sign or hash the split manifest and bind that digest to the payment intent.
- Bind payment validation to method, URL/resource identity, amount, asset, network,
  destination, and split digest.
- Fail closed if the client echoes a modified extension.
- Keep `maxTimeoutSeconds` short for fixed-price requests.
- Cache only by explicit payment id and normalized request identity.
- Build tests for replay, modified recipient, modified amount, expired quote, and
  duplicate retry before touching mainnet.
- Do not make the facilitator, resource server, or payout worker able to spend more
  than the client intended.

## What I Like

This architecture has a real wedge: x402 monetizes one resource, while SplitX402 can
monetize composed work. That matters for agentic systems where one paid response may
include data, models, tools, referrals, and creators behind the scenes.

The extension-first approach is also politically and technically healthy. It keeps the
base protocol clean, lets existing clients keep working, and gives us a path to submit
an extension or scheme later with working evidence.

## What Worries Me

The hard part is not calculating percentages. The hard part is proving that a payment,
resource delivery, split promise, and later payout all refer to the same economic
event. That means idempotency, receipts, reconciliation, and dispute handling should
be treated as first-class protocol features, not admin-panel chores.

I would also avoid over-optimizing for every chain at first. Pick one network, one
asset, one scheme, and one facilitator path. Make it boring and observable before
expanding.

## References Checked

- x402 v2 specification:
  https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md
- x402 HTTP 402 headers:
  https://docs.x402.org/core-concepts/http-402
- x402 facilitator role:
  https://docs.x402.org/core-concepts/facilitator
- x402 payment-identifier extension:
  https://docs.x402.org/extensions/payment-identifier
- x402 signed offers and receipts extension:
  https://docs.x402.org/extensions/offer-receipt
- Security preprint on x402 attack classes:
  https://arxiv.org/abs/2605.11781
