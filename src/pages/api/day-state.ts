import type { APIContext } from 'astro';
import { getDayState, saveDayState, getAllDayStates, defaultDayState, supaBroadcast } from '../../lib/db';

function deepMerge(target: any, source: any): any {
  if (source === null || source === undefined) return target;
  if (Array.isArray(source)) return source;
  if (typeof source !== 'object') return source;
  const result = Array.isArray(target) ? [...target] : { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key]) && target && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

export async function GET({ url }: APIContext) {
  try {
    const dayParam = url.searchParams.get('day');
    if (dayParam === 'all') {
      const states = await getAllDayStates();
      for (let i = 1; i <= 4; i++) {
        if (!states[String(i)]) states[String(i)] = defaultDayState();
      }
      return new Response(JSON.stringify(states), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const day = parseInt(dayParam || '1');
    if (day < 1 || day > 4) {
      return new Response(JSON.stringify({ error: 'Invalid day' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const data = await getDayState(day);
    return new Response(JSON.stringify(data || defaultDayState()), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('GET /api/day-state error:', e);
    return new Response(JSON.stringify(defaultDayState()), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export async function PATCH({ request, url }: APIContext) {
  try {
    const day = parseInt(url.searchParams.get('day') || '1');
    if (day < 1 || day > 4) {
      return new Response(JSON.stringify({ error: 'Invalid day' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const body = await request.json();
    if (!body || typeof body !== 'object') {
      return new Response(JSON.stringify({ error: 'Invalid body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    // Deep merge: read current state, merge incoming on top, save result
    const existing = await getDayState(day) || defaultDayState();
    const merged = deepMerge(existing as any, body as any);
    await saveDayState(day, merged);
    await supaBroadcast('day-' + day);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('PATCH /api/day-state error:', e);
    return new Response(JSON.stringify({ error: e?.message || 'Save failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
