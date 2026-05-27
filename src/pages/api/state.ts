import type { APIContext } from 'astro';
import { getState, saveState, defaultState, supaBroadcast } from '../../lib/db';

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
    const data = await getState();
    return new Response(JSON.stringify(data || defaultState()), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('GET /api/state error:', e);
    return new Response(JSON.stringify(defaultState()), {
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
    const existing = await getState() || defaultState();
    const merged = deepMerge(existing as any, body as any);
    await saveState(merged);
    await supaBroadcast('default');
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('PATCH /api/state error:', e);
    return new Response(JSON.stringify({ error: e?.message || 'Save failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
