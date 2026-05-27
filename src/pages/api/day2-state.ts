import type { APIContext } from 'astro';
import { getDay2State, saveDay2State, defaultDay2State, supaBroadcast } from '../../lib/db';

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

export async function GET() {
  try {
    const data = await getDay2State();
    return new Response(JSON.stringify(data || defaultDay2State()), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('GET /api/day2-state error:', e);
    return new Response(JSON.stringify(defaultDay2State()), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export async function PATCH({ request }: APIContext) {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object') {
      return new Response(JSON.stringify({ error: 'Invalid body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const existing = await getDay2State() || defaultDay2State();
    const merged = deepMerge(existing as any, body as any);
    await saveDay2State(merged);
    await supaBroadcast('day2');
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('PATCH /api/day2-state error:', e);
    return new Response(JSON.stringify({ error: e?.message || 'Save failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
