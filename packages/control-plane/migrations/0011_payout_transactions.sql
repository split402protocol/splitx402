create table if not exists payout_transactions (
  id text primary key,
  payout_batch_id text not null references payout_batches(id),
  sequence integer not null check (sequence >= 0),
  attempt integer not null default 1 check (attempt > 0),
  recent_blockhash text,
  last_valid_block_height bigint,
  signed_transaction_base64 text,
  expected_signature text unique,
  status text not null check (
    status in ('planned', 'signed', 'submitted', 'confirmed', 'finalized', 'expired', 'failed', 'outcome_unknown')
  ),
  submitted_at timestamptz,
  confirmed_at timestamptz,
  finalized_at timestamptz,
  error_json jsonb,
  created_at timestamptz not null default now(),
  unique (payout_batch_id, sequence, attempt)
);

create index if not exists payout_transactions_batch_status_idx
  on payout_transactions(payout_batch_id, status, sequence, attempt);
