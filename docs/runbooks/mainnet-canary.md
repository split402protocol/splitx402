# Mainnet Canary Runbook

This runbook describes the first tiny Split402 mainnet canary. It is not a
production launch runbook and it is not an atomic on-chain split test.

The mainnet canary validates the current MVP trust model:

1. A buyer/agent pays a merchant through normal x402 mainnet settlement.
2. Split402 verifies the signed referral receipt and economic policy.
3. The merchant still receives the gross x402 payment.
4. Split402 records referral commission and protocol fee accounting.
5. A later merchant-funded payout sends a tiny referrer payment after signer
   byte verification and finalized transfer-content verification.

## When To Run

Run a mainnet canary only after all are true:

- `corepack pnpm product:status --brief --workspace split402-launch-evidence`
  reports every launch gate ready.
- The GitHub public/private/license review is approved.
- The Phase 7 hosted proof is approved from a real hosted staging environment.
- The Phase 6 custody evidence is approved.
- The canary is explicitly approved for one merchant, one campaign, one route,
  one payer wallet, one asset, and a tiny amount.

Before those gates pass, mainnet status remains `no-go`.

## Preflight

Run:

```bash
corepack pnpm product:mainnet-canary --brief --workspace split402-launch-evidence
```

The command is fail-closed. It does not broadcast transactions. It reports
whether the current evidence and canary controls are sufficient to proceed.
When `--workspace` is provided, the command auto-loads
`split402-launch-evidence/mainnet-canary.env`; shell environment variables
override values from that file.

Required environment:

```bash
SPLIT402_MAINNET_CANARY_CONFIRM=split402-mainnet-canary
SPLIT402_MAINNET_CANARY_NON_ATOMIC_ACK=referral-accounting-not-atomic-split
SPLIT402_MAINNET_CANARY_NETWORK=solana:mainnet
SPLIT402_MAINNET_CANARY_MAX_GROSS_AMOUNT_ATOMIC=<positive integer <= 100000>
SPLIT402_MAINNET_CANARY_MERCHANT_ID=<allowlisted merchant id>
SPLIT402_MAINNET_CANARY_CAMPAIGN_ID=<allowlisted campaign id>
SPLIT402_MAINNET_CANARY_ROUTE_ID=<allowlisted route id>
SPLIT402_MAINNET_CANARY_WALLET=<allowlisted buyer/payer wallet>
SPLIT402_MAINNET_CANARY_DRY_RUN_EVIDENCE=attached: mainnet-canary-dry-run.txt
SPLIT402_MAINNET_CANARY_ROLLBACK_PLAN=attached: mainnet-canary-rollback-plan.txt
SPLIT402_MAINNET_CANARY_REVIEW_DECISION=approved
```

On Windows PowerShell, set values with `$env:NAME='value'` before running the
command. Keep filled canary env files local or private.

`product:evidence:init --missing` creates private scaffold files for the canary
dry-run and rollback plan. `product:mainnet-canary` resolves `attached:` paths
relative to `--workspace` and verifies the attached files before it can report
ready. The dry-run artifact must show passed receipt verification,
economic-policy verification, chain verification, payout dry-run, and signer
byte verification. The rollback artifact must include a stop-loss amount,
rollback owner, rollback steps, reconciliation owner, reviewer, and
`stop_conditions_reviewed: yes`.

## Demo Path Mainnet Configuration

The demo merchant and demo agent default to Solana Devnet. The canary payment
path uses the same code with an explicit network selection:

```bash
SPLIT402_DEMO_NETWORK=solana:mainnet
SPLIT402_MAINNET_CANARY_CONFIRM=split402-mainnet-canary
SPLIT402_MAINNET_CANARY_WALLET=<allowlisted buyer/payer wallet>
SPLIT402_SERVICE_SEED_HEX=<dedicated non-demo merchant service key seed>
SPLIT402_MERCHANT_PAY_TO=<approved mainnet merchant settlement wallet>
SPLIT402_REQUIRED_AMOUNT_ATOMIC=<positive integer <= 100000>
SPLIT402_SOLANA_RPC_URL=<optional mainnet RPC override>
X402_FACILITATOR_URL=<facilitator that supports solana mainnet exact>
```

The mainnet selection is fail-closed:

- The demo merchant refuses to start on mainnet with the published demo
  service seed, the published demo pay-to wallet, a missing canary
  confirmation, or an amount above the 100000 atomic canary cap.
- The demo agent refuses a mainnet paid request without the canary
  confirmation, without an allowlisted `SPLIT402_MAINNET_CANARY_WALLET`
  matching the buyer, or when the offer amount exceeds the canary cap. The
  deliberately-invalid-claim demo payment is always refused on mainnet.
- `demo:paid-suite` on mainnet runs exactly one valid paid request and skips
  the invalid-claim step.
- `demo:setup-mint` and `demo:setup-existing-token` are Devnet-only and refuse
  to run on mainnet. Airdrops are skipped automatically on mainnet.
- On mainnet the payment asset defaults to canonical USDC
  `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`.

`corepack pnpm demo:preflight` reports a `mainnetGuard` section and only
reports `readyForPaidRun: true` when every guard passes, so use it as the
non-broadcasting dry-run check before the canary payment.

## Execution

1. Run product status and confirm every launch gate is ready.
2. Run demo and payout dry-runs against the exact mainnet configuration without
   broadcasting payout bytes.
3. Enable exactly one allowlisted merchant, campaign, route, and payer wallet.
4. Execute one standard x402 mainnet payment at or below the canary amount cap.
5. Verify the Split402 receipt, economic policy, route attribution, and chain
   settlement.
6. Confirm the referrer accrual becomes available and dashboard/referrer views
   show the expected earning.
7. Create a payout batch in dry-run mode before requesting signer approval.
8. Require the signer to verify transaction bytes against the approved payout
   plan before signing.
9. Broadcast one tiny payout only after dry-run evidence and reviewer approval
   are attached.
10. Verify finalized transfer contents before closing ledger items to paid.

During the canary, two owner-authorized stop-loss controls are available
without database access:

- `POST /v1/campaigns/:campaignId/pause` stops new commission accrual because
  receipt economic policy rejects receipts for non-active campaigns.
- `POST /v1/merchants/:merchantId/payout-wallets/:payoutWalletId/pause` stops
  payout activity: paused funding wallets are rejected by payout batch creation
  until explicitly resumed.

## Stop Conditions

Stop immediately if any of these happen:

- Any launch gate falls back to `no-go`.
- The canary tries to use more than one merchant, campaign, route, or payer.
- The gross amount exceeds the canary cap.
- Receipt verification, economic-policy verification, chain verification, signer
  byte verification, or finalized transfer-content verification fails.
- Dashboard/referrer balances disagree with ledger state.
- Any transaction outcome becomes unknown and reconciliation has not approved a
  safe retry.

## Evidence Boundary

Keep private URLs, bearer tokens, private keys, custody details, transaction
bytes, partner-identifying records, and raw mainnet evidence out of the public
repository. Publish only sanitized summaries when intentionally approved.
