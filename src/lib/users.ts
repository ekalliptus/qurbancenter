import { getEnv } from './env';
import { hashPassword, generateToken } from './crypto';

export type Role = 'admin' | 'editor' | 'viewer';
export interface UserRow { id: string; email: string; role: Role; active: boolean; created_at: string; }

function cfg() {
  return { url: getEnv('SUPABASE_URL'), key: getEnv('SUPABASE_SERVICE_KEY') };
}
function headers() {
  const { key } = cfg();
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

export async function findUserByEmail(email: string): Promise<(UserRow & { password_hash: string }) | null> {
  const { url } = cfg();
  const res = await fetch(
    `${url}/rest/v1/qurban_users?email=eq.${encodeURIComponent(email)}&active=eq.true&select=id,email,role,active,created_at,password_hash`,
    { headers: headers() }
  );
  if (!res.ok) return null;
  const rows = await res.json() as any[];
  return rows.length ? rows[0] : null;
}

export async function listUsers(): Promise<UserRow[]> {
  const { url } = cfg();
  const res = await fetch(`${url}/rest/v1/qurban_users?select=id,email,role,active,created_at&order=created_at`, { headers: headers() });
  if (!res.ok) return [];
  return res.json() as Promise<UserRow[]>;
}

export async function countAdmins(): Promise<number> {
  const { url } = cfg();
  const res = await fetch(`${url}/rest/v1/qurban_users?role=eq.admin&active=eq.true&select=id`, { headers: headers() });
  if (!res.ok) return 0;
  return (await res.json() as any[]).length;
}

export async function createUser(email: string, password: string, role: Role): Promise<{ ok: boolean; error?: string }> {
  const { url } = cfg();
  const password_hash = await hashPassword(password);
  const res = await fetch(`${url}/rest/v1/qurban_users`, {
    method: 'POST',
    headers: { ...headers(), Prefer: 'return=minimal' },
    body: JSON.stringify({ email, password_hash, role }),
  });
  if (res.status === 409) return { ok: false, error: 'Email sudah terdaftar' };
  if (!res.ok) return { ok: false, error: `DB error ${res.status}` };
  return { ok: true };
}

export async function updateUser(id: string, patch: { password?: string; role?: Role; active?: boolean }): Promise<{ ok: boolean; error?: string }> {
  const { url } = cfg();
  const body: Record<string, unknown> = {};
  if (patch.password) body.password_hash = await hashPassword(patch.password);
  if (patch.role) body.role = patch.role;
  if (typeof patch.active === 'boolean') body.active = patch.active;
  if (Object.keys(body).length === 0) return { ok: true };
  const res = await fetch(`${url}/rest/v1/qurban_users?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...headers(), Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, error: `DB error ${res.status}` };
  return { ok: true };
}

export async function deleteUser(id: string): Promise<{ ok: boolean; error?: string }> {
  const { url } = cfg();
  const res = await fetch(`${url}/rest/v1/qurban_users?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: { ...headers(), Prefer: 'return=minimal' },
  });
  if (!res.ok) return { ok: false, error: `DB error ${res.status}` };
  return { ok: true };
}

export async function createSession(userId: string, role: Role): Promise<string | null> {
  const { url } = cfg();
  const token = generateToken();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const res = await fetch(`${url}/rest/v1/qurban_sessions`, {
    method: 'POST',
    headers: { ...headers(), Prefer: 'return=minimal' },
    body: JSON.stringify({ token, user_id: userId, role, expires_at: expires }),
  });
  if (!res.ok) return null;
  return token;
}

export async function getSession(token: string): Promise<{ role: Role } | null> {
  if (!token) return null;
  const { url } = cfg();
  const nowIso = new Date().toISOString();
  const res = await fetch(
    `${url}/rest/v1/qurban_sessions?token=eq.${encodeURIComponent(token)}&expires_at=gt.${encodeURIComponent(nowIso)}&select=role`,
    { headers: headers() }
  );
  if (!res.ok) return null;
  const rows = await res.json() as any[];
  return rows.length ? { role: rows[0].role } : null;
}

export async function deleteSession(token: string): Promise<void> {
  if (!token) return;
  const { url } = cfg();
  await fetch(`${url}/rest/v1/qurban_sessions?token=eq.${encodeURIComponent(token)}`, {
    method: 'DELETE', headers: { ...headers(), Prefer: 'return=minimal' },
  }).catch(() => {});
}
