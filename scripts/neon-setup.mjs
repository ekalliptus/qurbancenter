// Applies neon/schema.sql to the Neon database in DATABASE_URL (.dev.vars).
// Idempotent — safe to re-run after schema changes.
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

function readDevVars() {
  const txt = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8');
  const out = {};
  for (const line of txt.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const { DATABASE_URL } = readDevVars();
if (!DATABASE_URL || !DATABASE_URL.startsWith('postgresql')) {
  console.error('Missing/invalid DATABASE_URL in .dev.vars');
  process.exit(1);
}
const sql = neon(DATABASE_URL);

const schema = readFileSync(new URL('../neon/schema.sql', import.meta.url), 'utf8');
// Split on ";" outside $$ dollar-quoted bodies, then drop comment-only chunks.
function splitStatements(text) {
  const out = [];
  let cur = '', inDollar = false;
  for (let i = 0; i < text.length; i++) {
    const two = text.slice(i, i + 2);
    if (two === '$$') { inDollar = !inDollar; cur += two; i++; continue; }
    if (text[i] === ';' && !inDollar) { out.push(cur); cur = ''; continue; }
    cur += text[i];
  }
  if (cur.trim()) out.push(cur);
  return out.map(s => s.trim()).filter(Boolean);
}
const statements = splitStatements(schema.replace(/--[^\n]*/g, ''));

for (const stmt of statements) {
  const label = stmt.slice(0, 60).replace(/\s+/g, ' ');
  try {
    await sql.query(stmt, []);
    console.log(`ok   ${label}`);
  } catch (e) {
    console.error(`FAIL ${label}\n     ${e.message}`);
    process.exit(1);
  }
}
const tables = await sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`;
console.log('\nTables:', tables.map(t => t.table_name).join(', '));
