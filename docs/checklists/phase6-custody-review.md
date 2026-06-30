# Phase 6 Custody Review Checklist

Use this checklist before any production or mainnet payout custody. A reviewer
must attach evidence for every gate and leave Phase 6 marked `in progress` until
all required gates are approved.

## Required Evidence

| Gate | Required evidence | Status |
| --- | --- | --- |
| Signer image provenance | `corepack pnpm phase6:image-provenance` output with `source_commit`, immutable image digests, `signer_image_build_command`, `signer_image_dependency_audit_output`, and attached image provenance review. | Pending |
| Private signer networking | `corepack pnpm phase6:network-policy` output proving only the control plane can reach the signer, the service is private, and public ingress is denied or blocked. | Pending |
| Signer readiness | `corepack pnpm signer:payout:smoke` output plus `corepack pnpm phase6:signer-smoke` review proving health, readiness, metrics, signer reference, and network consistency. | Pending |
| Secret exposure check | `corepack pnpm phase6:signer-smoke` output proving endpoint responses and audit logs do not expose shared secrets, private keys, or transaction bytes. | Pending |
| HMAC key rotation | `corepack pnpm phase6:rotation-drill` output proving dual-active deploy, control-plane rotation, previous-key retirement, health, metrics, and audit-log evidence. | Pending |
| Emergency auth revocation | `corepack pnpm phase6:emergency-revocation` output proving old-key rejection, new-key success, metrics, audit-log evidence, and payout-batch reconciliation. | Pending |
| Payout signer key custody | `corepack pnpm phase6:key-custody` output proving key source, owner, backup policy, access list, recovery process, and separation of duties. | Pending |
| Signer policy review | `corepack pnpm phase6:signer-policy` output plus signer policy fields proving funding wallet, source token account, USDC mint, token program allow-list, amount caps, and network settings were reviewed. | Pending |
| Unknown-outcome reconciliation | `corepack pnpm phase6:reconciliation-drill` output proving no replacement transaction is built before `POST /v1/payout-batches/:batchId/reconcile`. | Pending |
| RPC failover | `corepack pnpm payout:finality:failover-drill` output plus `corepack pnpm phase6:rpc-failover` review proving `passed: true`, primary RPC unavailable, secondary RPC returning status, and finality observed from the secondary RPC. | Pending |
| Incident drill | `corepack pnpm phase6:incident-drill` output proving payout creation paused, affected batches reconciled, no replacement bytes were created while unsafe, smoke/metrics/audit evidence was captured, and payout creation resumed only after review. | Pending |
| Rollback drill | `corepack pnpm phase6:rollback-drill` output proving rollback to last known-good image and secret set, readiness, metrics, reconciliation records, and safe batch resume. | Pending |
| Production approval | Security, operations, and protocol owners approve the evidence bundle. | Pending |

## Go/No-Go Rule

Do not enable production payout custody while any required gate is `Pending` or
`Failed`.

## Evidence Bundle Template

Copy [`docs/templates/phase6-custody-evidence.txt`](../templates/phase6-custody-evidence.txt)
and fill every field. Then run:

```bash
corepack pnpm phase6:evidence:bundle phase6-custody-evidence.txt
# Review split402-launch-evidence/phase6-evidence.env first; regenerate only if missing:
corepack pnpm phase6:evidence:env-template split402-launch-evidence split402-launch-evidence/phase6-evidence.env
corepack pnpm phase6:evidence:assemble --evidence-env-file split402-launch-evidence/phase6-evidence.env split402-launch-evidence/phase6-custody-evidence.txt
corepack pnpm phase6:evidence:status --brief split402-launch-evidence/phase6-custody-evidence.txt
corepack pnpm phase6:custody:check split402-launch-evidence/phase6-custody-evidence.txt
```

Use `phase6:evidence:bundle` for a blank scaffold and
`phase6:evidence:env-template` only to recreate a missing local, commented
attachment-path helper. `product:evidence:init` creates the default
`phase6-evidence.env`; review it before editing. Pass the launch evidence
directory to `phase6:evidence:env-template` when using a non-default workspace,
for example
`corepack pnpm phase6:evidence:env-template evidence/launch evidence/launch/phase6-evidence.env`.
Use `phase6:evidence:assemble` after generated evidence record files exist and
the required environment values are set. The validator fails while any required
field is empty, placeholder-like, uses a mutable image tag instead of a
`sha256:` digest, uses an invalid `review_date` calendar date, or leaves
`approval_decision` as anything other than `approved`.
The env template shows direct overrides for review identity, source commit,
staging environment, funding wallet, and network; generated image-provenance
and signer-policy records can also populate those fields when present.
The assembler auto-loads `split402-launch-evidence/phase6-evidence.env` when it
exists; pass `--evidence-env-file <path>` for custom launch evidence directories.

```text
review_id:
review_date:
reviewers:
source_commit:
signer_image_digest:
signer_image_build_command:
signer_image_dependency_audit_output:
control_plane_image_digest:
staging_environment:
funding_wallet:
network:
network_policy_record:
signer_policy_record:
signer_policy_network:
signer_policy_funding_wallet:
signer_policy_source_token_account:
signer_policy_mint:
signer_policy_allowed_token_program_ids:
signer_policy_max_transaction_amount_atomic:
smoke_check_output:
unknown_outcome_reconciliation_record:
rotation_drill_record:
emergency_revocation_drill_record:
key_custody_record:
incident_drill_record:
rollback_drill_record:
rpc_failover_record:
approval_decision: no-go
approval_notes:
```

## Mainnet Boundary

This checklist is a production custody gate only. It does not approve `$SPLIT`
route bonding, atomic split settlement, or any custom facilitator path.
