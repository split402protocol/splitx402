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

The result includes the selected provider record, the normalized output, the
verified receipt, and an attempt log so agents can audit which provider was
used without correlating a separate search response.

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

const affordable = split402.searchCapabilities({
  capability: "solana.wallet-risk",
  budget: {
    network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    asset: DEVNET_USDC_MINT,
    maxAmountAtomic: "50000"
  }
});
```

Discovery fetches active routes, reads each route's Bazaar resource projection,
including the advertised HTTP method and `payToWallet`, resolves the campaign's
active merchant service key, and only emits providers with enough information
for fail-closed receipt verification by default. `GET` and `POST` providers are
supported; unsupported methods, blank payment metadata, and malformed atomic
prices are discarded before provider records are returned.

For external x402 APIs that have not yet registered Split402 campaign metadata,
`Split402ExternalX402DiscoveryClient` can import `/.well-known/x402`, merge
OpenAPI `x-payment-info`, probe unpaid routes for the authoritative
`Payment-Required` header, and return onboarding candidates. Candidates are
marked `requires_split402_campaign` until the x402 response includes a Split402
offer extension; only `router_ready` candidates produce receipt-verified router
providers.

## Current Behavior

- filters providers by capability, network, asset, and maximum amount;
- searches providers by capability plus optional network, asset, and maximum
  amount budget filters;
- ignores provider records with malformed atomic prices during search and
  execution ranking;
- discovers active control-plane routes into provider records;
- discovers external x402 provider candidates for onboarding without treating
  plain x402 payment requirements as Split402 referral routes;
- supports x402 `GET` and `POST` provider methods; object-shaped router input is
  passed as query parameters for `GET` providers and as JSON body for `POST`
  providers;
- passes each selected provider's network into the agent SDK, so EVM providers
  such as Base (`eip155:8453`) can execute when the router is configured with an
  `evmSigner`;
- ranks by success rate, then price, then latency, then provider id;
- executes through `Split402AgentClient` by default;
- returns the selected provider with each successful execution result;
- accepts an injected executor for tests or controlled gateways;
- skips providers whose discovered route/referrer/payout metadata conflicts
  with the supplied `referralClaim`;
- verifies receipts fail-closed by default;
- requires merchant offers and receipts to match the provider's network, asset,
  amount, and advertised `payToWallet`;
- requires returned receipts to match the supplied `referralClaim` route, claim
  hash, referrer wallet, and payout wallet;
- retries/falls back on network errors, HTTP 5xx, 408, 425, 429, missing
  receipts, and invalid receipts;
- stops on non-retryable HTTP 4xx errors.
