# 0003: Adopt Split402 Architecture Baseline

Date: 2026-06-24
Status: accepted

## Context

The project name is Split402. The local architecture document
`split402_protocol_architecture_v0.1.md` defines Split402 as a referral,
attribution, and commission layer for x402-paid APIs and agent tools on Solana.

The architecture direction defines the first implementation shape: protocol
package, test vectors, x402 extension glue, Express adapter, agent SDK, demo
merchant, demo agent, and public demo runbooks.

This repository started with a narrower service skeleton and used some temporary
repo-name-based Base/EVM assumptions. Those assumptions are now superseded where
they conflict with the architecture spec.

## Decision

Use the architecture spec as the canonical product and protocol scope.

For this repository:

- preserve Split402 as the project/protocol name;
- keep `splitx402` only where it is a literal repo or GitHub path;
- implement the monorepo shape in stages;
- begin with deterministic protocol artifacts and test vectors;
- keep the Phase 1 service only as a temporary runnable host;
- make every intentional protocol behavior change explicit with fixtures, tests,
  and migration notes.

## Consequences

- Decisions 0001 and 0002 are superseded where they chose Base/EVM-first scope,
  repo-name-based extension naming, SQLite as the MVP source of truth, or deferred
  the monorepo/protocol package split.
- Phase 2 maps to architecture Milestone 0: repository and protocol core.
- Future phases follow the architecture milestones: Solana Devnet merchant demo,
  control plane and ingestion, production SDK, payout engine, dashboard/discovery,
  `$SPLIT` route bonding, then `split-exact` research.
- The repo should avoid accidental protocol behavior drift; changes should be
  intentional, reviewed, and covered by tests.
