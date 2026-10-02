import { neon } from '@neondatabase/serverless';
import { getEnv } from './env';
import { hashPassword, generateToken } from './crypto';

export type Role = 'admin' | 'editor' | 'viewer';
export interface UserRow { id: string; email: string; role: Role; active: boolean; created_at: string; }

let _sql: ReturnType<typeof neon> | null = null;
function sql() {
  if (!_sql) _sql = neon(getEnv('DATABASE_URL'));
  return _sql;
}

// NeonDbError carries a Postgres error code; extract it from unknown catches.
function dbErrorCode(e: unknown): string | undefined {
  return typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : undefined;
}
function dbErrorLabel(e: unknown): string {
  const code = dbErrorCode(e);
  return code ? `DB error ${code}` : 'DB error';
}

export async function findUserByEmail(email: string): Promise<(UserRow & { password_hash: string }) | null> {
  try {
    const rows = await sql()`select id, email, role, active, created_at, password_hash
      from qurban_users where email = ${email} and active = true limit 1`;
    return rows.length ? rows[0] : null;
  } catch {
    return null;
  }
}

export async function listUsers(): Promise<UserRow[]> {
  try {
    return await sql()`select id, email, role, active, created_at from qurban_users order by created_at`;
  } catch {
    return [];
  }
}

export async function countAdmins(): Promise<number> {
  try {
    const rows = await sql()`select count(*)::int as c from qurban_users where role = 'admin' and active = true`;
    return rows[0].c;
  } catch {
    return 0;
  }
}

export async function createUser(email: string, password: string, role: Role): Promise<{ ok: boolean; error?: string }> {
  const password_hash = await hashPassword(password);
  try {
    await sql()`insert into qurban_users (email, password_hash, role) values (${email}, ${password_hash}, ${role})`;
    return { ok: true };
  } catch (e) {
    if (dbErrorCode(e) === '23505') return { ok: false, error: 'Email sudah terdaftar' };
    return { ok: false, error: dbErrorLabel(e) };
  }
}

export async function updateUser(id: string, patch: { password?: string; role?: Role; active?: boolean }): Promise<{ ok: boolean; error?: string }> {
  try {
    if (patch.password) {
      const password_hash = await hashPassword(patch.password);
      await sql()`update qurban_users set password_hash = ${password_hash} where id = ${id}`;
    }
    if (patch.role) {
      await sql()`update qurban_users set role = ${patch.role} where id = ${id}`;
    }
    if (typeof patch.active === 'boolean') {
      await sql()`update qurban_users set active = ${patch.active} where id = ${id}`;
    }
  } catch (e) {
    return { ok: false, error: dbErrorLabel(e) };
  }
  // Revoke existing sessions when role/active changes — the session row holds a
  // denormalized role, so a live cookie would otherwise keep stale privileges
  // (or access after deactivation) until expiry. Force re-login.
  if (patch.role !== undefined || patch.active !== undefined) {
    await deleteUserSessions(id);
  }
  return { ok: true };
}

async function deleteUserSessions(userId: string): Promise<void> {
  try {
    await sql()`delete from qurban_sessions where user_id = ${userId}`;
  } catch {
    // best effort
  }
}

export async function deleteUser(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await sql()`delete from qurban_users where id = ${id}`;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: dbErrorLabel(e) };
  }
}

export async function createSession(userId: string, role: Role, email: string): Promise<string | null> {
  const token = generateToken();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  try {
    await sql()`insert into qurban_sessions (token, user_id, role, email, expires_at)
      values (${token}, ${userId}, ${role}, ${email}, ${expires.toISOString()})`;
    return token;
  } catch {
    return null;
  }
}

export async function getSession(token: string): Promise<{ role: Role; email: string } | null> {
  if (!token) return null;
  try {
    const rows = await sql()`select role, email from qurban_sessions where token = ${token} and expires_at > now()`;
    return rows.length ? { role: rows[0].role, email: rows[0].email } : null;
  } catch {
    return null;
  }
}

export async function deleteSession(token: string): Promise<void> {
  if (!token) return;
  try {
    await sql()`delete from qurban_sessions where token = ${token}`;
  } catch {
    // best effort
  }
}

// --- Durable login rate limiting (login_attempts + functions in neon/schema.sql).
// Fail open on DB errors: availability beats strict limiting for this app.

export async function loginIsLimited(key: string): Promise<boolean> {
  try {
    const rows = await sql()`select login_is_limited(${key}) as limited`;
    return rows[0].limited;
  } catch {
    return false;
  }
}

export async function loginRecordFailure(key: string): Promise<void> {
  try {
    await sql()`select login_record_failure(${key})`;
  } catch {
    // best effort
  }
}

export async function loginClear(key: string): Promise<void> {
  try {
    await sql()`select login_clear(${key})`;
  } catch {
    // best effort
  }
}

export async function listActivity(limit = 50): Promise<Array<{ actor: string; action: string; detail: string; at: string }>> {
  try {
    return await sql()`select actor, action, detail, at from activity_logs order by at desc limit ${limit}`;
  } catch {
    return [];
  }
}
