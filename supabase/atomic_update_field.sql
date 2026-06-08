-- Atomic increment for qurban_state, called by src/lib/db.ts -> atomicIncrement().
-- Fixes the lost-update race condition: with 14+ editors clicking +/- at once,
-- a read-modify-write in app code drops concurrent updates. This does the whole
-- read -> compute -> cap -> write inside ONE row-locked transaction.
--
-- Run this in Supabase Dashboard -> SQL Editor. Re-running is safe (CREATE OR REPLACE).
--
-- Params:
--   p_id    text     row id, e.g. 'day-1'
--   p_path  text[]   json path, e.g. ARRAY['kandang','0','keluar']
--   p_delta int      change (+1 / -1 / etc.)
-- Returns jsonb: {ok:true, value:N} or {ok:true, value:N, capped:true} or {error:..}

create or replace function atomic_update_field(
  p_id   text,
  p_path text[],
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
begin
  -- Lock the row for the duration of the transaction so concurrent calls serialize.
  select data into current_data from qurban_state where id = p_id for update;

  if current_data is null then
    return jsonb_build_object('error', 'State not found');
  end if;

  old_val := coalesce((current_data #>> p_path)::int, 0);
  new_val := greatest(0, old_val + p_delta);

  -- Cap kandang.X.keluar so the SUM of all kandang keluar never exceeds totalHewan.
  if array_length(p_path, 1) = 3 and p_path[1] = 'kandang' and p_path[3] = 'keluar' then
    total_hewan := coalesce((current_data ->> 'totalHewan')::int, 0);
    total_keluar := 0;
    for k in select * from jsonb_array_elements(current_data -> 'kandang')
    loop
      total_keluar := total_keluar + coalesce((k ->> 'keluar')::int, 0);
    end loop;
    -- projected = total of others + new_val for this one
    if (total_keluar - old_val + new_val) > total_hewan then
      new_val := greatest(0, old_val + (total_hewan - total_keluar));
    end if;
  end if;

  -- No-op (already at cap): report capped without a write.
  if new_val = old_val and p_delta <> 0 then
    return jsonb_build_object('ok', true, 'value', old_val, 'capped', true);
  end if;

  current_data := jsonb_set(current_data, p_path, to_jsonb(new_val), true);

  update qurban_state
    set data = current_data, updated_at = now()
    where id = p_id;

  return jsonb_build_object('ok', true, 'value', new_val);
end;
$$;
