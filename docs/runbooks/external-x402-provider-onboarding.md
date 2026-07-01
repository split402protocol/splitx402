# External x402 Provider Onboarding

Split402 can inspect external x402 APIs before they are Split402-ready. This is
useful for partner evaluation, but a plain x402 `Payment-Required` response is
not enough to create referral accruals.

## Metadata-Only Discovery

Run this first. It does not pay for a route.

```bash
corepack pnpm demo:discover-external-x402 https://x402.example \
  --capability crypto.price \
  --match-path /price \
  --provider-id-prefix partner \
  --merchant-public-key <merchant-offer-receipt-public-key> \
  --artifacts-dir split402-provider-artifacts
```

The report lists candidate route paths, HTTP methods, network, asset,
amountAtomic, pay-to wallet, readiness, blockers, required Split402 offer
fields, and provider next actions.

When `--artifacts-dir` is supplied, discovery also writes per-candidate provider
files:

```text
split402-provider-artifacts/
  manifest.json
  partner_get.price/
    README.md
    campaign-terms.template.json
    unsigned-offer.template.json
    receipt.template.json
```

These files are safe scaffolds, not signed production artifacts. Providers
should finalize campaign ids, merchant ids, economics, timestamps, nonce, and
`kid`; compute the real campaign terms hash; sign the offer; then validate the
public artifacts before paid staging.

When x402 payment metadata is complete but Split402 metadata is missing or not
yet trusted, candidate output also includes `split402OfferTemplate`. This is a
non-secret scaffold built from the detected x402 route fields. It shows the
`campaignTermsTemplate`, the `unsignedOfferTemplate`, and the signing steps
needed to populate `extensions.split402.info`. Providers must replace
placeholder ids/timestamps/economics, compute the real campaign terms hash, sign
the offer, and publish only the public verification key for the offer `kid`.

Candidate output also includes `split402ReceiptTemplate` whenever complete x402
payment metadata is readable. This shows the merchant-signed receipt shape the
provider must return after a successful paid request. Settlement-specific fields
such as `paymentId`, `payerWallet`, `settlementTxSignature`, `settledAt`, route
attribution, and `requestDigest` remain placeholders until the paid call
settles.

You can also provide the verification key with
`SPLIT402_EXTERNAL_X402_MERCHANT_PUBLIC_KEY`. This is a public key only. Do not
put merchant private keys, bearer tokens, raw payment payloads, facilitator
secrets, or private settlement evidence into CLI args, environment captures, or
public issue comments.

If `extensions.split402.info` is present but malformed, discovery reports
`invalid Split402 offer extension` and includes `split402OfferErrors` with the
field paths that failed schema validation. That is different from
`missing Split402 offer extension`, which means no Split402 offer was found in
the unpaid `402 Payment Required` response.

If the Split402 offer parses but disagrees with the x402 `accepts` metadata,
discovery reports `Split402 offer does not match x402 payment metadata`. The
signed offer must match the x402 exact payment metadata for `network`, `asset`,
`payToWallet`, and `requiredAmountAtomic`; `resourceOrigin` must match the
external merchant origin being discovered.

If the offer parses and matches x402 metadata, discovery still requires a
merchant verification public key before it can mark the candidate `router_ready`.
The offer must verify against the active merchant `offer_receipt` key. Missing
or mismatched keys are reported as signature blockers and must be fixed before
paid staging.

The same check is available through the MCP gateway tool
`split402.discoverExternalX402`:

```json
{
  "merchantOrigin": "https://x402.example",
  "capability": "crypto.price",
  "matchPath": "/price",
  "providerIdPrefix": "partner",
  "merchantPublicKey": "<merchant-offer-receipt-public-key>"
}
```

After building a signed offer and, later, a signed receipt, providers can run a
local no-secrets artifact check before asking Split402 to rerun discovery or
paid staging:

```bash
corepack pnpm demo:validate-external-x402-artifacts -- \
  --merchant-origin https://x402.example \
  --operation-id get.price \
  --network eip155:8453 \
  --asset 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  --pay-to-wallet 0x68614873C5d624c07DCAA3aFF5243DD5027c3910 \
  --required-amount-atomic 10000 \
  --merchant-public-key <merchant-offer-receipt-public-key> \
  --offer-file offer.json \
  --campaign-terms-file campaign-terms.json \
  --receipt-file receipt.json
```

The campaign terms and receipt files are optional while validating the unpaid
`402 Payment Required` offer response, but `campaign-terms.json` is recommended.
When supplied, the validator recomputes the canonical `campaignTermsHash` and
checks that it matches the signed offer and optional receipt. The validator
checks public JSON artifacts only: schema, merchant signature, x402 route
metadata binding, campaign terms hash binding, offer/receipt consistency, and
receipt arithmetic. It never needs private keys, bearer tokens, raw payment
payloads, facilitator secrets, or private settlement evidence.

