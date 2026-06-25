# Phase 7: Dashboard And Discovery

Phase 7 turns the Split402 protocol backend into something merchants,
referrers, and agent operators can actually inspect and demo.

## Current Status

Implemented:

- public merchant reliability profile endpoint;
- referrer balance and payout views;
- referrer route listing for dashboard and discovery surfaces;
- Bazaar-compatible resource metadata projection for active routes;
- merchant dashboard summary endpoint for readiness, campaigns, operations, and
  route status;
- merchant webhook delivery feed for pending, processing, delivered, and
  dead-letter webhook outbox events;
- MCP-facing demo bundle at `@split402/mcp-demo`.

## MCP Demo Bundle

The MCP bundle emits a paid tool card for `split402.walletRiskScore`:

```mermaid
flowchart LR
  Agent["Agent or MCP client"]
  Tool["split402.walletRiskScore"]
  Payment["x402 exact payment"]
  Merchant["Demo merchant"]
  Receipt["Split402 receipt"]
  Credit["Referrer credit"]

  Agent --> Tool
  Tool --> Payment
  Payment --> Merchant
  Merchant --> Receipt
  Receipt --> Credit
```

Run it with:

```bash
corepack pnpm demo:mcp-bundle
```

## Remaining Phase 7 Work

- Build the actual merchant/referrer dashboard UI on top of the existing
  dashboard APIs.
- Add a hosted end-to-end staging proof where an agent discovers a route, pays
  through x402, receives a Split402 receipt, and sees referrer earnings without
  manual database work.
- Add merchant funding and outstanding-obligation views that make payout
  readiness clear before production use.
- Package the MCP demo into a runnable MCP gateway if the demo needs direct
  client integration rather than a manifest/runbook bundle.

## Current Position

We are near a strong public-alpha demo. Production launch still depends on the
Phase 6 custody evidence gates and the remaining Phase 7 dashboard/staging proof
work.
