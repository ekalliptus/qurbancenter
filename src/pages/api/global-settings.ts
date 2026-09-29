import type { APIContext } from 'astro';
import { getGlobalSettings, saveGlobalSettings } from '../../lib/db';

export async function GET() {
  try {
    const data = await getGlobalSettings();
    return new Response(JSON.stringify(data || { darkMode: false, theme: {}, autoRefresh: true, featureConfig: {}, monitorWidgets: {}, monitorOrder: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('GET /api/global-settings error:', e);
    return new Response(JSON.stringify({ darkMode: false, theme: {}, autoRefresh: true, featureConfig: {}, monitorWidgets: {}, monitorOrder: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export async function PATCH({ request, locals }: APIContext) {
  if (locals.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Admin only' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object') {
      return new Response(JSON.stringify({ error: 'Invalid body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    await saveGlobalSettings(body);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('PATCH /api/global-settings error:', e);
    return new Response(JSON.stringify({ error: e?.message || 'Save failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
