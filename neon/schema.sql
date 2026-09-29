-- neon/schema.sql — Qurban Center on Neon Postgres.
-- Applied by `bun scripts/neon-setup.mjs` (idempotent), or paste into the
-- Neon SQL Editor. Replaces supabase/*.sql; the Supabase project stays
-- untouched as legacy.

create table if not exists qurban_state (
  id         text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists qurban_users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  password_hash text not null,
  role          text not null check (role in ('admin','editor','viewer')),
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table if not exists qurban_sessions (
  token      text primary key,
  user_id    uuid not null references qurban_users(id) on delete cascade,
  role       text not null,
  email      text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists qurban_sessions_expires_idx on qurban_sessions (expires_at);

create table if not exists login_attempts (
  key          text primary key,
  count        int not null,
  window_start timestamptz not null
);

create table if not exists activity_logs (
  id     bigserial primary key,
  actor  text not null,
  action text not null,
  detail text not null default '',
  at     timestamptz not null default now()
);

create index if not exists activity_logs_at_idx on activity_logs (at desc);

-- Atomic increment: the whole read -> compute -> cap -> write runs in ONE
-- row-locked statement, so concurrent editors never drop updates.
-- p_path is a jsonb array of keys, e.g. '["kandang","0","keluar"]'.
create or replace function atomic_update_field(
  p_id   text,
  p_path jsonb,
  p_delta int
) returns jsonb
language plpgsql
as $$
declare
  current_data jsonb;
  old_val      int;
  new_val      int;
  total_hewan  int;
  total_keluar int;
  k            jsonb;
  path         text[];
begin
  path := array(select * from jsonb_array_elements_text(p_path));

  select data into current_data from qurban_state where id = p_id for update;
  if current_data is null then
    return jsonb_build_object('error', 'State not found');
  end if;

  old_val := coalesce((current_data #>> path)::int, 0);
  new_val := greatest(0, old_val + p_delta);

  if array_length(path, 1) = 3 and path[1] = 'kandang' and path[3] = 'keluar' then
    total_hewan := coalesce((current_data ->> 'totalHewan')::int, 0);
    total_keluar := 0;
    for k in select * from jsonb_array_elements(current_data -> 'kandang')
    loop
      total_keluar := total_keluar + coalesce((k ->> 'keluar')::int, 0);
    end loop;
    if (total_keluar - old_val + new_val) > total_hewan then
      new_val := greatest(0, old_val + (total_hewan - total_keluar));
    end if;
  end if;

  if new_val = old_val and p_delta <> 0 then
    return jsonb_build_object('ok', true, 'value', old_val, 'capped', true);
  end if;

  current_data := jsonb_set(current_data, path, to_jsonb(new_val), true);
  update qurban_state set data = current_data, updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true, 'value', new_val);
end;
$$;

-- Deep merge matching the app's old JS deepMerge: arrays and scalars replace,
-- objects merge recursively, nested nulls overwrite, top-level null no-ops.
create or replace function jsonb_merge_deep(target jsonb, patch jsonb)
returns jsonb
language plpgsql immutable
as $$
declare
  k text;
  v jsonb;
begin
  if patch is null then return target; end if;
  if jsonb_typeof(patch) <> 'object' then return patch; end if;
  if target is null or jsonb_typeof(target) <> 'object' then
    target := '{}'::jsonb;
  end if;
  for k, v in select * from jsonb_each(patch)
  loop
    if jsonb_typeof(v) = 'object' and jsonb_typeof(target -> k) = 'object' then
      target := jsonb_set(target, array[k], jsonb_merge_deep(target -> k, v));
    else
      target := jsonb_set(target, array[k], v);
    end if;
  end loop;
  return target;
end;
$$;

-- Durable per-key login rate limiting (5 failures / 10 minutes).
create or replace function login_is_limited(p_key text) returns boolean
language sql stable
as $$
  select exists(
    select 1 from login_attempts
    where key = p_key and count >= 5 and window_start > now() - interval '10 minutes'
  );
$$;

create or replace function login_record_failure(p_key text) returns void
language sql
as $$
  insert into login_attempts (key, count, window_start)
  values (p_key, 1, now())
  on conflict (key) do update set
    count = case when login_attempts.window_start <= now() - interval '10 minutes'
                 then 1 else login_attempts.count + 1 end,
    window_start = case when login_attempts.window_start <= now() - interval '10 minutes'
                        then now() else login_attempts.window_start end;
$$;

create or replace function login_clear(p_key text) returns void
language sql
as $$
  delete from login_attempts where key = p_key;
$$;
