# Payout Signer Deployment Runbook

Use this runbook to deploy the isolated Split402 payout signer appliance.

## Scope

The payout signer is a narrow service boundary. It accepts authenticated,
policy-checked signing requests from the Split402 control plane, revalidates the
visible Solana payout policy, signs the transaction bytes, and returns signed
bytes plus the expected signature.

The signer must not be exposed publicly. Put it on a private network reachable
only by the control plane or a private service mesh.

## Build

Build from the repository root:

```bash
docker build \
  -f apps/payout-signer/Dockerfile \
  -t ghcr.io/split402protocol/splitx402/payout-signer:<git-sha> \
  .
```

The image starts `apps/payout-signer/dist/index.js` and listens on
`SPLIT402_PAYOUT_SIGNER_SERVICE_PORT`, defaulting to `4022`.

## Configure

Set non-secret policy values as deployment config:

```bash
SPLIT402_PAYOUT_SIGNER_SERVICE_PORT=4022
SPLIT402_PAYOUT_SIGNER_SERVICE_REF=kms:split402-devnet-payout
SPLIT402_PAYOUT_SIGNER_SERVICE_NETWORK=solana:devnet
SPLIT402_PAYOUT_SIGNER_SERVICE_EXPECTED_FUNDING_WALLET=<funding-wallet>
SPLIT402_PAYOUT_SIGNER_SERVICE_SIGNATURE_TOLERANCE_SECONDS=300
SPLIT402_PAYOUT_SIGNER_SERVICE_AUDIT_LOG=stdout-jsonl
```

Set auth and signing material as secrets:

```bash
SPLIT402_PAYOUT_SIGNER_SERVICE_AUTH_KEYS_JSON='[{"keyId":"control-plane-current","sharedSecret":"<shared-secret>","status":"active"}]'
SPLIT402_PAYOUT_SIGNER_SERVICE_PRIVATE_KEY_BASE64=<32-byte-private-key-base64>
```

Exactly one signing key source must be configured:

- `SPLIT402_PAYOUT_SIGNER_SERVICE_PRIVATE_KEY_BASE64`
- `SPLIT402_PAYOUT_SIGNER_SERVICE_SECRET_KEY_BASE64`
- `SPLIT402_PAYOUT_SIGNER_SERVICE_SECRET_KEY_JSON`

For auth rotation, deploy a key ring with one active key and any retired keys,
then update the control plane to send `x-split402-signer-key-id`.

The signature tolerance rejects captured HMAC requests outside the configured
time window. Keep control-plane and signer clocks synchronized with NTP, and use
the smallest tolerance that survives normal network latency and clock skew.

## Deploy

A starter Kubernetes manifest is provided at
[`deploy/payout-signer/kubernetes.yaml`](../../deploy/payout-signer/kubernetes.yaml).

Before applying it:

- replace the image tag with an immutable digest or release tag;
- replace the signer reference, network, and funding wallet;
- move the auth key ring and signing key into the cluster secret manager;
- keep `replicas: 1` unless custody architecture supports multiple signers for
  the same funding wallet;
- expose the service only inside the private control-plane network.

## Verify

Check liveness:

```bash
curl -fsS "$SIGNER_URL/v1/health"
```

Check readiness:

```bash
curl -fsS "$SIGNER_URL/v1/ready"
```

Readiness returns HTTP 503 if signer key material cannot initialize.

Check counters:

```bash
curl -fsS "$SIGNER_URL/v1/metrics"
```

Counters must not include private keys, shared secrets, unsigned transaction
bytes, or signed transaction bytes.

When `SPLIT402_PAYOUT_SIGNER_SERVICE_AUDIT_LOG=stdout-jsonl`, verify container
logs contain one JSON audit event per signed or rejected request. Audit lines
must not contain private keys, shared secrets, unsigned transaction bytes, or
signed transaction bytes.

## Rollback

If signing fails after a deploy:

1. Stop new payout batch creation in the control plane.
2. Keep existing signed payout bytes unchanged.
3. Roll the signer back to the last known-good image and secret set.
4. Run `POST /v1/payout-batches/:batchId/reconcile` before rebuilding any
   transaction that might already have been broadcast.
5. Confirm `/v1/metrics` rejection counts stop increasing before resuming batch
   creation.
