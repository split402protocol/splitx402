# @split402/payout-signer

Isolated payout signer appliance for Split402 Phase 6.

The service accepts policy-checked signing requests from the control plane,
verifies the HMAC request envelope, rechecks the visible payout policy surface,
signs the serialized Solana transaction with configured key material, and
returns signed bytes plus the expected signature.

## API

```text
GET  /v1/health
GET  /v1/ready
GET  /v1/metrics
POST /v1/solana/payouts/sign
```

Use `/v1/health` for liveness checks and `/v1/ready` for readiness checks.
Readiness waits for signer key material to initialize and returns HTTP 503 when
the signer cannot sign.

Remote signer requests must use schema
`split402.solana.remote_payout_sign_request.v1` and include:

- `x-split402-signature-timestamp`
- `x-split402-signature`

The signature is `v1=<hex>` where the hex value is HMAC-SHA256 over
`timestamp.body` using `SPLIT402_PAYOUT_SIGNER_SERVICE_SHARED_SECRET`.
Timestamps must be within
`SPLIT402_PAYOUT_SIGNER_SERVICE_SIGNATURE_TOLERANCE_SECONDS`, which defaults to
`300`.

## Configuration

```bash
SPLIT402_PAYOUT_SIGNER_SERVICE_PORT=4022
SPLIT402_PAYOUT_SIGNER_SERVICE_REF=kms:split402-devnet-payout
SPLIT402_PAYOUT_SIGNER_SERVICE_NETWORK=solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1
SPLIT402_PAYOUT_SIGNER_SERVICE_EXPECTED_FUNDING_WALLET=<funding-wallet>
SPLIT402_PAYOUT_SIGNER_SERVICE_SHARED_SECRET=<shared-secret>
SPLIT402_PAYOUT_SIGNER_SERVICE_SHARED_SECRET_KEY_ID=default
SPLIT402_PAYOUT_SIGNER_SERVICE_SIGNATURE_TOLERANCE_SECONDS=300
SPLIT402_PAYOUT_SIGNER_SERVICE_AUDIT_LOG=stdout-jsonl
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
Set `SPLIT402_PAYOUT_SIGNER_SERVICE_AUDIT_LOG=stdout-jsonl` to emit one
sanitized JSON event per line to container stdout. The default is `off`.

Exactly one key source must be set:

- `SPLIT402_PAYOUT_SIGNER_SERVICE_PRIVATE_KEY_BASE64`
- `SPLIT402_PAYOUT_SIGNER_SERVICE_SECRET_KEY_BASE64`
- `SPLIT402_PAYOUT_SIGNER_SERVICE_SECRET_KEY_JSON`

## Commands

```bash
corepack pnpm --filter @split402/payout-signer dev
corepack pnpm --filter @split402/payout-signer start
corepack pnpm --filter @split402/payout-signer smoke
corepack pnpm --filter @split402/payout-signer test
corepack pnpm --filter @split402/payout-signer typecheck
corepack pnpm --filter @split402/payout-signer build
```

Run the staging smoke check after deploying:

```bash
SPLIT402_PAYOUT_SIGNER_SMOKE_URL=https://signer.internal \
  corepack pnpm signer:payout:smoke
```

The smoke check verifies `/v1/health`, `/v1/ready`, and `/v1/metrics`, and it
fails if those responses expose configured signer secrets.

## Container Deployment

Build the signer image from the repository root:

```bash
docker build \
  -f apps/payout-signer/Dockerfile \
  -t ghcr.io/split402protocol/splitx402/payout-signer:dev \
  .
```

The `:dev` tag above is local/dev only. Do not use mutable or local tags for
staging custody, production custody, or Kubernetes manifests. Push the image,
resolve its immutable `sha256:` digest, and deploy only the
`ghcr.io/split402protocol/splitx402/payout-signer@sha256:<digest>` reference.

Run the image with non-secret policy config and secret auth/key material:

```bash
docker run --rm -p 4022:4022 \
  -e SPLIT402_PAYOUT_SIGNER_SERVICE_REF=kms:split402-devnet-payout \
  -e SPLIT402_PAYOUT_SIGNER_SERVICE_NETWORK=solana:devnet \
  -e SPLIT402_PAYOUT_SIGNER_SERVICE_EXPECTED_FUNDING_WALLET=<funding-wallet> \
  -e SPLIT402_PAYOUT_SIGNER_SERVICE_SIGNATURE_TOLERANCE_SECONDS=300 \
  -e SPLIT402_PAYOUT_SIGNER_SERVICE_AUDIT_LOG=stdout-jsonl \
  -e SPLIT402_PAYOUT_SIGNER_SERVICE_AUTH_KEYS_JSON='[{"keyId":"control-plane-current","sharedSecret":"<shared-secret>","status":"active"}]' \
  -e SPLIT402_PAYOUT_SIGNER_SERVICE_PRIVATE_KEY_BASE64=<32-byte-private-key> \
  ghcr.io/split402protocol/splitx402/payout-signer:dev
```

The Kubernetes starter manifest lives at
[`deploy/payout-signer/kubernetes.yaml`](../../deploy/payout-signer/kubernetes.yaml).
Replace the placeholder image digest, signer reference, network, funding wallet,
auth key ring, and key material before applying it. The manifest's placeholder
image digest is intentional; it must be replaced with a real immutable digest
from the exact reviewed image.

## Status

Public-alpha scaffold. Do not use for mainnet custody until the Phase 6 custody
review checklist and payout custody incident drill are complete.
