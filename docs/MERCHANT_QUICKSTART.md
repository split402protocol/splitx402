# Merchant Quickstart — add an affiliate program to your x402 API

**You already sell your API to agents with x402. Split402 adds an affiliate
program: pay referrers a percentage commission _only on referred sales that
actually settled_, with cryptographic attribution and no tracking pixels.**

The money model keeps your existing x402 settlement path intact:

- The agent pays you through the **standard x402 flow**. You receive the **full**
  gross payment. Nothing about your existing settlement changes.
- Split402 records a signed receipt and a commission **liability** you fund
  **later**, from **your own** wallet, on **your own** schedule.
- If nobody refers you, you pay nothing. Commission only exists on payments a
  referrer actually drove and that actually settled on-chain.

Protocol fees, if any, are a percentage **of the referral commission** — never a
cut of your gross payment.

> Status: public alpha on Solana Devnet. Not mainnet-approved. See
> [Commercial readiness](COMMERCIAL_READINESS.md). This quickstart is the short
> path; the full reference is
> [External x402 provider onboarding](runbooks/external-x402-provider-onboarding.md).

## Do you qualify?

If your API already returns an x402 `402 Payment Required` response and settles
in USDC, you qualify. If you are not on x402 yet, add it first (Solana `exact`
scheme, USDC) — that is the prerequisite, and it is worth doing on its own.

## The 5 steps

### 1. Inspect your route (no payment, no keys shared)

```bash
corepack pnpm demo:discover-external-x402 https://your-api.example \
  --capability your.capability \
  --match-path /your/paid/route \
  --merchant-public-key <your-offer-receipt-public-key> \
  --artifacts-dir split402-provider-artifacts
```

This reads your live x402 response and generates safe, non-secret scaffolds:
route metadata, a campaign-terms template, an unsigned offer template, the
`402` extension wrapper, and a receipt template. It never sends a paid request
and never touches your private key.

### 2. Set your commission

Edit the generated `campaign-terms` file: pick your `commissionBps` (e.g. `1000`
= 10%), your campaign id, and the `payToWallet` you already use for x402. This is
the whole economic decision — one number.

### 3. Sign your offer (your key never leaves your side)

```bash
corepack pnpm demo:prepare-external-x402-offer -- \
  --campaign-terms-file campaign-terms.json \
  --unsigned-offer-file unsigned-offer.json \
  --output-dir prepared-offer
```

This computes the campaign-terms hash and the exact signing bytes. Sign those
bytes with your `offer_receipt` key **outside** the tooling, then attach the
signature:

```bash
corepack pnpm demo:attach-external-x402-signature -- \
  --kind offer \
  --unsigned-file prepared-offer/offer-to-sign.json \
  --signature <base64url-signature> \
  --merchant-public-key <your-offer-receipt-public-key> \
  --output-file offer.json \
  --offer-extension-output-file payment-required-extension.json
```

### 4. Advertise the offer in your existing `402` response

Merge `payment-required-extension.json` (the `extensions.split402.info` object)
into your unpaid x402 `402 Payment Required` response. That is the only change to
your live API. Agents and referrers can now discover that your route pays a
commission. The [`@split402/merchant-sdk`](../packages/merchant-sdk) and
[`@split402/x402-extension`](../packages/x402-extension) packages do this for
you in an Express/x402 app.

### 5. Register, fund, and go live

- Register your merchant, campaign, and route with the control plane. Public
  registration creates **pending** state; an operator approves it (this is an
  operator boundary, not public self-approval).
- Verify your origin — an operator can machine-check your
  `/.well-known/split402.json` via
  `POST /v1/operator/merchants/:merchantId/origins/check` before verifying it.
- Register and fund a **payout wallet**. This is the wallet you will pay
  accumulated referrer commissions from. You control it; you fund it when you
  choose.

After a referred, paid request settles, you return the merchant-signed receipt
(same no-secret prepare/attach helpers, `--kind receipt`). Split402 verifies the
settlement on-chain, and the referral commission becomes an auditable payable.

## What you get

- **Attribution you can verify.** Every referred sale carries a signed,
  chain-verifiable receipt. A referrer cannot claim a sale without the matching
  referral and settlement evidence, and commission is not accrued for payments
  that did not settle.
- **Stop-loss controls, no database access.** Pause a campaign
  (`POST /v1/campaigns/:id/pause`), pause a payout wallet, suspend a route — all
  reversible, all over the API.
- **You stay in control of money.** Commissions are payables you fund from your
  wallet on your cadence. Split402 never holds your gross payment.

## Honest limitations (public alpha)

- The MVP does **not** atomically split the payment on-chain. It records a
  commission liability funded by a later, merchant-controlled payout. Referrers
  therefore carry merchant-solvency and payout-timing risk — that is disclosed
  to them too.
- Devnet only until mainnet approval. Do not run real-money campaigns yet.

## Next

- Full reference:
  [External x402 provider onboarding](runbooks/external-x402-provider-onboarding.md)
- Integrate in code: [`@split402/merchant-sdk`](../packages/merchant-sdk),
  [`@split402/x402-extension`](../packages/x402-extension)
- Run the whole loop locally:
  [Local validator runbook](runbooks/local-validator.md)
