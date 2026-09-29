import type { APIContext } from 'astro';
import { getDbVersion } from '../../lib/db';

export async function GET() {
  try {
    const v = await getDbVersion();
    return new Response(JSON.stringify({ v }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ v: '' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
