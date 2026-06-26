# 0006: Payout Signer Byte Verification

Status: accepted

Date: 2026-06-26

## Context

The payout signer policy validated the approved payout plan, but the local-dev
signer and remote signer service still signed caller-provided serialized
transaction bytes. That left a critical boundary gap: a request could present a
valid plan while substituting transaction bytes with a different recipient,
amount, mint, source account, authority, or extra instruction.

## Decision

Payout signing now verifies serialized Solana transaction bytes against the
approved `SolanaPayoutPlannedTransaction` and signer policy before signing.

The verifier is conservative and fail-closed. It decodes the compiled Solana
message and currently accepts only the payout transaction forms Split402 plans:

- idempotent associated-token-account creation;
- SPL `transferChecked` instructions;
- no address lookup tables;
- exactly the approved funding wallet as signer and fee payer;
- no extra or missing instructions.

The check runs before Solana simulation, before local-dev signing, before the
remote signer client sends a request, and inside the remote payout-signer
service before deserializing/signing bytes.

## Consequences

- Transaction bytes with changed destination, amount, mint, source token
  account, authority, token program, or extra unsupported instructions are
  rejected before signing.
- Unknown transaction forms are rejected rather than accepted optimistically.
- The signer service returns `400 invalid_request` for byte/plan mismatches and
  records the rejection without logging raw transaction bytes.
- Future payout transaction forms must extend this verifier and its tests before
  they can be signed.

## Non-Goals

This decision does not prove finalized on-chain payout contents before ledger
closure. That is a separate finality/content verification boundary.
