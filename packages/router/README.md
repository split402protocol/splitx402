# @split402/router

Public-alpha capability router for Split402 paid tools.

The router gives agents one API for choosing a paid provider, enforcing budget,
executing an x402 request through the agent SDK, verifying the merchant-signed
Split402 receipt, and falling back to another provider on retryable failure.

```ts
const result = await split402.execute({
  capability: "solana.wallet-risk",
  input: { wallet },
  budget: {
    network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    asset: DEVNET_USDC_MINT,
    maxAmountAtomic: "50000"
  },
  referralClaim
});
```

This package currently uses a static in-memory provider registry. Control-plane
and Bazaar discovery are next adoption-layer work. It is not a production
provider marketplace and does not make mainnet operation approved.

## Current Behavior

- filters providers by capability, network, asset, and maximum amount;
- ranks by success rate, then price, then latency, then provider id;
- executes through `Split402AgentClient` by default;
- accepts an injected executor for tests or controlled gateways;
- verifies receipts fail-closed by default;
- retries/falls back on network errors, HTTP 5xx, 408, 425, 429, missing
  receipts, and invalid receipts;
- stops on non-retryable HTTP 4xx errors.
