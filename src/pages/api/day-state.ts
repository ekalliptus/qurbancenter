import type { APIContext } from 'astro';
import { getDayState, getAllDayStates, defaultDayState, mergeState } from '../../lib/db';

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
  } catch (e) {
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
    // Atomic in-database merge — concurrent PATCHes no longer race.
    await mergeState('day-' + day, defaultDayState(), body);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('PATCH /api/day-state error:', e);
    return new Response(JSON.stringify({ error: e?.message || 'Save failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
