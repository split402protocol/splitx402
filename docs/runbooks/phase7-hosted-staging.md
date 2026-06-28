# Phase 7 Hosted Staging

Use this runbook to launch a repeatable Split402 staging surface for Phase 7
proof collection. It is intended for Devnet/public-alpha evidence, not mainnet
production custody.

## Stack

```mermaid
flowchart LR
  Operator["Operator"]
  Dashboard["Dashboard with viewer session"]
  Migrate["Migration job"]
  Control["Control plane"]
  Postgres[("PostgreSQL")]
  Merchant["Demo merchant"]
  ChainWorker["Chain worker"]
  WebhookWorker["Webhook worker"]

  Operator --> Dashboard
  Migrate --> Postgres
  Dashboard --> Control
  Merchant --> Control
  Control --> Postgres
  ChainWorker --> Postgres
  WebhookWorker --> Postgres
```

## Start

Create the staging environment file:

```bash
cp deploy/phase7-staging/phase7-staging.env.example deploy/phase7-staging/phase7-staging.env
```

Fill the viewer token, webhook target, Devnet wallets, and demo merchant signing
settings in `deploy/phase7-staging/phase7-staging.env`.

Launch the control plane and dashboard:

```bash
docker compose -f deploy/phase7-staging/compose.yaml up postgres control-plane dashboard
```

The `migrate` service runs `corepack pnpm control-plane:migrate` once before the
control plane starts. Save its JSON output if the launch review asks for schema
migration evidence.

Add the demo merchant and workers when the staging wallets and webhook receiver
are ready:

```bash
docker compose -f deploy/phase7-staging/compose.yaml --profile demo --profile workers up
```

Seed the hosted-staging control-plane state from an operator shell after
migrations have run and before collecting proof evidence:

```bash
SPLIT402_DATABASE_URL=postgresql://split402:split402@localhost:5432/split402 \
SPLIT402_PHASE7_SEED_CONFIRM=seed-hosted-staging \
corepack pnpm phase7:staging:seed
```

This command creates or verifies the active demo merchant, verified origin,
offer/receipt key, payout wallet, active campaign, and active referral route
used by the proof collectors. It is intentionally a database-backed operator
command, not a public HTTP approval endpoint. Keep it limited to Devnet
public-alpha staging.

Check the public readiness endpoints:

```bash
curl http://localhost:4021/v1/health
curl http://localhost:4027/health
```

Dashboard API routes require either a browser session created with
`SPLIT402_DASHBOARD_VIEWER_TOKEN` or the `x-split402-dashboard-token` header.

## Proof Capture

Set these values before collecting Phase 7 evidence:

```bash
SPLIT402_PHASE7_CONTROL_PLANE_URL=http://localhost:4021
SPLIT402_PHASE7_DASHBOARD_URL=http://localhost:4027
SPLIT402_PHASE7_DEMO_MERCHANT_URL=http://localhost:4023
SPLIT402_PHASE7_SOURCE_COMMIT=$(git rev-parse HEAD)
SPLIT402_PHASE7_CONTROL_PLANE_TOKEN=<merchant-session-token>
SPLIT402_PHASE7_MERCHANT_ID=<merchant-id>
SPLIT402_PHASE7_REFERRER_WALLET=<referrer-wallet>
SPLIT402_DATABASE_URL=postgresql://split402:split402@localhost:5432/split402
```

Then run the normal proof sequence:

