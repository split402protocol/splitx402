create table if not exists merchant_payout_wallets (
  id text primary key,
  merchant_id text not null references merchants(id),
  network text not null,
  wallet text not null,
  asset_mint text not null,
  signer_reference text not null,
  status text not null check (status in ('active', 'paused', 'retired')),
  created_at timestamptz not null default now(),
  unique (merchant_id, network, wallet, asset_mint)
);

create index if not exists merchant_payout_wallets_active_idx
  on merchant_payout_wallets(merchant_id, network, asset_mint, status);
