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

This package supports a static in-memory provider registry and a public-alpha
control-plane discovery client that projects active Split402 routes and
Bazaar-compatible route metadata into router providers. It is not a production
provider marketplace, does not perform global Bazaar indexing yet, and does not
make mainnet operation approved.

## Control-Plane Discovery

```ts
const discovery = new Split402ControlPlaneDiscoveryClient({
  controlPlaneUrl: "https://control.split402.example",
  bearerToken: process.env.SPLIT402_CONTROL_PLANE_TOKEN,
  capabilityMapper: (resource) =>
    resource.metadata.operationId === "risk.score"
      ? "solana.wallet-risk"
      : resource.metadata.operationId
});

const providers = await discovery.discoverProviders({
  capability: "solana.wallet-risk",
  limit: 25
});

const split402 = new Split402Router({ providers, signer });
```

Discovery fetches active routes, reads each route's Bazaar resource projection,
resolves the campaign's active merchant service key, and only emits providers
with enough information for fail-closed receipt verification by default.

## Current Behavior

- filters providers by capability, network, asset, and maximum amount;
- discovers active control-plane routes into provider records;
- ranks by success rate, then price, then latency, then provider id;
- executes through `Split402AgentClient` by default;
- accepts an injected executor for tests or controlled gateways;
- verifies receipts fail-closed by default;
- requires returned receipts to match the supplied `referralClaim` route, claim
  hash, referrer wallet, and payout wallet;
- retries/falls back on network errors, HTTP 5xx, 408, 425, 429, missing
  receipts, and invalid receipts;
- stops on non-retryable HTTP 4xx errors.
