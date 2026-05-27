import type { APIContext } from 'astro';
import { getDayState, saveDayState, defaultDayState, supaBroadcast } from '../../lib/db';

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
    if (!day || !path || typeof delta !== 'number') {
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

    const state = await getDayState(dayNum) || defaultDayState();
    const parts = path.split('.');
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
    await supaBroadcast('day-' + dayNum);

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
