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
