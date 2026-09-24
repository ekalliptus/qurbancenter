-- supabase/qurban_state_schema.sql
-- Run in Supabase Dashboard -> SQL Editor. Safe to re-run.
-- qurban_state holds the app state blobs (default, settings, day2,
-- day2-settings, day-1..day-4, global-settings) as one JSON document per id.

create table if not exists qurban_state (
  id         text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- RLS: lock the table so the browser-visible anon key cannot touch it.
-- service_role (server, src/lib/db.ts) bypasses RLS by design, so no
-- policies are needed. The atomic_update_field RPC in
-- supabase/atomic_update_field.sql operates on this table.
alter table qurban_state enable row level security;
