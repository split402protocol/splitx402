# @split402/payout-signer

Isolated payout signer appliance scaffold for Split402 Phase 6.

The service accepts policy-checked signing requests from the control plane,
verifies the HMAC request envelope, rechecks the visible payout policy surface,
signs the serialized Solana transaction with configured key material, and
returns signed bytes plus the expected signature.

## API

```text
GET  /v1/health
GET  /v1/metrics
POST /v1/solana/payouts/sign
```

Remote signer requests must use schema
`split402.solana.remote_payout_sign_request.v1` and include:

- `x-split402-signature-timestamp`
- `x-split402-signature`

The signature is `v1=<hex>` where the hex value is HMAC-SHA256 over
`timestamp.body` using `SPLIT402_PAYOUT_SIGNER_SERVICE_SHARED_SECRET`.

## Configuration

```bash
SPLIT402_PAYOUT_SIGNER_SERVICE_PORT=4022
SPLIT402_PAYOUT_SIGNER_SERVICE_REF=kms:split402-devnet-payout
SPLIT402_PAYOUT_SIGNER_SERVICE_NETWORK=solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1
SPLIT402_PAYOUT_SIGNER_SERVICE_EXPECTED_FUNDING_WALLET=<funding-wallet>
SPLIT402_PAYOUT_SIGNER_SERVICE_SHARED_SECRET=<shared-secret>
SPLIT402_PAYOUT_SIGNER_SERVICE_SHARED_SECRET_KEY_ID=default
SPLIT402_PAYOUT_SIGNER_SERVICE_PRIVATE_KEY_BASE64=<32-byte-private-key>
```

For zero-downtime control-plane auth rotation, prefer a key ring:

```bash
SPLIT402_PAYOUT_SIGNER_SERVICE_AUTH_KEYS_JSON='[
  {"keyId":"current","sharedSecret":"new-secret","status":"active"},
  {"keyId":"previous","sharedSecret":"old-secret","status":"retired"}
]'
```

When more than one auth key is configured, requests must include
`x-split402-signer-key-id`. Retired keys remain documented in config but cannot
authorize signing requests.

## Metrics And Audit

`GET /v1/metrics` returns bounded counters:

```json
{
  "metrics": {
    "service": "split402-payout-signer",
    "signerReference": "kms:split402-devnet-payout",
    "network": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    "requestsTotal": 2,
    "signedTotal": 1,
    "rejectedTotal": 1,
    "rejectedByCode": {
      "forbidden": 1
    }
  }
}
```

Deployments can pass an audit sink to `createPayoutSignerApp`. Audit events use
schema `split402.payout_signer.audit_event.v1` and include safe signing
metadata: outcome, status code, auth key ID, batch ID, transaction index,
amount, destination hash, and expected signature. They do not include private
keys, shared secrets, unsigned transaction bytes, or signed transaction bytes.

Exactly one key source must be set:

- `SPLIT402_PAYOUT_SIGNER_SERVICE_PRIVATE_KEY_BASE64`
- `SPLIT402_PAYOUT_SIGNER_SERVICE_SECRET_KEY_BASE64`
- `SPLIT402_PAYOUT_SIGNER_SERVICE_SECRET_KEY_JSON`

## Commands

```bash
corepack pnpm --filter @split402/payout-signer dev
corepack pnpm --filter @split402/payout-signer test
corepack pnpm --filter @split402/payout-signer typecheck
corepack pnpm --filter @split402/payout-signer build
```

## Status

Public-alpha scaffold. Do not use for mainnet custody without production key
management, deployment hardening, monitoring, and an incident-response drill.
