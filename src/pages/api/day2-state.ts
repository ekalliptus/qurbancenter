import type { APIContext } from 'astro';
import { getDay2State, defaultDay2State, mergeState } from '../../lib/db';

export async function GET() {
  try {
    const data = await getDay2State();
    return new Response(JSON.stringify(data || defaultDay2State()), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
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
    await mergeState('day2', defaultDay2State(), body);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('PATCH /api/day2-state error:', e);
    return new Response(JSON.stringify({ error: e?.message || 'Save failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
