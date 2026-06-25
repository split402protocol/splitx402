create table if not exists wallet_auth_refresh_tokens (
  token_hash text primary key,
  refresh_token_id text not null unique,
  session_id text not null references wallet_auth_sessions(session_id),
  wallet text not null,
  network text not null,
  purpose text not null check (purpose in ('merchant-session')),
  challenge_id text not null references wallet_auth_challenges(id),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  replaced_by_session_id text
);

create index if not exists wallet_auth_refresh_tokens_wallet_idx
  on wallet_auth_refresh_tokens(wallet, issued_at desc);

create index if not exists wallet_auth_refresh_tokens_expiry_idx
  on wallet_auth_refresh_tokens(expires_at);

create index if not exists wallet_auth_refresh_tokens_revoked_idx
  on wallet_auth_refresh_tokens(revoked_at);
