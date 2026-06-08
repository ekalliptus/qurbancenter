import { getEnv } from './env';

// Secrets read at request time from the Cloudflare Workers runtime env.
// Uses the service_role key: qurban_state is RLS-locked, so the anon key
// (browser-visible) can no longer read/write it. Server access goes here.
function supaConfig() {
  return { url: getEnv('SUPABASE_URL'), key: getEnv('SUPABASE_SERVICE_KEY') };
}

async function supaGet(id: string) {
  const { url, key } = supaConfig();
  const res = await fetch(
    `${url}/rest/v1/qurban_state?id=eq.${encodeURIComponent(id)}&select=data`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows.length > 0 ? rows[0].data : null;
}

async function supaUpsert(id: string, data: unknown) {
  const { url, key } = supaConfig();
  const body = JSON.stringify({ id, data, updated_at: new Date().toISOString() });
  const res = await fetch(`${url}/rest/v1/qurban_state`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=minimal',
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase upsert failed (${res.status}): ${text}`);
  }
}

async function supaSelect(filter: string) {
  const { url, key } = supaConfig();
  const res = await fetch(
    `${url}/rest/v1/qurban_state?${filter}&select=id,data&order=id`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  if (!res.ok) return [];
  return res.json();
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

export async function getState() { return supaGet('default'); }
export async function getSettings() { return supaGet('settings'); }
export async function saveSettings(data: unknown) { await supaUpsert('settings', data); }
export async function saveState(data: unknown) { await supaUpsert('default', data); }
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

export async function getDay2State() { return supaGet('day2'); }
export async function saveDay2State(data: unknown) { await supaUpsert('day2', data); }
export async function resetDay2State() { const d = defaultDay2State(); await saveDay2State(d); return d; }
export async function getDay2Settings() { return supaGet('day2-settings'); }
export async function saveDay2Settings(data: unknown) { await supaUpsert('day2-settings', data); }

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
  return supaGet('day-' + day);
}

export async function saveDayState(day: number, data: unknown) {
  await supaUpsert('day-' + day, data);
}

export async function getAllDayStates() {
  const rows = await supaSelect('id=like.day-*');
  const states: Record<string, any> = {};
  for (const row of rows) {
    const num = row.id.replace('day-', '');
    states[num] = row.data;
  }
  return states;
}

export async function getGlobalSettings() { return supaGet('global-settings'); }
export async function saveGlobalSettings(data: unknown) { await supaUpsert('global-settings', data); }

export async function supaBroadcast(key: string) {
  try {
    const { url, key: apiKey } = supaConfig();
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'apikey': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{
          topic: 'qurban-sync',
          event: 'state-changed',
          payload: { key, ts: Date.now() },
        }],
      }),
    });
  } catch (e) {
    console.error('Broadcast failed:', e);
  }
}

// --- Atomic increment (requires Supabase RPC function) ---

export async function atomicIncrement(id: string, path: string[], delta: number): Promise<{ ok?: boolean; value?: number; capped?: boolean; error?: string } | null> {
  try {
    const { url, key } = supaConfig();
    const res = await fetch(`${url}/rest/v1/rpc/atomic_update_field`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_id: id, p_path: path, p_delta: delta }),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}
