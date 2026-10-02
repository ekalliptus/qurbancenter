import type { APIContext } from 'astro';
import { resetState, logActivity } from '../../lib/db';

export async function POST({ locals }: APIContext) {
  if (locals.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Admin only' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const data = await resetState();
    await logActivity(locals.email, 'state.reset', 'default');
    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('POST /api/reset error:', e);
    return new Response(JSON.stringify({ error: e?.message || 'Reset failed' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}
