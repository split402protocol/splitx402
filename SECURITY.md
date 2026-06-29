# Security Policy

Split402 is not ready for production or mainnet use.

This public repository contains the open protocol foundation and public-alpha
reference implementation. Production hosted services, commercial router
operations, real custody evidence, private endpoints, provider credentials, and
live transaction bytes must remain outside the public repository unless an
artifact is intentionally sanitized for public release.

## Supported Versions

No released versions are currently supported. Treat all code and documentation as
pre-release research and development.

## Reporting Issues

Please report suspected vulnerabilities privately through GitHub Security
Advisories for this repository. Do not open public issues for private keys,
settlement bypasses, replay vulnerabilities, payout duplication, or auth/session
weaknesses.

## Security Priorities

The first implementation must protect:

- merchant-signed offers and receipts verified through registered service keys;
- referral claim integrity across campaign, route, payout wallet, resource origin,
  operation scope, and expiry;
- request digest integrity across method, URL, body, amount, asset, network, and
  destination;
- replay safety through receipt id, payment id, settlement signature, and canonical
  receipt hash uniqueness;
- zero-sum commission ledger entries for merchant liability, referrer payable, and
  protocol fee payable;
- chain verification before any accrual becomes payout-eligible;
- payout idempotency and reconciliation.

## Non-Goals For Now

- production or mainnet settlement;
- custody of significant balances;
- custom x402 schemes or custom facilitators;
- atomic split settlement and `$SPLIT` route bonding;
- unaudited on-chain programs.

## Public/Private Boundary

See [docs/PUBLIC_PRIVATE_BOUNDARY.md](docs/PUBLIC_PRIVATE_BOUNDARY.md) before
adding deployment, custody, provider, dashboard, staging, or commercial
operations material. When in doubt, keep operational details private and publish
only the minimum sanitized protocol evidence needed for external trust.
