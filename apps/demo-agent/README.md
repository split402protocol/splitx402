# @split402/demo-agent

Runnable buyer/agent harness for the Split402 Solana Devnet proof loop.

The demo agent sets up disposable Devnet keys and token accounts, inspects a
Split402-enabled merchant offer, creates a signed referral claim, pays the API
through the x402 SVM `exact` client, and verifies the merchant-signed receipt.

## Flow

```mermaid
sequenceDiagram
  participant A as Demo agent
  participant M as Demo merchant
  participant X as x402 SVM client

  A->>M: Inspect unpaid /v1/risk
  M-->>A: 402 response with Split402 offer
  A->>A: Build signed referral claim
  A->>X: Create x402 exact payment
  X->>M: Retry paid request
  M-->>A: Risk response and Split402 receipt
  A->>A: Verify receipt signature and credit
```

## Commands

```bash
corepack pnpm demo:setup-buyer
corepack pnpm demo:setup-existing-token
corepack pnpm demo:inspect-offer
corepack pnpm demo:preflight
corepack pnpm demo:paid-suite
```

## Status

Public-alpha Devnet harness. Keys and funds used here must be disposable test
assets only.
