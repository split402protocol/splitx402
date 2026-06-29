# Public And Private Boundary

Split402 is an open protocol foundation with private commercial operations.
This boundary keeps the public repository useful for integrators while keeping
the production business machine, custody surface, and partner operations out of
the cloneable public codebase.

## Public Repository

The public repository may contain:

- protocol schemas, signing bytes, hashes, verification helpers, and test
  vectors;
- x402 extension metadata, demo merchant and demo agent flows, and SDK
  integration examples;
- router interfaces and public-alpha routing behavior that agents need to
  understand paid capability execution;
- MCP demo gateway behavior that proves the agent-facing flow without claiming
  production hosting;
- public architecture, roadmap, phase status, security policy, and proof
  templates;
- non-secret Devnet examples and reproducible local demos.

The public repository should be good enough to explain and verify Split402. It
should not expose the full production operating system.

## Private Commercial Surface

The following belong in private infrastructure or a separate proprietary
repository before real launch:

- hosted control-plane deployment configuration for production environments;
- production router provider registry, ranking strategy, reliability scoring,
  fraud policy, and commercial partner rules;
- merchant onboarding, admin approval, compliance, dispute, and account-risk
  tooling;
- payout custody operations, signer deployment secrets, wallet policies,
  incident response evidence, and runbook outputs from real environments;
- production dashboard sessions, operator tooling, analytics, billing, and
  revenue reporting;
- hosted MCP gateway operations and any provider credentials, private URLs, or
  live transaction bytes;
- staging and production evidence artifacts that contain private endpoints,
  tokens, wallet operations, or partner-identifying information.

Public docs may describe the shape of these systems, but the operational
implementation and evidence from real environments should stay private unless a
specific artifact is intentionally sanitized for public trust-building.

## License Policy

This repository is licensed under Apache-2.0. Apache-2.0 keeps the public
protocol implementation open while adding clearer patent and contribution terms
than the previous MIT license.

Private Split402 services, hosted operations, production deployments, commercial
registries, and custody tooling are not automatically licensed by this public
repository. They should use separate proprietary terms unless Split402
explicitly publishes them under an open-source license later.

Treat publication as effectively irreversible. Code or documents that were
public under MIT or Apache-2.0 may already have been cloned, downloaded,
mirrored, or forked. A later license change, history rewrite, or private
visibility change does not reliably pull those copies back, so private business
logic and custody material must be kept out of public Git history before it is
pushed.

## Launch Rule

Before production launch, every new file should be checked against one question:

> Does this help outsiders integrate with or verify the public protocol, or does
> it expose how Split402 operates the business?

If it helps protocol adoption, it can be public. If it exposes operations,
commercial strategy, custody, live infrastructure, partner details, or private
evidence, it belongs in private infrastructure.

`corepack pnpm repo:guard` enforces the most important parts of this rule by
rejecting tracked launch-evidence workspaces, raw environment files, and common
private key or credential artifact extensions.
