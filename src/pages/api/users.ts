import type { APIContext } from 'astro';
import { listUsers, createUser, updateUser, deleteUser, countAdmins } from '../../lib/users';
import type { Role } from '../../lib/users';

function adminOnly(locals: App.Locals) {
  return locals.role === 'admin';
}
const VALID_ROLES: Role[] = ['admin', 'editor', 'viewer'];

export async function GET({ locals }: APIContext) {
  if (!adminOnly(locals)) return forbidden();
  const users = await listUsers();
  return json({ users });
}

export async function POST({ request, locals }: APIContext) {
  if (!adminOnly(locals)) return forbidden();
  const body = await readJson(request);
  if (!body) return json({ error: 'Body tidak valid' }, 400);
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const { password, role } = body as { password?: string; role?: Role };
  if (!email || !email.includes('@') || !password || !role || !VALID_ROLES.includes(role)) return json({ error: 'Data tidak lengkap' }, 400);
  if (password.length < 8) return json({ error: 'Password minimal 8 karakter' }, 400);
  const r = await createUser(email, password, role);
  return r.ok ? json({ ok: true }) : json({ error: r.error }, 400);
}

export async function PATCH({ request, locals }: APIContext) {
  if (!adminOnly(locals)) return forbidden();
  const body = await readJson(request);
  if (!body) return json({ error: 'Body tidak valid' }, 400);
  const { id, password, role, active } = body as { id?: string; password?: string; role?: Role; active?: boolean };
  if (!id) return json({ error: 'id wajib' }, 400);
  if (role && !VALID_ROLES.includes(role)) return json({ error: 'role tidak valid' }, 400);
  if (password !== undefined && password.length < 8) return json({ error: 'Password minimal 8 karakter' }, 400);
  if (active === false || (role && role !== 'admin')) {
    const admins = await countAdmins();
    if (admins <= 1) {
      const users = await listUsers();
      const target = users.find(u => u.id === id);
      if (target && target.role === 'admin' && target.active) {
        return json({ error: 'Tidak bisa menonaktifkan/menurunkan admin terakhir' }, 400);
      }
    }
  }
  const r = await updateUser(id, { password, role, active });
  return r.ok ? json({ ok: true }) : json({ error: r.error }, 400);
}

export async function DELETE({ request, locals }: APIContext) {
  if (!adminOnly(locals)) return forbidden();
  const body = await readJson(request);
  if (!body) return json({ error: 'Body tidak valid' }, 400);
  const { id } = body as { id?: string };
  if (!id) return json({ error: 'id wajib' }, 400);
  const admins = await countAdmins();
  if (admins <= 1) {
    const users = await listUsers();
    const target = users.find(u => u.id === id);
    if (target && target.role === 'admin' && target.active) {
      return json({ error: 'Tidak bisa menghapus admin terakhir' }, 400);
    }
  }
  const r = await deleteUser(id);
  return r.ok ? json({ ok: true }) : json({ error: r.error }, 400);
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
function forbidden() { return json({ error: 'Admin only' }, 403); }
async function readJson(request: Request): Promise<any | null> {
  try { return await request.json(); } catch { return null; }
}
