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
