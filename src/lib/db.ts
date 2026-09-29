import { neon } from '@neondatabase/serverless';
import { getEnv } from './env';

// Postgres access via the Neon HTTP driver: every call is a single
// parameterized statement over HTTPS (Workers-friendly, no sockets held).
let _sql: ReturnType<typeof neon> | null = null;
function sql() {
  if (!_sql) _sql = neon(getEnv('DATABASE_URL'));
  return _sql;
}

function jsonb(value: unknown): string {
  return JSON.stringify(value);
}

// --- State functions ---

export function defaultState() {
  return {
    totalHewan: 100,
    tanggal: new Date().toISOString().split('T')[0],
    waktuMulai: '06:00',
    waktuSelesai: '',
    kandang: Array.from({ length: 8 }, (_, i) => ({
      no: i + 1, total: 12, keluar: 0, waktuMulai: '06:00', waktuSelesai: '', status: 'belum',
    })),
    sembelih: Array.from({ length: 10 }, (_, i) => ({
      no: i + 1, dipotong: 0, status: 'belum', waktuMulai: '06:00', waktuSelesai: '',
    })),
    transit: { kaki: 0, kepala: 0, hewan: 0 },
    kalet: Array.from({ length: 45 }, (_, i) => ({
      no: i + 1, total: 0, status: 'belum', waktuMulai: '', waktuSelesai: '',
    })),
    cacah: Array.from({ length: 6 }, (_, i) => ({
      no: i + 1, total: 0, status: 'belum', waktuMulai: '', waktuSelesai: '',
    })),
    karkas: { sudah: 0, waktuMulai: '', waktuSelesai: '' },
    distribusi: {
      totalPacking: 0, selesai: 0, packingWaktuMulai: '', packingWaktuSelesai: '',
      waktuMulai: '', waktuSelesai: '',
    },
  };
}

async function stateGet(id: string): Promise<unknown | null> {
  const rows = await sql()`select data from qurban_state where id = ${id}`;
  return rows.length ? rows[0].data : null;
}

async function stateReplace(id: string, data: unknown): Promise<void> {
  await sql()`insert into qurban_state (id, data, updated_at)
    values (${id}, ${jsonb(data)}::jsonb, now())
    on conflict (id) do update set data = ${jsonb(data)}::jsonb, updated_at = now()`;
}

export async function getState() { return stateGet('default'); }
export async function getSettings() { return stateGet('settings'); }
export async function saveSettings(data: unknown) { await stateReplace('settings', data); }
export async function saveState(data: unknown) { await stateReplace('default', data); }
export async function resetState() { const d = defaultState(); await saveState(d); return d; }

export function defaultDay2State() {
  return {
    totalKarkas: 0, abfKeluar: 0, abfMulai: '', abfSelesai: '',
    cacah: 0, cacahMulai: '', cacahSelesai: '',
    mejaCacah: Array.from({ length: 6 }, (_, i) => ({ nama: 'Meja ' + (i + 1), jumlah: 0, mulai: '', selesai: '' })),
    packBox: 0, packPack: 0, packMulai: '', packSelesai: '',
    distribMulai: '', distribSelesai: '', tanggal: '', mulai: '', selesai: '',
    distribusi: [] as Array<{ nama: string; jumlah: number; status: string; catatan: string }>,
  };
}

export async function getDay2State() { return stateGet('day2'); }
export async function saveDay2State(data: unknown) { await stateReplace('day2', data); }
export async function resetDay2State() { const d = defaultDay2State(); await saveDay2State(d); return d; }
export async function getDay2Settings() { return stateGet('day2-settings'); }
export async function saveDay2Settings(data: unknown) { await stateReplace('day2-settings', data); }

// --- Generic multi-day state functions ---

export function defaultDayState() {
  return {
    totalHewan: 0,
    tanggal: '',
    waktuMulai: '',
    waktuSelesai: '',
    kandang: Array.from({ length: 10 }, (_, i) => ({
      no: i + 1, total: 12, keluar: 0, waktuMulai: '', waktuSelesai: '',
    })),
    sembelih: Array.from({ length: 10 }, (_, i) => ({
      no: i + 1, dipotong: 0, waktuMulai: '', waktuSelesai: '',
    })),
    transit: { kakiKepala: 0, hewan: 0, waktuMulai: '', waktuSelesai: '' },
    lane: Array.from({ length: 6 }, (_, i) => ({
      no: i + 1, total: 0,
    })),
    pengulitanMulai: '',
    pengulitanSelesai: '',
    karkas: { total: 0, waktuMulai: '', waktuSelesai: '' },
    abf: { keluar: 0, waktuMulai: '', waktuSelesai: '' },
    cacah: Array.from({ length: 6 }, (_, i) => ({
      no: i + 1, total: 0, status: 'belum', waktuMulai: '', waktuSelesai: '',
    })),
    cacahDariAbf: 0,
    packingKecil: { total: 0, waktuMulai: '', waktuSelesai: '' },
    distribusiKecil: { lokasi: [] as Array<{ nama: string; jumlah: number; status: string }>, waktuMulai: '', waktuSelesai: '' },
    packingKarkas: { domba: 0, sapi: 0, waktuMulai: '', waktuSelesai: '' },
    distribusiKarkas: { domba: 0, sapi: 0, selesaiDomba: 0, selesaiSapi: 0, waktuMulai: '', waktuSelesai: '' },
  };
}

export async function getDayState(day: number) {
  return stateGet('day-' + day);
}

export async function saveDayState(day: number, data: unknown) {
  await stateReplace('day-' + day, data);
}

export async function getAllDayStates() {
  const rows = await sql()`select id, data from qurban_state where id like ${'day-%'} order by id`;
  const states: Record<string, unknown> = {};
  for (const row of rows) {
    states[row.id.replace('day-', '')] = row.data;
  }
  return states;
}

export async function getGlobalSettings() { return stateGet('global-settings'); }
export async function saveGlobalSettings(data: unknown) { await stateReplace('global-settings', data); }

// Atomic deep-merge upsert: the read and the merge happen inside ONE
// statement, so concurrent PATCHes can no longer lose updates (the old
// read-modify-write in JS could). Absent rows merge against the app default.
export async function mergeState(id: string, defaultData: unknown, patch: unknown): Promise<void> {
  await sql()`insert into qurban_state (id, data, updated_at)
    values (${id}, jsonb_merge_deep(${jsonb(defaultData)}::jsonb, ${jsonb(patch)}::jsonb), now())
    on conflict (id) do update
      set data = jsonb_merge_deep(qurban_state.data, ${jsonb(patch)}::jsonb), updated_at = now()`;
}

// Cheap change token for client polling.
export async function getDbVersion(): Promise<string> {
  const rows = await sql()`select coalesce(max(updated_at)::text, '') as v from qurban_state`;
  return rows[0].v;
}

export async function logActivity(actor: string, action: string, detail: string): Promise<void> {
  try {
    await sql()`insert into activity_logs (actor, action, detail) values (${actor}, ${action}, ${detail})`;
  } catch {
    // logging must never break the main flow
  }
}

// --- Atomic increment (RPC in neon/schema.sql) ---

export async function atomicIncrement(id: string, path: string[], delta: number): Promise<{ ok?: boolean; value?: number; capped?: boolean; error?: string } | null> {
  try {
    const rows = await sql()`select atomic_update_field(${id}, ${jsonb(path)}::jsonb, ${delta}) as r`;
    return rows.length ? rows[0].r : null;
  } catch {
    return null;
  }
}
