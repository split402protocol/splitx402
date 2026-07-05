# Local Solana Validator Runbook

Use this path when Devnet faucets or RPC providers block testing. It runs the
Split402 paid demo against a local Solana validator and an in-process x402 SVM
facilitator, so no public faucet access is required.

Status: development-only. This is not hosted staging evidence, not mainnet
evidence, and not a production custody path.

## What This Proves

- The buyer can make an x402 SVM payment against a local SPL mint.
- The demo merchant can settle through a local x402 facilitator.
- The merchant returns signed Split402 receipts.
- The control plane can ingest those receipts and chain-verify local settlement.
- The dashboard can render the resulting referrer balance and merchant payout
  obligation.
- Payout batches can allocate, release, re-allocate, and close after a verified
  finalized local SPL-token transfer.
- Valid referral claims earn commission.
- Invalid referral claims produce zero commission.

## Required Local Services

```bash
docker run -d --name split402-local-solana-validator \
  -p 8899:8899 -p 8900:8900 \
  tchambard/solana-test-validator:latest \
  solana-test-validator --bind-address 0.0.0.0 --ledger /tmp/test-ledger --reset
```

Check health:

```bash
curl http://127.0.0.1:8899 \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
```

Expected result: `ok`.

## Local Environment

Private keys stay in ignored files:

- `.env`
- `split402-launch-evidence/phase7-staging.env`
- `deploy/phase7-staging/phase7-staging.env`
- `split402-launch-evidence/*.private.env`

Local validator mode needs these non-secret settings:

```bash
SPLIT402_SOLANA_RPC_URL=http://127.0.0.1:8899
SPLIT402_SOLANA_RPC_WS_URL=ws://127.0.0.1:8900
SPLIT402_LOCAL_X402_FACILITATOR=true
```

For Docker Compose services, use `host.docker.internal` instead of
`127.0.0.1`:

```bash
SPLIT402_SOLANA_RPC_URL=http://host.docker.internal:8899
SPLIT402_SOLANA_RPC_WS_URL=ws://host.docker.internal:8900
SPLIT402_LOCAL_X402_FACILITATOR=true
```

The local facilitator must use a funded fee-payer key that is different from
the buyer wallet. Do not use the buyer key as the facilitator fee payer.

## Run The Paid Suite

```bash
corepack pnpm build
corepack pnpm demo:preflight
corepack pnpm demo:paid-suite split402-launch-evidence/local-validator-paid-suite.log
```

Successful output includes:

- `paidSuitePassed: true`
- `split402ReceiptVerified: true`
- one valid receipt with non-zero `referrerCreditAtomic`
- one invalid-claim receipt with zero `referrerCreditAtomic`

## Run The Control-Plane Proof

Seed the same IDs and service key that the demo merchant will use:

```bash
SPLIT402_PHASE7_SEED_CONFIRM=seed-hosted-staging \
SPLIT402_DATABASE_URL=postgresql://split402:split402@localhost:5432/split402 \
SPLIT402_DATABASE_SSL=false \
corepack pnpm phase7:staging:seed > split402-launch-evidence/local-phase7-seed.json

corepack pnpm phase7:staging:apply-seed-env \
  --seed-output split402-launch-evidence/local-phase7-seed.json
```

After changing private env files, recreate Docker Compose services instead of
only restarting them:

```bash
docker compose --env-file deploy/phase7-staging/phase7-staging.env \
  -f deploy/phase7-staging/compose.yaml \
  --profile demo --profile workers up -d --force-recreate \
  control-plane dashboard demo-merchant chain-worker payout-finality-worker
```

Verify the proof in this order:

```bash
corepack pnpm phase7:docker:health --profile demo --profile workers
corepack pnpm demo:preflight
corepack pnpm demo:paid-suite split402-launch-evidence/local-validator-paid-suite.log
```

Then inspect private/local evidence:

- demo merchant `/debug/receipts` shows receipt submissions accepted by the
  control plane;
- chain worker logs show the receipt IDs verified;
- `GET /v1/referrers/:wallet/balances` shows the accrual as available;
- dashboard `/api/referrers/:wallet/balances` shows the same balance when called
  with the private viewer token;
- `POST /v1/merchants/:merchantId/payout-batches` allocates the available
  accrual;
- `POST /v1/payout-batches/:batchId/release-allocations` releases it back to
  available;
- a finalized local SPL-token transfer plus payout transaction mapping lets
  `POST /v1/payout-batches/:batchId/close-ledger` mark the accrual paid.

## Boundary

This local path proves the product mechanics without faucet dependency. Phase 7
hosted staging still requires real hosted URLs, hosted tokens, and evidence from
the same deployed commit.
