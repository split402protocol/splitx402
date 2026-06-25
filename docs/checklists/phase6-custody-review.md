# Phase 6 Custody Review Checklist

Use this checklist before any production or mainnet payout custody. A reviewer
must attach evidence for every gate and leave Phase 6 marked `in progress` until
all required gates are approved.

## Required Evidence

| Gate | Required evidence | Status |
| --- | --- | --- |
| Signer image provenance | `source_commit`, immutable image digests, `signer_image_build_command`, `signer_image_dependency_audit_output`, and attached image provenance review. | Pending |
| Private signer networking | `network_policy_record` proving only the control plane can reach the signer, such as `deploy/payout-signer/kubernetes.yaml` plus applied-cluster evidence. | Pending |
| Signer readiness | `corepack pnpm signer:payout:smoke` output from staging. | Pending |
| Secret exposure check | Smoke-check output plus log sample proving health, readiness, metrics, and audit logs do not expose shared secrets, private keys, or transaction bytes. | Pending |
| HMAC key rotation | Completed planned rotation using `docs/runbooks/payout-signer-key-rotation.md`. | Pending |
| Emergency auth revocation | `emergency_revocation_drill_record` proving old-key rejection and new-key success using `docs/templates/phase6-emergency-revocation-drill.txt`. | Pending |
| Payout signer key custody | `key_custody_record` proving key source, owner, backup policy, access list, recovery process, and separation of duties using `docs/templates/phase6-key-custody-review.txt`. | Pending |
| Signer policy review | `signer_policy_record` plus signer policy fields proving funding wallet, source token account, USDC mint, token program allow-list, amount caps, and network settings were reviewed. | Pending |
| Unknown-outcome reconciliation | Drill proving no replacement transaction is built before `POST /v1/payout-batches/:batchId/reconcile`. | Pending |
| RPC failover | `corepack pnpm payout:finality:failover-drill` output with `passed: true`, primary RPC unavailable, and secondary RPC returning status. | Pending |
| Incident drill | Completed `docs/runbooks/payout-custody-incident-drill.md` with timestamps and owners. | Pending |
| Rollback drill | `rollback_drill_record` proving rollback to last known-good image and secret set using `docs/templates/phase6-rollback-drill.txt`. | Pending |
| Production approval | Security, operations, and protocol owners approve the evidence bundle. | Pending |

## Go/No-Go Rule

Do not enable production payout custody while any required gate is `Pending` or
`Failed`.

## Evidence Bundle Template

Copy [`docs/templates/phase6-custody-evidence.txt`](../templates/phase6-custody-evidence.txt)
and fill every field. Then run:

```bash
corepack pnpm phase6:custody:check <evidence-bundle.txt>
```

The validator fails while any required field is empty, placeholder-like, uses a
mutable image tag instead of a `sha256:` digest, or leaves
`approval_decision` as anything other than `approved`.

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
