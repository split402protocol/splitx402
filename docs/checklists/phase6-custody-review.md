# Phase 6 Custody Review Checklist

Use this checklist before any production or mainnet payout custody. A reviewer
must attach evidence for every gate and leave Phase 6 marked `in progress` until
all required gates are approved.

## Required Evidence

| Gate | Required evidence | Status |
| --- | --- | --- |
| Signer image provenance | Immutable image digest, source commit, build command, and dependency audit output. | Pending |
| Private signer networking | Network policy, firewall rule, or service-mesh policy proving only the control plane can reach the signer. | Pending |
| Signer readiness | `corepack pnpm signer:payout:smoke` output from staging. | Pending |
| Secret exposure check | Smoke-check output plus log sample proving health, readiness, metrics, and audit logs do not expose shared secrets, private keys, or transaction bytes. | Pending |
| HMAC key rotation | Completed planned rotation using `docs/runbooks/payout-signer-key-rotation.md`. | Pending |
| Emergency auth revocation | Completed emergency revocation drill with old-key rejection evidence. | Pending |
| Payout signer key custody | Key source, owner, backup policy, access list, and recovery process reviewed. | Pending |
| Signer policy review | Funding wallet, source token account, USDC mint, token program allow-list, amount caps, and network settings reviewed. | Pending |
| Unknown-outcome reconciliation | Drill proving no replacement transaction is built before `POST /v1/payout-batches/:batchId/reconcile`. | Pending |
| RPC failover | Staging finality monitor test with primary RPC unavailable and secondary RPC returning status. | Pending |
| Incident drill | Completed `docs/runbooks/payout-custody-incident-drill.md` with timestamps and owners. | Pending |
| Rollback drill | Signer rollback to last known-good image and secret set tested. | Pending |
| Production approval | Security, operations, and protocol owners approve the evidence bundle. | Pending |

## Go/No-Go Rule

Do not enable production payout custody while any required gate is `Pending` or
`Failed`.

## Evidence Bundle Template

```text
review_id:
review_date:
reviewers:
source_commit:
signer_image_digest:
control_plane_image_digest:
staging_environment:
funding_wallet:
network:
smoke_check_output:
rotation_drill_record:
incident_drill_record:
rpc_failover_record:
approval_decision: no-go
approval_notes:
```

## Mainnet Boundary

This checklist is a production custody gate only. It does not approve `$SPLIT`
route bonding, atomic split settlement, or any custom facilitator path.
