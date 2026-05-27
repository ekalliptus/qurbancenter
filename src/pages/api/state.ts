import type { APIContext } from 'astro';
import { getState, saveState, defaultState, supaBroadcast } from '../../lib/db';

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
    await saveState(body);
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
