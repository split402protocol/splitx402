# Security Policy

Split402 is public-alpha protocol infrastructure and is not ready for production
or mainnet use.

## Supported Versions

No released versions are currently supported. Treat all code and documentation as
pre-release research and development.

## Reporting Issues

Please report suspected vulnerabilities privately through GitHub Security
Advisories for this repository. If advisories are unavailable, contact the
maintainers directly before disclosing details publicly.

## Current Security Priorities

The first implementation must protect:

- x402 compatibility and gross USDC settlement to the merchant;
- signed Split402 offers and merchant-signed receipts;
- signed referral claims tied to campaign, route, resource origin, operation, and
  payout wallet;
- request-digest integrity across method, route template, params, query, body,
  payment ID, and offer nonce;
- replay safety through required payment identifiers and receipt uniqueness;
- merchant service-key registration, revocation, and receipt-key resolution;
- wallet-authenticated merchant and campaign mutations;
- idempotent receipt ingestion across receipt ID, payment ID, settlement
  transaction, and canonical receipt hash;
- integer-only commission accounting and balanced ledger entries;
- chain verification and payout reconciliation before any payout is finalized.

## Non-Goals For Now

- production mainnet settlement;
- custody of significant balances;
- irreversible payout execution;
- custom x402 schemes;
- `$SPLIT` bonding in the critical payment path;
- atomic split settlement contracts;
- unaudited facilitator or payout infrastructure.
