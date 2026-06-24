create table if not exists outbox_events (
  id uuid primary key,
  event_type text not null,
  aggregate_type text not null,
  aggregate_id text not null,
  payload jsonb not null,
  status text not null default 'pending' check (
    status in ('pending', 'processing', 'delivered', 'dead_letter')
  ),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null,
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (event_type, aggregate_type, aggregate_id)
);

create index if not exists outbox_ready_idx
  on outbox_events(status, available_at)
  where status in ('pending', 'processing');
