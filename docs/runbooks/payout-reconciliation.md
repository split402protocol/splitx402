# Payout Reconciliation Runbook

Use this runbook when a payout batch is marked `outcome_unknown`. That state
means Split402 submitted signed bytes, but RPC finality monitoring could not
prove whether the transaction landed, failed, or disappeared safely.

## Rule

Never build a replacement payout transaction until the existing signature has
been rechecked onchain and Split402 has persisted the observed result.

## Operator Flow

Configure the runtime finality monitor:

```bash
SPLIT402_PAYOUT_FINALITY_NETWORK=solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1
SPLIT402_PAYOUT_FINALITY_SOLANA_RPC_URL=https://api.devnet.solana.com
SPLIT402_PAYOUT_FINALITY_SOLANA_RPC_URLS=https://primary.example,https://secondary.example
SPLIT402_PAYOUT_FINALITY_UNKNOWN_OUTCOME_AFTER_MS=300000
```

Before production payout custody, record RPC failover evidence:

```bash
corepack pnpm payout:finality:failover-drill
```

Then copy [`docs/templates/phase6-rpc-failover-review.txt`](../templates/phase6-rpc-failover-review.txt)
or generate the correctly shaped review record:

```bash
SPLIT402_PHASE6_RPC_FAILOVER_REVIEW_ID=phase6-rpc-failover-001 \
SPLIT402_PHASE6_RPC_FAILOVER_OWNERS="security, operations" \
SPLIT402_PHASE6_RPC_FAILOVER_STAGING_ENVIRONMENT=split402-staging \
SPLIT402_PHASE6_RPC_FAILOVER_DRILL_REPORT_JSON='<json-output-from-payout-finality-failover-drill>' \
SPLIT402_PHASE6_RPC_FAILOVER_PRIMARY_UNAVAILABLE_EVIDENCE="attached: primary-rpc-503.log" \
SPLIT402_PHASE6_RPC_FAILOVER_SECONDARY_STATUS_EVIDENCE="attached: secondary-rpc-confirmed.json" \
  corepack pnpm phase6:rpc-failover
```

Attach the review output to `rpc_failover_record` in the Phase 6 custody
evidence bundle.

1. List batches that need review:

```bash
curl -s \
  "$SPLIT402_CONTROL_PLANE_URL/v1/merchants/$MERCHANT_ID/payouts/reconciliation"
```

Inspect a single batch and its transactions before acting on it:

```bash
curl -s \
  "$SPLIT402_CONTROL_PLANE_URL/v1/payout-batches/$PAYOUT_BATCH_ID"
```

2. Reconcile one batch:

```bash
curl -s -X POST \
  "$SPLIT402_CONTROL_PLANE_URL/v1/payout-batches/$PAYOUT_BATCH_ID/reconcile" \
  -H "content-type: application/json" \
  -d '{"observedAt":"2026-06-25T00:00:00.000Z"}'
```

3. Follow `report.recommendedAction`:

| Action | Meaning |
| --- | --- |
| `close_ledger_if_finalized` | The transaction finalized. Close the payout ledger exactly once. |
| `wait_for_finality` | The transaction is visible but not finalized. Continue monitoring. |
| `manual_review_before_retry` | The transaction failed onchain. Review funding, blockhash, and signer policy before creating a new attempt. |
| `requery_chain_before_retry` | The outcome is still ambiguous. Do not rebuild or retry with new bytes. Requery later. |

Before production payout custody, copy
[`docs/templates/phase6-reconciliation-drill.txt`](../templates/phase6-reconciliation-drill.txt)
or generate the correctly shaped unknown-outcome reconciliation record:

```bash
SPLIT402_PHASE6_RECONCILIATION_DRILL_ID=phase6-reconciliation-001 \
SPLIT402_PHASE6_RECONCILIATION_OWNERS="operations, protocol" \
SPLIT402_PHASE6_RECONCILIATION_STAGING_ENVIRONMENT=split402-staging \
SPLIT402_PHASE6_RECONCILIATION_MERCHANT_ID=<merchant-id> \
SPLIT402_PHASE6_RECONCILIATION_PAYOUT_BATCH_ID=<payout-batch-id> \
SPLIT402_PHASE6_RECONCILIATION_EXPECTED_SIGNATURE=<expected-signature> \
SPLIT402_PHASE6_RECONCILIATION_OUTCOME_UNKNOWN_EVIDENCE="attached: batch status outcome_unknown before reconcile" \
SPLIT402_PHASE6_RECONCILIATION_LIST_EVIDENCE="attached: GET /v1/merchants/<merchant-id>/payouts/reconciliation returned the batch" \
SPLIT402_PHASE6_RECONCILIATION_ENDPOINT_EVIDENCE="attached: POST /v1/payout-batches/<payout-batch-id>/reconcile returned report" \
SPLIT402_PHASE6_RECONCILIATION_RECOMMENDED_ACTION=requery_chain_before_retry \
SPLIT402_PHASE6_RECONCILIATION_PERSISTED_STATUS_AFTER_RECONCILE=outcome_unknown \
SPLIT402_PHASE6_RECONCILIATION_NO_REPLACEMENT_BYTES_EVIDENCE="attached: no replacement signed bytes created before reconciliation" \
  corepack pnpm phase6:reconciliation-drill
```

Attach the output to `unknown_outcome_reconciliation_record` in the Phase 6
custody evidence bundle.

## Safety Checks

- Reconciliation resends no funds. It only queries chain finality and persists
  the observed status.
- Retry with new signed bytes is unsafe while the batch remains
  `outcome_unknown`.
- A retry before blockhash expiry must resend the exact same persisted signed
  bytes.
- If RPC providers disagree, prefer waiting and requerying over rebuilding the
  payout.

## Current Limit

The public-alpha repo includes local-dev signer wiring, remote signer client
wiring, signer deployment artifacts, and reconciliation decision tooling.
Production payout custody still requires deployed infrastructure, operational key
controls, and completion of
`docs/checklists/phase6-custody-review.md`.
