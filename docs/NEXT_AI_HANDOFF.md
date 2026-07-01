# Split402 Handoff For The Next AI

Repository: `split402protocol/splitx402`

This file is a plain-language status note for the next AI picking up the work.
It is intentionally honest: it says what Split402 is, what is already built,
and what still blocks launch.

## What Split402 Is

Split402 is a public-alpha protocol and product for referral attribution and
commission accounting on x402-paid HTTP resources.

Simple version:

- a user or agent pays a merchant through normal x402 settlement;
- Split402 attaches a signed referral claim;
- the merchant still receives the gross payment;
- Split402 records the referral commission and protocol fee as accounting;
- a later payout flow pays the referrer from merchant-funded balances.

This is **not** an on-chain atomic splitter in the current MVP.
It is a referral and payout accounting system around x402 payments.

## Where We Are Now

Rough completion estimate:

- built: about 80-85% of the public-alpha foundation
- launch-ready: 0%
- mainnet-ready: no

The technical foundation is strong:

- protocol schemas, hashing, signing, and test vectors exist;
- x402 extension flow exists;
- agent SDK and merchant SDK exist;
- control plane exists with receipt ingestion, registries, and workers;
- payout engine scaffolding exists;
- dashboard and router alpha exist;
- MCP demo / gateway path exists;
- public/private boundary docs and launch evidence scaffolding exist.

What this means in practice:

- the repo is real and substantial;
- the product is not yet ready for production custody or mainnet claims;
- hosted staging proof is still the big gate.

## What Is Already Built

### Protocol and x402 layer

- signed referral claims;
- signed offers and receipts;
- commission and protocol-fee arithmetic;
- receipt verification and test vectors;
- x402-compatible paid request flow.

### Control plane

- merchant, campaign, route, and receipt registries;
- PostgreSQL persistence;
- receipt policy verification;
- outbox workers;
- chain verification worker;
- public merchant reliability and dashboard summary endpoints;
- payout obligation summaries;
- referrer balances and payout history.

### Payout engine

- payout preview;
- allocation and release flow;
- signed transaction planning;
- signer policy and byte verification;
- transaction finality and transfer-content verification;
- terminal accrual states for rejected and paid outcomes.

### Dashboard, router, and MCP

- dashboard UI for merchant/referrer operations;
- router alpha with static providers and fallback;
- MCP demo bundle and narrow gateway mode;
- hosted-staging proof scaffolding.

## What Still Needs To Happen

This is the real backlog, in priority order:

1. Finish the hosted staging proof with evidence from a real environment.
2. Finish Phase 6 custody evidence and signer review gates.
3. Keep the public/private boundary clean and do not expose private launch
   details in public docs or GitHub metadata.
4. Keep the router and MCP gateway honest: demo/public-alpha wording only until
   hosted proof is real.
5. Continue hardening payout, chain-verification, and dashboard flows until all
   launch gates are green.

## Current Hard Blocks

These are the blockers that still matter most:

- Phase 7 hosted proof is not approved yet.
- Phase 6 custody evidence is not complete yet.
- Mainnet canary is not approved yet.
- Public-facing docs must not imply production readiness.
- The repo must stay professional and free of legacy identity traces.

## Important Rules For The Next AI

- Do not call the product production-ready.
- Do not claim mainnet approval.
- Do not treat the MVP as an atomic on-chain splitter.
- Keep the repo name as `splitx402` and the project name as Split402.
- Keep public docs professional and current.
- Keep private launch evidence out of public GitHub files.
- If you touch protocol objects, update the protocol schema, signing, verification,
  tests, and vectors together.

## Best Next Moves

If you are continuing implementation, the safest order is:

1. close the remaining launch-evidence gaps;
2. keep docs and README aligned with the real product;
3. continue router and gateway hardening;
4. only then move toward broader launch or canary work.

## Status In One Sentence

Split402 is a serious public-alpha referral and commission layer for x402
payments, but it is still not launch-approved because hosted proof and custody
evidence are unfinished.

