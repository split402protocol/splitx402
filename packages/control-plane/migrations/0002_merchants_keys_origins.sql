create table if not exists merchants (
  id text primary key,
  slug text not null unique,
  display_name text not null,
  owner_wallet text not null,
  status text not null check (status in ('pending', 'active', 'suspended', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists merchant_origins (
  merchant_id text not null references merchants(id),
  origin text not null,
  verification_method text not null check (verification_method in ('well_known', 'dns')),
  status text not null check (status in ('pending', 'verified', 'failed', 'revoked')),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (merchant_id, origin)
);

create table if not exists merchant_keys (
  merchant_id text not null references merchants(id),
  kid text primary key,
  algorithm text not null check (algorithm in ('Ed25519', 'ES256')),
  public_key text not null,
  purpose text not null check (purpose in ('offer_receipt', 'webhook')),
  valid_from timestamptz not null,
  valid_until timestamptz,
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz not null default now()
);

create index if not exists merchant_keys_resolve_idx
  on merchant_keys(merchant_id, kid, purpose, valid_from, valid_until, revoked_at);
