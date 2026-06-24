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

- replay safety through required payment identifiers;
- quote integrity across method, URL, amount, asset, network, destination, and split
  digest;
- immutable split manifests after quote creation;
- exact allocation sums, including rounding dust;
- payout idempotency and reconciliation.

## Non-Goals For Now

- mainnet settlement;
- custody of significant balances;
- custom x402 schemes;
- unaudited splitter contracts.
