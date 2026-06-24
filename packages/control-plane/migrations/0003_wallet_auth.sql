create table if not exists wallet_auth_challenges (
  id text primary key,
  wallet text not null,
  network text not null,
  purpose text not null check (purpose in ('merchant-session')),
  nonce text not null,
  message text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);

create index if not exists wallet_auth_challenges_wallet_idx
  on wallet_auth_challenges(wallet, created_at desc);

create index if not exists wallet_auth_challenges_expiry_idx
  on wallet_auth_challenges(expires_at);

create table if not exists wallet_auth_sessions (
  token_hash text primary key,
  session_id text not null unique,
  wallet text not null,
  network text not null,
  purpose text not null check (purpose in ('merchant-session')),
  challenge_id text not null references wallet_auth_challenges(id),
  issued_at timestamptz not null,
  expires_at timestamptz not null
);

create index if not exists wallet_auth_sessions_wallet_idx
  on wallet_auth_sessions(wallet, issued_at desc);

create index if not exists wallet_auth_sessions_expiry_idx
  on wallet_auth_sessions(expires_at);
