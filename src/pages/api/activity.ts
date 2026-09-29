import type { APIContext } from 'astro';
import { listActivity } from '../../lib/users';

export async function GET({ locals }: APIContext) {
  if (locals.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Admin only' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    });
  }
  const activity = await listActivity(50);
  return new Response(JSON.stringify({ activity }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
