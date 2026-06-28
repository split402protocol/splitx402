# 0005: Receipt Policy Verification Boundary

Status: accepted

Date: 2026-06-26

## Context

Receipt ingestion already verified schema, uniqueness, merchant signature, and
receipt arithmetic. That was not enough to prove the signed receipt still matched
the active merchant, verified origin, active campaign version, route state, and
self-referral policy known to the control plane.

Without this boundary, a cryptographically valid receipt could create an accrual
while drifting away from the economic policy the merchant actually registered.

## Decision

Receipt ingestion supports an optional `ReceiptPolicyVerifier`. When configured,
the ingestor runs policy verification after cryptographic/arithmetic checks and
before creating receipt snapshots, commission accruals, or ledger entries.

The control-plane runtime configures `ControlPlaneReceiptPolicyVerifier` with:

- merchant registry;
- campaign registry;
- route registry.

The verifier rejects receipts when merchant state, origin verification, service
key state, campaign status/version/terms, route status/scope/claim hash,
amounts, asset, pay-to wallet, protocol-fee basis points, or self-referral policy
do not match the receipt.

## Consequences

- Public HTTP merchant creation always creates `pending` merchants and rejects
  caller-provided `status`.
- Public HTTP origin registration always creates `pending` origins and rejects
  caller-provided `status` and `verifiedAt`.
- Test and internal fixtures may still seed approved state through registry
  methods; that state is not exposed as public self-approval.
- Valid receipts create accruals only after policy verification passes.
- Policy failures return `400` and do not create accruals or ledger entries.

## Non-Goals

This decision does not add an admin approval API. Production approval workflows
still need authenticated operator/admin surfaces before mainnet readiness.
