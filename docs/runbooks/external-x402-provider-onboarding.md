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
  --provider-id-prefix partner
```

The report lists candidate route paths, HTTP methods, network, asset,
amountAtomic, pay-to wallet, readiness, blockers, required Split402 offer
fields, and provider next actions.

If `extensions.split402.info` is present but malformed, discovery reports
`invalid Split402 offer extension` and includes `split402OfferErrors` with the
field paths that failed schema validation. That is different from
`missing Split402 offer extension`, which means no Split402 offer was found in
the unpaid `402 Payment Required` response.

The same check is available through the MCP gateway tool
`split402.discoverExternalX402`:

```json
{
  "merchantOrigin": "https://x402.example",
  "capability": "crypto.price",
  "matchPath": "/price",
  "providerIdPrefix": "partner"
}
```

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

## Public-Alpha Boundary

This onboarding flow is public-alpha only. It proves discovery and compatibility
classification. It does not approve production use, mainnet custody, hosted
router operations, or commercial payout obligations.
