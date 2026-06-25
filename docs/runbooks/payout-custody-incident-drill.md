# Payout Custody Incident Drill

Use this drill before production payout custody and after any major signer,
control-plane, or RPC-provider change.

## Objective

Prove that operators can stop unsafe payout activity, rotate or revoke signer
authorization, reconcile ambiguous onchain outcomes, and resume only after the
ledger and chain state agree.

## Roles

| Role | Responsibility |
| --- | --- |
| Incident commander | Owns timeline, decisions, and go/no-go calls. |
| Control-plane operator | Pauses batch creation, runs reconciliation, and verifies ledger state. |
| Signer operator | Rotates HMAC credentials, rolls signer images, and verifies signer health. |
| Chain operator | Checks Solana signatures across RPC providers and records finality evidence. |
| Reviewer | Confirms evidence is complete before payout creation resumes. |

## Scenario A: Control-Plane Auth Secret Exposure

1. Pause new payout batch creation.
2. Mark the suspected signer auth key `retired` or remove it from
   `SPLIT402_PAYOUT_SIGNER_SERVICE_AUTH_KEYS_JSON`.
3. Deploy the signer and confirm `/v1/ready` returns `ready`.
4. Run `corepack pnpm signer:payout:smoke`.
5. Send one request signed with the retired key and record the HTTP 401 result.
6. Confirm `/v1/metrics` increments `rejectedByCode.unauthorized`.
7. Confirm JSONL audit logs contain a sanitized rejected event and no shared
   secret, private key, unsigned transaction bytes, or signed transaction bytes.
8. Rotate every control-plane instance to the new key ID and shared secret.
9. Resume payout batch creation only after current signer traffic uses the new
   key ID.

## Scenario B: Payout Signer Key Suspected Compromised

1. Pause new payout batch creation and signing.
2. Snapshot signer `/v1/metrics` and audit logs for the incident window.
3. List submitted or outcome-unknown batches.
4. For every affected batch, run
   `POST /v1/payout-batches/:batchId/reconcile`.
5. Do not build replacement transaction bytes while any affected transaction is
   `submitted`, `confirmed`, or `outcome_unknown`.
6. Rotate signer key material only after every affected signature has a recorded
   finality result or an explicit reviewer decision.
7. Deploy the signer with the new key material and expected funding wallet.
8. Run `corepack pnpm signer:payout:smoke`.
9. Record the old signer key disablement evidence and new signer readiness
   evidence.

## Scenario C: RPC Timeout After Broadcast

1. Confirm the control plane persisted signed bytes and expected signature
   before broadcast.
2. Query at least two configured RPC providers for the expected signature.
3. If providers disagree or return no result, keep the batch in
   `outcome_unknown`.
4. Run `POST /v1/payout-batches/:batchId/reconcile`.
5. Follow `report.recommendedAction`.
6. Never create replacement bytes until reconciliation proves the old
   transaction cannot finalize.
7. Run `corepack pnpm payout:finality:failover-drill` and attach the JSON output
   to the custody evidence bundle.

## Evidence Record

Attach the completed record to the Phase 6 custody evidence bundle and validate
the bundle with:

```bash
corepack pnpm phase6:custody:check <evidence-bundle.txt>
```

```text
drill_id:
scenario:
started_at:
ended_at:
incident_commander:
control_plane_operator:
signer_operator:
chain_operator:
reviewer:
source_commit:
signer_image_digest:
signer_reference:
network:
funding_wallet:
affected_batch_ids:
smoke_check_output:
metrics_before:
metrics_after:
audit_log_sample:
reconciliation_reports:
decision:
follow_up_actions:
```

## Pass Criteria

- New payout batch creation is paused before revocation or signer-key rotation.
- Old HMAC credentials are rejected.
- Signer readiness and smoke checks pass after deploy or rollback.
- Audit logs and endpoint responses expose no secrets or transaction bytes.
- Every affected payout batch has a recorded reconciliation decision.
- No replacement signed bytes are created while an earlier transaction can still
  finalize.
