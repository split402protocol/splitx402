# 0007: Finalized Payout Transfer Verification

Status: accepted

Date: 2026-06-26

## Context

Payout finality monitoring proved that a submitted signature reached a terminal
chain status. That was not enough to safely close payout ledger entries, because
a finalized signature alone does not prove the transaction paid the mapped
payout recipients and amounts.

After payout transaction-to-item mapping, Split402 can verify each finalized
transaction against the exact payout items it is supposed to contain.

## Decision

Ledger closure for finalized payout batches now requires a
`PayoutFinalizedTransferVerifier`. The verifier must approve the finalized
batch and its mapped payout transactions before ledger entries are created or
allocated accruals are marked `paid`.

For Solana, `SolanaRpcPayoutFinalizedTransferVerifier` fetches finalized
`jsonParsed` transaction details and verifies:

- the finalized transaction includes the expected signature;
- the transaction did not fail;
- transfers use the configured funding wallet authority;
- transfers come from the configured source token account;
- transfer mint and token program match the batch/policy;
- each mapped payout item has a matching recipient, amount, and owner;
- there are no extra payout transfers from the funding source.

## Consequences

- Payout ledger closure is fail-closed without an explicit finalized-transfer
  verifier.
- A transaction that is finalized but pays the wrong destination, wrong amount,
  or extra recipient cannot close the ledger.
- Accruals remain allocated if finalized transfer verification fails.

## Non-Goals

This decision does not implement payout retries or manual allocation release.
Those remain separate recovery paths.
