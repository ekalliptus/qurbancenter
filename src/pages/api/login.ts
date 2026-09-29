import type { APIContext } from 'astro';
import { VIEWER_TOKEN, COOKIE_NAME } from '../../lib/auth';
import { findUserByEmail, createSession, deleteSession, loginIsLimited, loginRecordFailure, loginClear } from '../../lib/users';
import { logActivity } from '../../lib/db';
import { verifyPassword } from '../../lib/crypto';

// Valid-format hash of a throwaway value: verifying against it burns the same
// PBKDF2 time as a real lookup when the email doesn't exist, so response
// timing can't be used to enumerate accounts.
const DUMMY_HASH = 'MDEyMzQ1Njc4OWFiY2RlZg==:MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';

export async function POST({ request }: APIContext) {
  const secure = request.url.startsWith('https');
  const maxAge = 60 * 60 * 24 * 7;
  const cookieOpts = `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;

  let body: { email?: string; password?: string; role?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Body tidak valid' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  const { email, password, role } = body ?? {};

  if (role === 'viewer') {
    return new Response(JSON.stringify({ ok: true, role: 'viewer' }), {
      headers: { 'Content-Type': 'application/json', 'Set-Cookie': `${COOKIE_NAME}=${VIEWER_TOKEN}; ${cookieOpts}` },
    });
  }

  const fail = () => new Response(JSON.stringify({ error: 'Email atau password salah' }), {
    status: 401, headers: { 'Content-Type': 'application/json' },
  });

  if (!email || !password) return fail();
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const limiterKey = ip + ':' + email.toLowerCase();
  if (await loginIsLimited(limiterKey)) {
    return new Response(JSON.stringify({ error: 'Terlalu banyak percobaan. Coba lagi nanti.' }), {
      status: 429, headers: { 'Content-Type': 'application/json' },
    });
  }

  const user = await findUserByEmail(email);
  const ok = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) {
    await loginRecordFailure(limiterKey);
    return fail();
  }
  await loginClear(limiterKey);

  const token = await createSession(user.id, user.role, user.email);
  if (!token) {
    return new Response(JSON.stringify({ error: 'Gagal membuat sesi' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
  await logActivity(user.email, 'login', ip);
  return new Response(JSON.stringify({ ok: true, role: user.role }), {
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': `${COOKIE_NAME}=${token}; ${cookieOpts}` },
  });
}

export async function DELETE({ request, cookies }: APIContext) {
  const secure = request.url.startsWith('https');
  const token = cookies.get(COOKIE_NAME)?.value;
  if (token && token !== VIEWER_TOKEN) await deleteSession(token);
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`,
    },
  });
}
