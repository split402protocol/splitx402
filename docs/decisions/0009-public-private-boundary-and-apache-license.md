# 0009: Public/Private Boundary And Apache License

Date: 2026-06-29
Status: accepted

## Context

Split402 needs a public protocol surface that agents, merchants, and tool
builders can inspect and integrate with. At the same time, the production
business depends on operational surfaces that should not be freely cloneable:
hosted router operations, provider strategy, custody evidence, live deployment
configuration, private endpoints, partner details, and payout runbooks from
real environments.

The repository was previously licensed under MIT. MIT is simple and permissive,
but it is too loose for the current direction because it does not express the
same patent and contribution protections expected from a public protocol
foundation.

## Decision

The public repository is the open Split402 protocol foundation, not the full
production business machine.

The public repository may include:

- protocol schemas, signing bytes, verification helpers, and test vectors;
- SDK interfaces and x402 integration examples;
- public-alpha router behavior needed for agent integration;
- demo MCP gateway behavior;
- architecture, roadmap, phase status, security policy, and sanitized proof
  templates.

The following belong in private Split402 infrastructure unless explicitly
sanitized for public release:

- production hosted control-plane configuration;
- commercial router provider registries, scoring, fraud rules, and partner
  policies;
- payout custody operations, signer secrets, incident evidence, and real
  environment runbook outputs;
- production dashboard sessions, analytics, billing, and operator tooling;
- hosted MCP credentials, private URLs, live transaction bytes, and staging or
  mainnet evidence artifacts containing sensitive information.

The public repository is licensed under Apache-2.0. Private hosted services,
commercial operations, production deployments, custody tooling, provider
registries, and non-public evidence are not licensed by this repository.

This boundary must be enforced before publication, not repaired afterward. Code
or documents already published under MIT or Apache-2.0 may have been cloned,
downloaded, mirrored, or forked while that license was in effect. Changing the
repository license, rewriting history, or making the repository private later
does not reliably pull back copies that were already distributed. Sensitive
commercial logic, custody details, partner terms, private endpoints, keys,
credentials, and real evidence artifacts must therefore stay out of public Git
history from the start.

## Consequences

- Public docs must distinguish the open protocol from private hosted operations.
- New files should be reviewed against the public/private boundary before they
  are committed.
- Contributors submit public repository contributions under Apache-2.0 unless a
  separate written agreement applies.
- Production launch work should use a private repository or private deployment
  workspace for sensitive operational implementation.
- Public/private decisions are launch blockers: if a file contains commercial
  strategy, custody, live infrastructure, partner details, private URLs, or
  non-public evidence, it must be moved private or sanitized before release.