```bash
corepack pnpm phase7:staging:init
SPLIT402_PHASE7_SEED_CONFIRM=seed-hosted-staging corepack pnpm phase7:staging:seed
corepack pnpm phase7:staging-proof > phase7-staging-proof.txt
corepack pnpm phase7:hosted:preflight
corepack pnpm phase7:staging:collect-reads
SPLIT402_MCP_CONTROL_PLANE_URL="$SPLIT402_PHASE7_CONTROL_PLANE_URL" \
SPLIT402_MCP_CONTROL_PLANE_TOKEN="$SPLIT402_PHASE7_CONTROL_PLANE_TOKEN" \
SPLIT402_MCP_CAPABILITY=solana.wallet-risk \
SPLIT402_MCP_SVM_PRIVATE_KEY="$SVM_PRIVATE_KEY" \
SPLIT402_PHASE7_MCP_GATEWAY_EXECUTE=1 \
corepack pnpm phase7:staging:collect-mcp-gateway
corepack pnpm demo:mcp-gateway:smoke
corepack pnpm demo:mcp-bundle > phase7-staging-evidence/mcp-bundle.json
corepack pnpm demo:paid-suite > phase7-staging-evidence/paid-suite.log
corepack pnpm phase7:staging:derive-receipt-verification
corepack pnpm phase7:staging:manifest phase7-staging-proof.txt > phase7-staging-evidence/artifact-manifest.json
corepack pnpm phase7:staging:assemble > phase7-staging-proof.txt
corepack pnpm phase7:staging:status phase7-staging-proof.txt
```

`phase7:staging:collect-reads` writes both payout-obligation and
funding-balance artifacts from the payout-obligations endpoint and validates
all captured read artifacts before writing them. It fails fast unless route
discovery has an active route, referrer balances show positive earnings,
dashboard summary has active campaign/route ids, webhook evidence has a
delivered event, payout obligations show a positive obligation, and funding
has at least one resolved `covered` or `deficit` asset. If it fails with
`fundingStatus is unknown`, rerun the staging stack with the Solana RPC
funding-balance provider configured before assembling the proof. Read artifacts
are written only after the full read set passes validation, so failed collection
runs do not leave partial evidence files to assemble by accident.

The status command must pass before Phase 7 can be marked ready for public-alpha
demo review. It verifies that the hosted preflight artifact was captured against
the same control-plane and dashboard URLs listed in the proof, and that the
dashboard is locked without the viewer token while accepting the viewer-token
path. It also compares the proof `source_commit` with the checkout running
`phase7:staging:status`, so proof evidence from an older commit stays no-go
after new code is merged, and it keeps the proof no-go when the checkout has
uncommitted source changes. Generated proof artifacts remain local and do not
block the status check.
Attach `phase7-staging-evidence/mcp-gateway.jsonl` as `mcp_gateway_evidence`.
The collector runs the gateway with JSON-RPC `initialize`, `tools/list`, and
budget-filtered `split402.searchCapabilities` requests using
`SPLIT402_MCP_MAX_AMOUNT_ATOMIC`. Set `SPLIT402_MCP_CONTROL_PLANE_URL` for
hosted route discovery. Phase 7 proof closure also requires
`split402.execute` and `split402.getReceipt`, so keep
`SPLIT402_PHASE7_MCP_GATEWAY_EXECUTE=1` enabled only after the same staging run
has live x402 buyer configuration. Set `SPLIT402_MCP_SVM_PRIVATE_KEY` or
`SVM_PRIVATE_KEY` to the funded buyer key, and set `SPLIT402_MCP_WALLET` and
`SPLIT402_MCP_MAX_AMOUNT_ATOMIC` for the execution input and budget. The status
validator requires the search and execute budgets to match and the reported paid
amount to stay within that budget. If hosted execution is enabled without a
buyer signer, the collector fails before producing misleading partial evidence.
The collector JSON report should echo the provider id, paid amount, receipt id,
receipt verification status, referrer credit, route id, commission bps,
protocol-fee bps, commission amount, and protocol-fee amount from the executed
router call.
Run `corepack pnpm demo:mcp-gateway:smoke` as a deterministic local gateway
contract check alongside the hosted transcript.

## Shutdown

```bash
docker compose -f deploy/phase7-staging/compose.yaml down
```

Remove the staging database volume only after the proof artifacts have been
captured:

```bash
docker compose -f deploy/phase7-staging/compose.yaml down -v
```
