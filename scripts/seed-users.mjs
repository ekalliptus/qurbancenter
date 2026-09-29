// Usage: node scripts/seed-users.mjs <email> <password> <role> [<email> <password> <role> ...]
// Reads DATABASE_URL from .dev.vars, seeds the given accounts (idempotent —
// skips if email already exists). Roles: admin|editor|viewer.
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const ITERATIONS = 100_000, KEY_LEN = 32;
const enc = new TextEncoder();
const toB64 = (buf) => Buffer.from(new Uint8Array(buf)).toString('base64');
async function hash(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const km = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, km, KEY_LEN * 8);
  return `${toB64(salt.buffer)}:${toB64(bits)}`;
}

function readDevVars() {
  const txt = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8');
  const out = {};
  for (const line of txt.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return out;
}

const [, , ...args] = process.argv;
if (args.length === 0 || args.length % 3 !== 0) {
  console.error('Usage: node scripts/seed-users.mjs <email> <password> <role> [...]\nRoles: admin | editor | viewer');
  process.exit(1);
}
const accounts = [];
for (let i = 0; i < args.length; i += 3) {
  const [email, password, role] = [args[i], args[i + 1], args[i + 2]];
  if (!email.includes('@') || password.length < 8 || !['admin', 'editor', 'viewer'].includes(role)) {
    console.error(`Invalid account #${i / 3 + 1}: email must contain @, password >= 8 chars, role admin|editor|viewer`);
    process.exit(1);
  }
  accounts.push({ email, password, role });
}

const { DATABASE_URL } = readDevVars();
if (!DATABASE_URL || !DATABASE_URL.startsWith('postgresql')) {
  console.error('Missing/invalid DATABASE_URL in .dev.vars');
  process.exit(1);
}
const sql = neon(DATABASE_URL);

for (const a of accounts) {
  const existing = await sql`select id from qurban_users where email = ${a.email}`;
  if (existing.length) { console.log(`skip ${a.email} (exists)`); continue; }
  const password_hash = await hash(a.password);
  try {
    await sql`insert into qurban_users (email, password_hash, role) values (${a.email}, ${password_hash}, ${a.role})`;
    console.log(`${a.email}: seeded`);
  } catch (e) {
    console.error(`${a.email}: FAILED ${e.message}`);
  }
}
