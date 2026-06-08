// Usage: node scripts/seed-users.mjs
// Reads SUPABASE_URL + SUPABASE_SERVICE_KEY from .dev.vars, seeds the two
// existing accounts (idempotent — skips if email already exists).
import { readFileSync } from 'node:fs';

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

const env = readDevVars();
const URL_ = env.SUPABASE_URL, KEY = env.SUPABASE_SERVICE_KEY;
if (!URL_ || !KEY) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY in .dev.vars'); process.exit(1); }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

const accounts = [
  { email: 'admin@alfatihah.com', password: 'Support99', role: 'admin' },
  { email: 'DB@alfatihah.com', password: 'QurbanJaya99', role: 'editor' },
];

for (const a of accounts) {
  const check = await fetch(`${URL_}/rest/v1/qurban_users?email=eq.${encodeURIComponent(a.email)}&select=id`, { headers: H });
  const existing = await check.json();
  if (existing.length) { console.log(`skip ${a.email} (exists)`); continue; }
  const password_hash = await hash(a.password);
  const res = await fetch(`${URL_}/rest/v1/qurban_users`, {
    method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
    body: JSON.stringify({ email: a.email, password_hash, role: a.role }),
  });
  console.log(`${a.email}: ${res.ok ? 'seeded' : 'FAILED ' + res.status}`);
}