The same check is exposed to MCP clients as
`split402.validateExternalX402Artifacts`. Pass the same route metadata,
`merchantPublicKey`, `offer`, optional `campaignTerms`, and optional `receipt`
as JSON tool arguments.

Readiness meanings:

| Readiness | Meaning |
| --- | --- |
| `router_ready` | The route includes enough Split402 metadata to become a receipt-verified router provider. |
| `requires_split402_campaign` | The route is a real x402 candidate but lacks a Split402 offer extension. |
| `incomplete_payment_metadata` | The route did not expose complete x402 exact payment metadata. |

Common blockers:

| Blocker | Meaning |
| --- | --- |
| `missing Split402 offer extension` | Add `extensions.split402.info` to the unpaid 402 response. |
| `invalid Split402 offer extension` | The extension exists, but one or more signed offer fields failed validation. Check `split402OfferErrors`. |
| `Split402 offer does not match x402 payment metadata` | The signed offer parses, but its payment fields disagree with the x402 `accepts` metadata. Check `split402OfferErrors`. |
| `missing merchant public key for Split402 offer verification` | The offer cannot be trusted until the merchant verification key is configured. |
| `invalid Split402 offer signature` | The offer did not verify against the configured merchant public key. |
| `missing complete x402 exact payment metadata` | The x402 `accepts` metadata is missing `network`, `asset`, `amount`, or `payTo`. |

Base/EVM x402 candidates can become router-ready when the unpaid response
includes a valid signed Split402 offer and the paid response returns a
merchant-signed Split402 receipt with matching EVM asset and wallet identifiers.
That still proves public-alpha compatibility only; production, custody, and
mainnet claims remain gated by Phase 6 and Phase 7 evidence.

## Current Issue #131 Shape

The live candidate at `https://x402.167-172-95-184.nip.io` currently exposes
Base x402 exact routes. The lowest-cost price routes discovered by Split402 are:

| Path | Network | Asset | Amount Atomic | Status |
| --- | --- | --- | --- | --- |
| `/price` | `eip155:8453` | Base USDC token address | `10000` | `requires_split402_campaign` |
| `/price/btc` | `eip155:8453` | Base USDC token address | `20000` | `requires_split402_campaign` |

Both routes currently block on `missing Split402 offer extension`.
Discovery will include a `split402OfferTemplate` for each route once the x402
payment metadata is readable. The template is safe to share because it contains
placeholders and public route metadata only; it is not a signed offer and must
not be treated as production evidence.
Discovery will also include a `split402ReceiptTemplate` with the expected
commission math for the detected amount. For `/price` at `10000` atomic units
with the default public-alpha example economics, the template shows a `2000`
atomic commission, `200` atomic protocol fee, and `1800` atomic referrer credit.

## What The Provider Must Add

To become Split402-ready, the unpaid x402 `402 Payment Required` response must
include a Split402 offer extension:

```json
{
  "extensions": {
    "split402": {
      "info": {
        "protocolVersion": "0.1",
        "campaignId": "cmp_...",
        "campaignVersion": 1,
        "campaignTermsHash": "sha256:...",
        "merchantId": "mer_...",
        "operationId": "price.btc",
        "resourceOrigin": "https://x402.example",
        "network": "eip155:8453",
        "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        "payToWallet": "0x...",
        "requiredAmountAtomic": "20000",
        "commissionBps": 2000,
        "protocolFeeBpsOfCommission": 1000,
        "commissionBase": "required_amount",
        "settlementMode": "accrual",
        "attributionRequired": true,
        "allowSelfReferral": false,
        "offerNonce": "ofn_...",
        "issuedAt": "2026-07-01T00:00:00.000Z",
        "validUntil": "2026-07-01T00:05:00.000Z",
        "kid": "kid_...",
        "signature": "..."
      }
    }
  }
}
```

The provider must also return a merchant-signed Split402 receipt after a paid
request settles. Without that receipt, the router must fail closed and no
referral accrual should be created.

The receipt must bind to the same campaign terms, x402 payment identifiers,
request digest, settled payer, settlement transaction, offer nonce, route
attribution, commission arithmetic, and merchant signing key. If no referral
route is accepted, omit all route attribution fields together and set
`commissionAmountAtomic`, `protocolFeeAtomic`, and `referrerCreditAtomic` to
`0`.

For external providers, Split402 onboarding must also know the merchant public
key that verifies both the signed offer and the later receipt. A syntactically
valid offer is not router-ready until this signature verification passes.

## Public-Alpha Boundary

This onboarding flow is public-alpha only. It proves discovery and compatibility
classification. It does not approve production use, mainnet custody, hosted
router operations, or commercial payout obligations.
