import type { APIContext } from 'astro';
import { getDayState, saveDayState, defaultDayState, atomicIncrement } from '../../lib/db';

const VALID_PATHS = new Set([
  'totalHewan',
  'transit.kakiKepala',
  'karkas.total',
  'abf.keluar',
  'cacahDariAbf',
  'packingKecil.total',
  'packingKarkas.domba',
  'packingKarkas.sapi',
  'distribusiKarkas.domba',
  'distribusiKarkas.sapi',
  'distribusiKarkas.selesaiDomba',
  'distribusiKarkas.selesaiSapi',
]);

const VALID_ARRAY_PATTERNS = [
  /^kandang\.\d{1,2}\.keluar$/,
  /^sembelih\.\d{1,2}\.dipotong$/,
  /^lane\.\d\.total$/,
  /^cacah\.\d\.total$/,
  /^distribusiKecil\.lokasi\.\d{1,3}\.jumlah$/,
];

function isValidPath(path: string): boolean {
  if (VALID_PATHS.has(path)) return true;
  return VALID_ARRAY_PATTERNS.some(p => p.test(path));
}

function getNestedValue(obj: any, path: string[]): any {
  let cur = obj;
  for (const key of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    if (Array.isArray(cur)) {
      const idx = parseInt(key);
      if (isNaN(idx)) return undefined;
      cur = cur[idx];
    } else {
      cur = cur[key];
    }
  }
  return cur;
}

function setNestedValue(obj: any, path: string[], value: any) {
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (Array.isArray(cur)) {
      cur = cur[parseInt(key)];
    } else {
      cur = cur[key];
    }
    if (cur == null) return;
  }
  const last = path[path.length - 1];
  if (Array.isArray(cur)) {
    cur[parseInt(last)] = value;
  } else {
    cur[last] = value;
  }
}

export async function POST({ request }: APIContext) {
  try {
    const { day, path, delta } = await request.json();
    // Number.isInteger rejects NaN/Infinity/floats before the RPC cast to int4
    // can fail and push us into the non-atomic fallback with a corrupt value.
    if (!day || !path || !Number.isInteger(delta) || Math.abs(delta) > 1000) {
      return new Response(JSON.stringify({ error: 'Invalid params' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    const dayNum = parseInt(day);
    if (dayNum < 1 || dayNum > 4) {
      return new Response(JSON.stringify({ error: 'Invalid day' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!isValidPath(path)) {
      return new Response(JSON.stringify({ error: 'Invalid path' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const parts = path.split('.');
    const stateId = 'day-' + dayNum;

    // Try atomic increment (requires Supabase RPC function)
    let atomic = await atomicIncrement(stateId, parts, delta);
    // RPC errors out when the row doesn't exist yet (no settings saved this
    // day) — seed the default state once and retry so the first click works.
    if (atomic && atomic.error === 'State not found') {
      await saveDayState(dayNum, defaultDayState());
      atomic = await atomicIncrement(stateId, parts, delta);
    }
    if (atomic) {
      if (atomic.error) {
        return new Response(JSON.stringify({ error: atomic.error }), {
          status: 400, headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(atomic), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Fallback: non-atomic read-modify-write (used until RPC function is created)
    const state = await getDayState(dayNum) || defaultDayState();
    const current = getNestedValue(state, parts);
    const oldVal = typeof current === 'number' ? current : 0;
    let newVal = Math.max(0, oldVal + delta);

    const totalHewan = (state as any).totalHewan || 0;
    if (parts[0] === 'kandang' && parts[2] === 'keluar') {
      const kandang = (state as any).kandang || [];
      let totalKeluar = 0;
      for (const k of kandang) totalKeluar += (k.keluar || 0);
      const projected = totalKeluar - oldVal + newVal;
      if (projected > totalHewan) {
        newVal = Math.max(0, oldVal + (totalHewan - totalKeluar));
      }
    }

    if (newVal === oldVal && delta !== 0) {
      return new Response(JSON.stringify({ ok: true, value: oldVal, capped: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    setNestedValue(state, parts, newVal);
    await saveDayState(dayNum, state);

    return new Response(JSON.stringify({ ok: true, value: newVal }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('POST /api/increment error:', e);
    return new Response(JSON.stringify({ error: e?.message || 'Failed' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}
