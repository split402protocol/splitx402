# SplitX402 MVP Build Plan

## Phase 0: Decisions

- Language: TypeScript first, because the x402 SDK ecosystem has strong Express,
  Fetch, Hono, and Next.js support.
- Network: Base Sepolia first.
- Asset: test USDC first.
- Scheme: x402 v2 `exact` first.
- Settlement: facilitator-backed first.
- Split execution: internal ledger first, then onchain payout worker.

## Phase 1: Skeleton Service

Deliverables:

- Node/TypeScript API service.
- One paid endpoint, for example `GET /v1/report`.
- x402 seller middleware returning a valid 402 challenge.
- Environment config for recipient/vault address, facilitator URL, network, asset,
  and fixed price.
- Basic request logs with payment id, route, amount, network, and settlement status.

Acceptance checks:

- Unpaid request returns 402.
- Paid request returns 200.
- Invalid or missing payment signature returns 402.
- Settlement response is recorded.

## Phase 2: Split Extension

Deliverables:

- `splitx402` extension schema.
- Split registry with immutable templates.
- Quote builder that attaches `extensions.splitx402`.
- Validation that client-provided extension data includes the server-declared
  manifest and has not overwritten required fields.

Acceptance checks:

- A protected route can advertise a split manifest.
- A modified split manifest is rejected.
- A payment intent stores the split digest used at quote time.

## Phase 3: Idempotency and Ledger

Deliverables:

- Required `payment-identifier` extension.
- Persistent payment intent store.
- Idempotency cache keyed by payment id and normalized request identity.
- Split allocation ledger generated only after successful settlement.

Acceptance checks:

- Retrying the same paid request does not charge twice.
- Retrying with the same payment id but different request identity is rejected.
- Split allocations sum exactly to the settled amount.
- Rounding dust has a deterministic recipient or policy.

## Phase 4: Payout Worker

Deliverables:

- Dry-run payout worker.
- Onchain payout adapter for the chosen network.
- Batch status tracking.
- Reconciliation job that identifies settled-but-unallocated,
  allocated-but-unpaid, and paid-but-unconfirmed states.

Acceptance checks:

- Dry-run payout produces deterministic transfer instructions.
- Onchain payout succeeds on testnet.
- Failed payouts can be retried without duplicate transfer intent.

## Phase 5: Receipts and Disputes

Deliverables:

- Signed offer/receipt integration.
- Receipt includes payment id, resource identity, settlement tx, split digest, and
  allocation summary.
- Refund/dispute policy document.

Acceptance checks:

- Client can verify the resource server committed to the price and split digest.
- Operator can prove the relationship between payment, response, and payout batch.

## First Engineering Slice

Build the smallest honest vertical slice:

1. Initialize a TypeScript API service.
2. Add `GET /v1/health`.
3. Add `GET /v1/paid-demo`.
4. Protect `paid-demo` with x402 exact payment on Base Sepolia.
5. Require payment id.
6. Store payment intent and settlement response in SQLite.
7. Compute three split allocations and expose them at
   `GET /v1/payments/:paymentId`.

That slice proves the most important product claim: a single x402 payment can be
turned into a traceable split revenue event without breaking normal x402 clients.

## Later Protocol Work

Once the MVP is running, consider formalizing one of these:

- `splitx402` extension: compatible with standard x402, easiest to adopt.
- `split-exact` scheme: stronger settlement semantics, harder client/facilitator
  adoption.
- Splitter contract as `payTo`: good trust-minimized middle ground if the chain and
  token support it cleanly.

My recommendation is to ship in that order: extension, splitter contract, then custom
scheme only if the ecosystem proves it needs one.

