import type { APIContext } from 'astro';
import { getAuthConfig, VIEWER_TOKEN, COOKIE_NAME } from '../../lib/auth';

export async function POST({ request }: APIContext) {
  const body = await request.json();
  const { email, password, role } = body;
  const secure = request.url.startsWith('https');
  const maxAge = 60 * 60 * 24 * 7;
  const cookieOpts = `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;

  if (role === 'viewer') {
    return new Response(JSON.stringify({ ok: true, role: 'viewer' }), {
      headers: { 'Content-Type': 'application/json', 'Set-Cookie': `${COOKIE_NAME}=${VIEWER_TOKEN}; ${cookieOpts}` },
    });
  }

  const cfg = getAuthConfig();

  if (cfg.adminEmail && email === cfg.adminEmail && password === cfg.adminPassword) {
    return new Response(JSON.stringify({ ok: true, role: 'admin' }), {
      headers: { 'Content-Type': 'application/json', 'Set-Cookie': `${COOKIE_NAME}=${cfg.adminToken}; ${cookieOpts}` },
    });
  }

  if (cfg.editorEmail && email === cfg.editorEmail && password === cfg.editorPassword) {
    return new Response(JSON.stringify({ ok: true, role: 'editor' }), {
      headers: { 'Content-Type': 'application/json', 'Set-Cookie': `${COOKIE_NAME}=${cfg.editorToken}; ${cookieOpts}` },
    });
  }

  return new Response(JSON.stringify({ error: 'Email atau password salah' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function DELETE({ request }: APIContext) {
  const secure = request.url.startsWith('https');
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`,
    },
  });
}
