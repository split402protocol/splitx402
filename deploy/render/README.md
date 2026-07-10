# Deploy the Split402 public-alpha Devnet stack (Render)

This is the fastest way to put a persistent, public **Solana Devnet** Split402
surface online so merchants, referrers, and agent builders can try it. It is a
public-alpha evaluation deployment, **not** a production or mainnet deployment.
Keep everything on Devnet and read
[docs/COMMERCIAL_READINESS.md](../../docs/COMMERCIAL_READINESS.md) before any
real-money use.

## What it deploys

| Service | Type | Essential? | What it does |
| --- | --- | --- | --- |
| `split402-db` | PostgreSQL 16 | yes | Durable state |
| `split402-control-plane` | web | yes | Public API (`/v1/health`, receipts, registries, payouts). Runs migrations on deploy. |
| `split402-dashboard` | web | yes | Merchant/referrer read views behind an expiring viewer session |
| `split402-chain-worker` | worker | yes for live payments | Verifies Devnet settlement; moves accruals pending → available |
| `split402-webhook-worker` | worker | optional | Signs and delivers webhooks |
| `split402-payout-finality-worker` | worker | optional | Monitors payout transaction finality |

## Cost (be honest with yourself)

Render **background workers and pre-deploy commands require a paid instance
type** (no free tier). A realistic minimum for a *live* demo is control-plane +
dashboard + chain-worker + Postgres. On Render `starter` that is roughly
**~$21/month** plus the database. If you only want to show the **API and
dashboard surface** (no live paid flows yet), delete the three `worker` services
from `render.yaml` and you are down to two web services + Postgres.

Cheaper alternatives with the same images: a single **$5 VPS** running the
existing `deploy/phase7-staging/compose.yaml` (see
[docs/runbooks/phase7-hosted-staging.md](../../docs/runbooks/phase7-hosted-staging.md)),
**Fly.io** (`fly launch` per service from the two Dockerfiles + `fly postgres`),
or **Railway** (add a Postgres plugin, deploy each Dockerfile as a service). The
Dockerfiles at `packages/control-plane/Dockerfile` and `apps/dashboard/Dockerfile`
work on any of them.

## Steps

1. Push this repository to your GitHub org (the branch you want to deploy).
2. In Render: **New +** → **Blueprint** → connect the repo → pick
   `deploy/render/render.yaml`.
3. Approve the plan. Render builds the two Docker images, provisions Postgres,
   runs the migration `preDeployCommand`, and starts everything.
4. **One post-deploy wiring step:** open the `split402-dashboard` service →
   Environment → set `SPLIT402_DASHBOARD_CONTROL_PLANE_URL` to the
   `split402-control-plane` public URL (looks like
   `https://split402-control-plane.onrender.com`) → save (it redeploys).
   Render cannot template a full cross-service URL at build time, so this is
   manual and one-time.
5. Verify:
   ```bash
   curl https://split402-control-plane.onrender.com/v1/health
   curl https://split402-dashboard.onrender.com/health
   ```
   Both should return `{"status":"ok"...}` / `{"ok":true...}`.

## Seed a live demo merchant/campaign/route (optional)

The control plane starts empty. To make the discovery/dashboard views show real
data, run the operator-only Devnet seed against the deployed database from a
shell that can reach it (Render dashboard → the database → external connection
string):

```bash
SPLIT402_DATABASE_URL="<render external postgres url>" \
SPLIT402_DATABASE_SSL=true \
SPLIT402_PHASE7_SEED_CONFIRM=seed-hosted-staging \
corepack pnpm phase7:staging:seed
```

This is a database-backed operator command, not a public self-approval endpoint.
Keep it to Devnet public-alpha.

## Secrets Render generates for you

- `SPLIT402_CONTROL_PLANE_OPERATOR_TOKENS` — bearer token(s) for the
  `/v1/operator/merchants/...` approval endpoints. Copy it from the
  control-plane service's Environment tab. Without it, operator endpoints stay
  disabled (fail-closed).
- `SPLIT402_DASHBOARD_VIEWER_TOKEN` — the viewer session token for the
  dashboard's read views.
- `SPLIT402_WEBHOOK_WORKER_SECRET` — outbound webhook HMAC secret.

Never commit filled secrets. Rotate them in Render, not in the repo.

## Guardrails

- This blueprint pins the chain and payout-finality workers to
  `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` (Devnet). Do not change these to
  mainnet here — production custody and mainnet approval are separate, gated
  processes (Phase 6 / Phase 7 / mainnet canary).
- The public repository is the open protocol foundation. Hosted production
  operations, custody, and commercial configuration belong in private
  infrastructure. See
  [docs/PUBLIC_PRIVATE_BOUNDARY.md](../../docs/PUBLIC_PRIVATE_BOUNDARY.md).
