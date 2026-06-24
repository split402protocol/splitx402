# 0001: Phase 0 Protocol Decisions

Date: 2026-06-24
Status: accepted

## Context

SplitX402 should let one x402 payment fund multiple recipients without forcing
buyers, wallets, or facilitators to adopt a custom protocol on day one.

The first version needs to prove four things:

- a normal x402 client can pay for a protected HTTP resource;
- the server can commit to a deterministic split manifest at quote time;
- the server can bind settlement, resource delivery, and split allocation to one
  payment event;
- recipients can later be paid or reconciled from that event without ambiguity.

## Decisions

### Runtime

Use TypeScript on Node.js for the first implementation.

Rationale: it gives us the fastest path to existing x402 SDK support, HTTP
middleware, SQLite tooling, typed schemas, and test automation.

### Network

Use Base Sepolia first.

Rationale: it is cheap, widely used in x402 examples, and suitable for testing USDC
style flows without mainnet risk.

### Asset

Use test USDC or the canonical test token supported by the selected facilitator on
Base Sepolia.

Rationale: the protocol should be stable before we care about multi-asset routing.

### x402 Scheme

Use x402 v2 `exact` first.

Rationale: exact-price settlement is the simplest model for a paid HTTP resource.
Dynamic pricing, streaming, and quote negotiation can wait.

### SDK Package

Prototype against the currently published `@coinbase/x402` package, observed at
version `2.1.0` on 2026-06-24, while tracking the x402 Foundation repository and
`x402` package separately.

Rationale: package naming is still an ecosystem choice, so the implementation should
wrap SDK usage behind local adapter boundaries.

### Split Representation

Represent splits as a `splitx402` extension attached to the standard x402 payment
requirements.

Rationale: extensions preserve compatibility with existing x402 clients and keep
SplitX402 out of the critical signing path until there is evidence that a formal
scheme is necessary.

### Settlement Target

Settle the first version to a single vault, merchant, or splitter address.

Rationale: x402 `exact` is naturally single-recipient. A downstream ledger keeps the
first release compatible and observable.

### Split Execution

Use an internal split ledger first, then add a payout worker. Do not start with a
custom onchain splitter contract.

Rationale: the hard problem is event integrity and idempotency. Contracts can improve
trust later, but they do not replace the need for a correct payment ledger.

### Persistence

Use SQLite for local MVP storage.

Rationale: it keeps Phase 1 easy to run while still forcing us to model durable
payment intents, settlements, allocations, and payout states.

### Idempotency

Require the x402 `payment-identifier` extension for every paid route.

Rationale: retries are unavoidable in HTTP. Payment idempotency is part of the
protocol surface, not an operational afterthought.

### Receipts

Integrate signed offers/receipts after the first paid vertical slice works.

Rationale: receipts are important for proof and disputes, but they should be layered
onto a working quote-settle-ledger flow.

## Consequences

- Phase 1 can start without smart contracts.
- Client compatibility remains high.
- Split recipients must initially trust the operator or vault process.
- The architecture leaves room for a splitter contract or `split-exact` scheme later.
- Tests must focus on replay, mutation, rounding, settlement binding, and payout
  idempotency before any mainnet deployment.

