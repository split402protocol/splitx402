# Payout Signer Key Rotation Runbook

Use this runbook to rotate the HMAC credential used between the Split402 control
plane and the isolated payout signer appliance. This rotates control-plane
authentication to the signer. It does not rotate the Solana payout funding key.

## Rule

Never remove the previous auth key until every control-plane instance is sending
the new `x-split402-signer-key-id`.

## Planned Rotation

1. Add the new key as active while keeping the previous key active:

```bash
SPLIT402_PAYOUT_SIGNER_SERVICE_AUTH_KEYS_JSON='[
  {"keyId":"previous","sharedSecret":"old-secret","status":"active"},
  {"keyId":"current","sharedSecret":"new-secret","status":"active"}
]'
```

2. Deploy the signer appliance.

3. Update the control plane:

```bash
SPLIT402_REMOTE_PAYOUT_SIGNER_KEY_ID=current
SPLIT402_REMOTE_PAYOUT_SIGNER_SHARED_SECRET=new-secret
```

4. Confirm signer traffic uses `current`.

5. Retire the previous key:

```bash
SPLIT402_PAYOUT_SIGNER_SERVICE_AUTH_KEYS_JSON='[
  {"keyId":"current","sharedSecret":"new-secret","status":"active"},
  {"keyId":"previous","sharedSecret":"old-secret","status":"retired"}
]'
```

6. After the incident window expires, remove the retired key from signer config.

## Emergency Revocation

If a control-plane auth secret is suspected compromised:

1. Mark the affected key `retired` immediately or remove it from
   `SPLIT402_PAYOUT_SIGNER_SERVICE_AUTH_KEYS_JSON`.
2. Deploy the signer appliance.
3. Rotate every control-plane instance to a new `keyId` and secret.
4. Reconcile any payout batch that was signing or submitted during the incident
   window before creating a replacement transaction.

## Checks

- A request with the retired `keyId` returns `401`.
- A request without `x-split402-signer-key-id` returns `401` when more than one
  auth key is configured.
- `GET /v1/health` lists auth key IDs and statuses but never secrets.
- `GET /v1/metrics` increments `rejectedByCode.unauthorized` for old-key
  attempts and does not expose secrets.
- Stale or future HMAC timestamps also increment
  `rejectedByCode.unauthorized`; check audit event messages before assuming
  every unauthorized request is a rotation issue.
- When `SPLIT402_PAYOUT_SIGNER_SERVICE_AUDIT_LOG=stdout-jsonl` is enabled,
  signer logs include sanitized audit events for rejected old-key attempts.

Attach planned and emergency rotation evidence to
[`docs/checklists/phase6-custody-review.md`](../checklists/phase6-custody-review.md).

For planned rotation, copy
[`docs/templates/phase6-rotation-drill.txt`](../templates/phase6-rotation-drill.txt),
record the previous key ID, current key ID, dual-active deploy time,
control-plane rotation time, previous-key retirement deploy time, current-key
traffic evidence, health evidence, metrics evidence, and sanitized audit-log
evidence. Attach the completed drill to `rotation_drill_record` in the Phase 6
custody evidence bundle.

You can generate the correctly shaped planned rotation drill record with:

```bash
SPLIT402_PHASE6_ROTATION_DRILL_ID=phase6-rotation-001 \
SPLIT402_PHASE6_ROTATION_OWNERS="security, operations" \
SPLIT402_PHASE6_ROTATION_STAGING_ENVIRONMENT=split402-staging \
SPLIT402_PHASE6_ROTATION_PREVIOUS_KEY_ID=control-plane-previous \
SPLIT402_PHASE6_ROTATION_CURRENT_KEY_ID=control-plane-current \
SPLIT402_PHASE6_ROTATION_DUAL_ACTIVE_DEPLOY_TIME=2026-06-25T20:00:00Z \
SPLIT402_PHASE6_ROTATION_CONTROL_PLANE_ROTATION_TIME=2026-06-25T20:05:00Z \
SPLIT402_PHASE6_ROTATION_RETIRED_KEY_DEPLOY_TIME=2026-06-25T20:10:00Z \
SPLIT402_PHASE6_ROTATION_CURRENT_KEY_TRAFFIC_EVIDENCE="attached: current-key-traffic.log" \
SPLIT402_PHASE6_ROTATION_PREVIOUS_KEY_RETIRED_EVIDENCE="attached: previous key status retired" \
SPLIT402_PHASE6_ROTATION_HEALTH_EVIDENCE="attached: signer-health-after-rotation.json" \
SPLIT402_PHASE6_ROTATION_METRICS_EVIDENCE="attached: signer-metrics-after-rotation.log" \
SPLIT402_PHASE6_ROTATION_AUDIT_LOG_EVIDENCE="attached: sanitized-audit-log-sample.jsonl" \
  corepack pnpm phase6:rotation-drill
```

For emergency revocation, copy
[`docs/templates/phase6-emergency-revocation-drill.txt`](../templates/phase6-emergency-revocation-drill.txt),
record the retired key ID, replacement key ID, deploy timing, old-key rejection
evidence, new-key success evidence, metrics evidence, audit-log evidence, and
affected payout-batch reconciliation records. Attach the completed drill to
`emergency_revocation_drill_record` in the Phase 6 custody evidence bundle.

You can generate the correctly shaped emergency revocation drill record with:

```bash
SPLIT402_PHASE6_EMERGENCY_REVOCATION_DRILL_ID=phase6-emergency-revocation-001 \
SPLIT402_PHASE6_EMERGENCY_REVOCATION_OWNERS="security, operations" \
SPLIT402_PHASE6_EMERGENCY_REVOCATION_STAGING_ENVIRONMENT=split402-staging \
SPLIT402_PHASE6_EMERGENCY_REVOCATION_RETIRED_KEY_ID=control-plane-compromised \
SPLIT402_PHASE6_EMERGENCY_REVOCATION_REPLACEMENT_KEY_ID=control-plane-current \
SPLIT402_PHASE6_EMERGENCY_REVOCATION_START_TIME=2026-06-25T20:00:00Z \
SPLIT402_PHASE6_EMERGENCY_REVOCATION_SIGNER_DEPLOY_TIME=2026-06-25T20:05:00Z \
SPLIT402_PHASE6_EMERGENCY_REVOCATION_CONTROL_PLANE_ROTATION_TIME=2026-06-25T20:10:00Z \
SPLIT402_PHASE6_EMERGENCY_REVOCATION_OLD_KEY_REJECTION_EVIDENCE="attached: old-key-request returned 401" \
SPLIT402_PHASE6_EMERGENCY_REVOCATION_NEW_KEY_SUCCESS_EVIDENCE="attached: new-key request signed successfully" \
SPLIT402_PHASE6_EMERGENCY_REVOCATION_METRICS_EVIDENCE="attached: signer-metrics-after-revocation.log" \
SPLIT402_PHASE6_EMERGENCY_REVOCATION_AUDIT_LOG_EVIDENCE="attached: sanitized-audit-log-sample.jsonl" \
SPLIT402_PHASE6_EMERGENCY_REVOCATION_RECONCILIATION_EVIDENCE="attached: reconciliation-records-001.md" \
  corepack pnpm phase6:emergency-revocation
```
