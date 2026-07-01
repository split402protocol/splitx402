# 0011: Payout Allocation Release Broadcast Guard

Status: accepted

Date: 2026-07-02

## Context

`POST /v1/payout-batches/:batchId/release-allocations` (decision 0008) releases
allocations for `draft`, `planned`, `signing`, `failed`, and `cancelled`
batches. A batch can sit in a releasable status while a signed transaction with
a persisted `expectedSignature` was already handed to a Solana RPC that
reported a retryable error (for example an HTTP timeout on `sendTransaction`)
even though the RPC accepted the transaction. Releasing then returns the same
accruals to `available` while the original transfer can still land before its
`lastValidBlockHeight` passes, so a later batch would pay the same accruals
again. Architecture Milestone 4 requires that an RPC timeout after broadcast
cannot cause a duplicate payout.

## Decision

Before a batch with transactions carrying an `expectedSignature` releases its
allocations, one of the following must hold for every such transaction:

- its persisted status is already chain-terminal and unable to land later
  (`failed` on-chain or `expired`);
- a chain finality check through the payout finality monitor proves the
  signature did not land and the blockhash expired at finalized commitment;
- the caller provides an explicit operator override with a reason that is
  recorded on the released batch.

The Solana payout finality monitor now classifies `expired` by fetching the
finalized block height and comparing it against the transaction
`lastValidBlockHeight` when the signature is not found; any RPC failure keeps
the fail-closed `retry` classification and never proves expiry. The monitor
also accepts `signed` transactions with an expected signature so the release
endpoint can check maybe-broadcast transactions that were never marked
submitted.

Chain checks that show the signature landed (`confirmed`, `finalized`, or
on-chain `failed`) are persisted through the normal finality path so the batch
rolls into the submitted/confirmed pipeline instead of releasing. The guard is
enforced in the release endpoint and inside both payout batch stores, so direct
store callers get the same fail-closed behavior.

## Consequences

- An RPC timeout during broadcast can no longer free accruals that an
  already-accepted transaction later pays, closing the duplicate-payout window.
- Operators can still unwind a wedged batch, but only with chain proof or an
  explicit override whose reason is recorded in the batch failure message.
- Releases of batches without expected-signature transactions behave exactly as
  before.
