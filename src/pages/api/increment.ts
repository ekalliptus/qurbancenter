import type { APIContext } from 'astro';
import { saveDayState, defaultDayState, atomicIncrement } from '../../lib/db';

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

function jsonError(error: string, status = 400): Response {
  return new Response(JSON.stringify({ error }), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST({ request }: APIContext) {
  try {
    const { day, path, delta } = await request.json();
    // Number.isInteger rejects NaN/Infinity/floats before the RPC cast to int4.
    if (!day || !path || !Number.isInteger(delta) || Math.abs(delta) > 1000) {
      return jsonError('Invalid params');
    }
    const dayNum = Number(day);
    if (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > 4) {
      return jsonError('Invalid day');
    }
    if (!isValidPath(path)) {
      return jsonError('Invalid path');
    }

    const stateId = 'day-' + dayNum;
    let result = await atomicIncrement(stateId, path.split('.'), delta);
    // The RPC errors out when the row doesn't exist yet (no settings saved
    // this day) — seed the default state once and retry so the first click works.
    if (result && result.error === 'State not found') {
      await saveDayState(dayNum, defaultDayState());
      result = await atomicIncrement(stateId, path.split('.'), delta);
    }
    if (!result) return jsonError('Database unavailable', 503);
    if (result.error) return jsonError(result.error);
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('POST /api/increment error:', e);
    return jsonError('Terjadi kesalahan', 500);
  }
}
