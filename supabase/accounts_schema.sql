-- supabase/accounts_schema.sql
-- Run in Supabase Dashboard -> SQL Editor. Safe to re-run.

create table if not exists qurban_users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  password_hash text not null,
  role          text not null check (role in ('admin','editor','viewer')),
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table if not exists qurban_sessions (
  token       text primary key,
  user_id     uuid not null references qurban_users(id) on delete cascade,
  role        text not null,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

create index if not exists qurban_sessions_expires_idx on qurban_sessions (expires_at);

-- RLS: lock all three tables so the browser-visible anon key cannot touch them.
-- service_role (server) bypasses RLS by design, so no policies are needed.
alter table qurban_users    enable row level security;
alter table qurban_sessions enable row level security;
alter table qurban_state    enable row level security;
