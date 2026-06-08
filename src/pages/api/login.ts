import type { APIContext } from 'astro';
import { VIEWER_TOKEN, COOKIE_NAME } from '../../lib/auth';
import { findUserByEmail, createSession, deleteSession } from '../../lib/users';
import { verifyPassword } from '../../lib/crypto';

export async function POST({ request }: APIContext) {
  const body = await request.json();
  const { email, password, role } = body as { email?: string; password?: string; role?: string };
  const secure = request.url.startsWith('https');
  const maxAge = 60 * 60 * 24 * 7;
  const cookieOpts = `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;

  if (role === 'viewer') {
    return new Response(JSON.stringify({ ok: true, role: 'viewer' }), {
      headers: { 'Content-Type': 'application/json', 'Set-Cookie': `${COOKIE_NAME}=${VIEWER_TOKEN}; ${cookieOpts}` },
    });
  }

  const fail = () => new Response(JSON.stringify({ error: 'Email atau password salah' }), {
    status: 401, headers: { 'Content-Type': 'application/json' },
  });

  if (!email || !password) return fail();
  const user = await findUserByEmail(email);
  if (!user) return fail();
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return fail();

  const token = await createSession(user.id, user.role);
  if (!token) {
    return new Response(JSON.stringify({ error: 'Gagal membuat sesi' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({ ok: true, role: user.role }), {
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': `${COOKIE_NAME}=${token}; ${cookieOpts}` },
  });
}

export async function DELETE({ request }: APIContext) {
  const secure = request.url.startsWith('https');
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (m && m[1] !== VIEWER_TOKEN) await deleteSession(m[1]);
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`,
    },
  });
}
