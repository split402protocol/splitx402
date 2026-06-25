create table if not exists campaigns (
  id text primary key,
  merchant_id text not null references merchants(id),
  resource_origin text not null,
  status text not null check (status in ('draft', 'active', 'paused', 'closed')),
  current_version integer not null check (current_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists campaigns_merchant_status_idx
  on campaigns(merchant_id, status, updated_at desc);

create table if not exists campaign_versions (
  campaign_id text not null references campaigns(id),
  version integer not null check (version > 0),
  terms_hash text not null,
  terms_json jsonb not null,
  signing_bytes_hex text not null,
  network text not null,
  asset_mint text not null,
  commission_bps integer not null check (commission_bps between 0 and 10000),
  protocol_fee_bps integer not null check (protocol_fee_bps between 0 and 10000),
  payout_threshold_atomic text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  merchant_kid text references merchant_keys(kid),
  merchant_signature text,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (campaign_id, version),
  unique (campaign_id, terms_hash),
  check (
    (merchant_kid is null and merchant_signature is null and activated_at is null)
    or
    (merchant_kid is not null and merchant_signature is not null and activated_at is not null)
  )
);

create index if not exists campaign_versions_terms_idx
  on campaign_versions(terms_hash);

create table if not exists campaign_operations (
  campaign_id text not null,
  campaign_version integer not null,
  operation_id text not null,
  method text not null,
  path_template text not null,
  input_schema jsonb,
  primary key (campaign_id, campaign_version, operation_id),
  foreign key (campaign_id, campaign_version)
    references campaign_versions(campaign_id, version)
);

create index if not exists campaign_operations_lookup_idx
  on campaign_operations(operation_id, method);
