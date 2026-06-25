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

Before approving custody, copy
[`docs/templates/phase6-image-provenance.txt`](../templates/phase6-image-provenance.txt)
and record the exact source commit, immutable image digests, build command,
dependency install command, dependency audit command, and audit output. Attach
the completed record to the Phase 6 evidence bundle and copy the signer build
command and audit output into `signer_image_build_command` and
`signer_image_dependency_audit_output`.

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

For payout signing key custody, copy
[`docs/templates/phase6-key-custody-review.txt`](../templates/phase6-key-custody-review.txt)
and record the key source, owner, backup policy, recovery process, access list,
access-review record, and separation-of-duties record. Attach it to
`key_custody_record` in the Phase 6 custody evidence bundle before any mainnet
custody approval.

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
- ensure control-plane pods that may call the signer are labeled
  `app.kubernetes.io/name=split402-control-plane`;
- keep `replicas: 1` unless custody architecture supports multiple signers for
  the same funding wallet;
- expose the service only inside the private control-plane network.

The manifest includes a `NetworkPolicy` named
`split402-payout-signer-private-ingress`. It selects signer pods and only allows
TCP/4022 ingress from pods labeled
`app.kubernetes.io/name=split402-control-plane`. If your cluster uses a service
mesh or cloud firewall instead, attach equivalent policy evidence to
`network_policy_record` in the Phase 6 custody evidence bundle.

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

Run the packaged smoke check:

```bash
SPLIT402_PAYOUT_SIGNER_SMOKE_URL="$SIGNER_URL" \
  corepack pnpm signer:payout:smoke
```

The smoke check verifies health, readiness, metrics shape, signer reference and
network consistency, and that endpoint responses do not expose configured signer
secrets present in the local environment.

Attach the smoke-check output to
[`docs/checklists/phase6-custody-review.md`](../checklists/phase6-custody-review.md)
before approving production payout custody.

Attach the applied network policy, firewall rule, or service-mesh policy to
`network_policy_record` in the same evidence bundle.

Copy
[`docs/templates/phase6-signer-policy-review.txt`](../templates/phase6-signer-policy-review.txt)
and record the signer policy values used for deployment. Attach it to
`signer_policy_record`, then copy its reviewed values into the
`signer_policy_*` fields in the custody evidence bundle.

## Rollback

If signing fails after a deploy:

1. Stop new payout batch creation in the control plane.
2. Keep existing signed payout bytes unchanged.
3. Roll the signer back to the last known-good image and secret set.
4. Run `POST /v1/payout-batches/:batchId/reconcile` before rebuilding any
   transaction that might already have been broadcast.
5. Confirm `/v1/metrics` rejection counts stop increasing before resuming batch
   creation.

Use [`payout-custody-incident-drill.md`](payout-custody-incident-drill.md) to
record incident evidence. Use
[`docs/templates/phase6-rollback-drill.txt`](../templates/phase6-rollback-drill.txt)
to record rollback evidence and attach it to `rollback_drill_record` in the
Phase 6 custody evidence bundle.
