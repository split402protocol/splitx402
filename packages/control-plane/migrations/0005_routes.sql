create table if not exists routes (
  id text primary key,
  campaign_id text not null references campaigns(id),
  campaign_version_min integer not null check (campaign_version_min > 0),
  referrer_wallet text not null,
  payout_wallet text not null,
  resource_origin text not null,
  operation_ids jsonb not null,
  claim_hash text not null unique,
  claim_json jsonb not null,
  signing_bytes_hex text not null,
  status text not null check (status in ('active', 'suspended', 'expired', 'revoked')),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  nonce text not null,
  metadata_hash text,
  created_at timestamptz not null default now(),
  activated_at timestamptz not null,
  check (jsonb_typeof(operation_ids) = 'array')
);

create index if not exists routes_campaign_status_idx
  on routes(campaign_id, status, expires_at);

create index if not exists routes_referrer_status_idx
  on routes(referrer_wallet, status, expires_at);
