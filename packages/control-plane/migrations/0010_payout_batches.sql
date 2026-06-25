do $$
declare
  existing_constraint text;
begin
  select conname
    into existing_constraint
    from pg_constraint
   where conrelid = 'commission_accruals'::regclass
     and contype = 'c'
     and conname <> 'commission_accruals_status_v2_check'
     and pg_get_constraintdef(oid) like '%pending_chain_verification%'
     and pg_get_constraintdef(oid) like '%available%'
     and pg_get_constraintdef(oid) like '%held%'
   limit 1;

  if existing_constraint is not null then
    execute format('alter table commission_accruals drop constraint %I', existing_constraint);
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'commission_accruals'::regclass
       and conname = 'commission_accruals_status_v2_check'
  ) then
    alter table commission_accruals
      add constraint commission_accruals_status_v2_check
      check (status in ('pending_chain_verification', 'available', 'held', 'allocated'));
  end if;
end $$;

create table if not exists payout_batches (
  id text primary key,
  merchant_id text not null references merchants(id),
  payout_wallet_id text not null references merchant_payout_wallets(id),
  network text not null,
  asset_mint text not null,
  status text not null check (
    status in ('draft', 'planned', 'signing', 'submitted', 'confirmed', 'finalized', 'failed', 'cancelled', 'outcome_unknown')
  ),
  total_amount_atomic text not null check (total_amount_atomic ~ '^(0|[1-9][0-9]*)$'),
  item_count integer not null check (item_count >= 0),
  accrual_count integer not null check (accrual_count >= 0),
  failure_code text,
  failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists payout_items (
  id text primary key,
  payout_batch_id text not null references payout_batches(id),
  destination_wallet text not null,
  destination_token_account text,
  amount_atomic text not null check (amount_atomic ~ '^[1-9][0-9]*$'),
  status text not null check (
    status in ('allocated', 'submitted', 'confirmed', 'finalized', 'failed', 'released')
  ),
  created_at timestamptz not null default now(),
  unique (payout_batch_id, destination_wallet)
);

create table if not exists payout_allocations (
  payout_item_id text not null references payout_items(id),
  accrual_id text not null references commission_accruals(id),
  amount_atomic text not null check (amount_atomic ~ '^[1-9][0-9]*$'),
  primary key (payout_item_id, accrual_id),
  unique (accrual_id)
);

create index if not exists payout_batches_lookup_idx
  on payout_batches(merchant_id, payout_wallet_id, asset_mint, status, created_at);

create index if not exists payout_items_batch_idx
  on payout_items(payout_batch_id, status);
