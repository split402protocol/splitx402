# Phase 3 Paid-Suite Proof: 2026-06-24

This records a local Solana Devnet paid-suite run for the Split402 single-merchant
demo path.

## Commands

```bash
corepack pnpm demo:setup-existing-token
corepack pnpm demo:paid-suite
```

## Setup

- Network: Solana Devnet
- Merchant origin: `http://127.0.0.1:4021`
- Merchant service public key: `FAe4sisG95oZ42w7buUn5qEE4TAnfTTFPiguZUHmhiF`
- Buyer and merchant pay-to wallet: `2woK4pN17RUrpj2FU8JX6B4orCNWTyaet2TWqqsG6gpU`
- Payment asset: `5GjxfPVysU13H9SKizkTdd3pjYU4Str9x37CEFKAqjcN`
- Required amount: `1`
- Commission bps: `10000`

The `setup-existing-token` fixture uses a disposable Devnet key and token balance.
No private key material is recorded here.

## Preflight

- `readyForPaidRun`: `true`
- Merchant health: `200`
- x402 challenge status: `402`
- Split402 offer verification: `true`
- Merchant token account count: `1`
- Buyer token account count: `1`
- Buyer token atomic balance: `1`

## Valid Claim Receipt

- Receipt ID: `rcp_e6f744bb0cd36df716161acf34dccb31`
- Payment ID: `pay_aa734bd213965903087b5501df7d5be4`
- Receipt verified: `true`
- Referral credit status: `credited`
- Commission bps: `10000`
- Commission amount atomic: `1`
- Referrer credit atomic: `1`
- Settlement transaction signature:
  `JGu3gEytFWCzQi4BxtvSWqQ8QmfnbadNAtzF8Fx5ax7oYU9iY5r1NdZqv3PjG3qs6Lz6bHg2Dc9jfRRk9YtRwf3`
- Route ID: `rte_00000000000000000000000000000003`

## Invalid Claim Receipt

- Receipt ID: `rcp_3d51de72528bf69dec393a0db20d5be9`
- Payment ID: `pay_a9453e9cb4be2220837f3c39d58b0507`
- Receipt verified: `true`
- Referral credit status: `zero`
- Commission bps: `0`
- Commission amount atomic: `0`
- Referrer credit atomic: `0`
- Settlement transaction signature:
  `EezjK4coD8idN4mqhoZva5wv1Bmnahym6YNSsJ1urGdSRchrmiVtjMtc5DjytGmtke9763ydRrPG2FXrSqJ5Nac`

## Notes

The existing-token fixture uses `10000` commission bps so a `1` atomic-unit payment
can visibly credit the referrer. A canonical 20 percent demo-mint rerun should use a
funded disposable setup fee payer with:

```bash
SPLIT402_USE_BUYER_AS_DEMO_FEE_PAYER=true
SPLIT402_COMMISSION_BPS=2000
corepack pnpm demo:setup-mint
corepack pnpm demo:paid-suite
```

The setup tool now supports a separate fee payer so the merchant service key does
not need to be the setup transaction fee payer.
