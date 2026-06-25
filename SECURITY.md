# Security Policy

Split402 is not ready for production or mainnet use.

## Supported Versions

No released versions are currently supported. Treat all code and documentation as
pre-release research and development.

## Reporting Issues

Please report suspected vulnerabilities privately through GitHub Security Advisories
once the GitHub repository is available. Until then, contact the maintainers directly.

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
