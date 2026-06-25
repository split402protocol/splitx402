# @split402/demo-merchant

Solana Devnet merchant API that demonstrates Split402 on top of a normal x402
USDC payment.

The merchant advertises a signed Split402 offer in the unpaid x402 challenge,
validates incoming referral attribution before settlement, settles the payment
through the x402 SVM path, and returns a merchant-signed Split402 receipt.

## Flow

```mermaid
flowchart TD
  Request["Paid API request"]
  Challenge["402 challenge plus Split402 offer"]
  Retry["x402 payment plus referral claim"]
  Verify["Validate attribution and settle payment"]
  Receipt["Signed Split402 receipt"]

  Request --> Challenge
  Challenge --> Retry
  Retry --> Verify
  Verify --> Receipt
```

## Commands

```bash
corepack pnpm demo:merchant
corepack pnpm --filter @split402/demo-merchant test
```

## Status

Public-alpha demo server for Devnet and local protocol validation. It is not a
production merchant template, custody service, or payout engine.
