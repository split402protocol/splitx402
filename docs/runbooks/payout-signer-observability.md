# Payout Signer Observability Runbook

Use this runbook to monitor the isolated payout signer appliance.

## Metrics

Read bounded counters:

```bash
curl -s "$SPLIT402_PAYOUT_SIGNER_URL/v1/metrics"
```

Expected fields:

- `requestsTotal`
- `signedTotal`
- `rejectedTotal`
- `rejectedByCode`

Alert on:

- nonzero `rejectedByCode.unauthorized` after a key rotation window;
- sustained growth in `rejectedByCode.forbidden`;
- any `internal_server_error`;
- signer availability failures from `GET /v1/health`.

## Audit Events

Deployments can attach an audit sink to `createPayoutSignerApp`. Events use
schema `split402.payout_signer.audit_event.v1`.

Safe fields include:

- outcome;
- status code and error code;
- auth key ID;
- batch ID;
- transaction index;
- amount;
- destination amount-list hash;
- expected transaction signature after signing.

Forbidden fields:

- private key material;
- shared secrets;
- unsigned transaction bytes;
- signed transaction bytes;
- full request headers.

## Incident Use

During a signer incident:

1. Snapshot `/v1/metrics`.
2. Export audit events for the incident window.
3. Rotate or retire compromised auth keys.
4. Reconcile any payout batch that was signing or submitted during the window.
5. Do not create replacement payout bytes until reconciliation proves the old
   transaction cannot finalize.
