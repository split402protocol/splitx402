create table if not exists payment_receipts (
  id text primary key,
  receipt_hash text not null unique,
  merchant_id text not null,
  campaign_id text not null,
  campaign_version integer not null,
  payment_id text not null unique,
  settlement_tx_signature text not null unique,
  network text not null,
  asset_mint text not null,
  payer_wallet text not null,
  pay_to_wallet text not null,
  receipt_json jsonb not null,
  source text not null check (source in ('buyer', 'merchant', 'relay', 'unknown')),
  verification_state text not null check (
    verification_state in ('signature_verified', 'pending_chain_verification')
  ),
  ingestion_state text not null check (ingestion_state in ('accepted', 'duplicate')),
  created_at timestamptz not null default now()
);

create table if not exists commission_accruals (
  id text primary key,
  receipt_id text not null unique references payment_receipts(id),
  merchant_id text not null,
  campaign_id text not null,
  route_id text not null,
  referrer_wallet text not null,
  payout_wallet text not null,
  asset_mint text not null,
  amount_atomic text not null,
  status text not null check (status in ('pending_chain_verification', 'available', 'held')),
  available_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists accruals_payout_selection_idx
  on commission_accruals(merchant_id, asset_mint, status, available_at);

create index if not exists accruals_referrer_idx
  on commission_accruals(referrer_wallet, asset_mint, status);

create table if not exists ledger_transactions (
  id text primary key,
  source_type text not null,
  source_id text not null,
  asset_mint text not null,
  created_at timestamptz not null default now(),
  unique (source_type, source_id)
);

create table if not exists ledger_entries (
  id text primary key,
  transaction_id text not null references ledger_transactions(id),
  account_type text not null,
  account_reference text not null,
  asset_mint text not null,
  amount_atomic text not null,
  created_at timestamptz not null default now()
);

create index if not exists ledger_account_idx
  on ledger_entries(account_type, account_reference, created_at);
