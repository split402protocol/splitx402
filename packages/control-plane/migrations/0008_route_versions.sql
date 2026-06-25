alter table routes
  add column if not exists current_version integer not null default 1
    check (current_version > 0);

create table if not exists route_versions (
  route_id text not null references routes(id),
  version integer not null check (version > 0),
  campaign_version_min integer not null check (campaign_version_min > 0),
  payout_wallet text not null,
  claim_hash text not null unique,
  claim_json jsonb not null,
  signing_bytes_hex text not null,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  nonce text not null,
  metadata_hash text,
  created_at timestamptz not null default now(),
  primary key (route_id, version)
);

insert into route_versions (
  route_id, version, campaign_version_min, payout_wallet, claim_hash,
  claim_json, signing_bytes_hex, issued_at, expires_at, nonce, metadata_hash,
  created_at
)
select
  id, current_version, campaign_version_min, payout_wallet, claim_hash,
  claim_json, signing_bytes_hex, issued_at, expires_at, nonce, metadata_hash,
  activated_at
from routes
on conflict do nothing;

create index if not exists route_versions_route_created_idx
  on route_versions(route_id, created_at);
