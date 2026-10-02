// Brutal input & concurrency test for Qurban Center.
//
//   bun scripts/brutal-test.mjs
//
// Phase A needs nothing but a running server (dummy DATABASE_URL is fine).
// Phases B-E need TEST_EMAIL/TEST_PASSWORD (one shared account) plus a real
// DATABASE_URL in .dev.vars: they hammer /api/increment with dozens of
// concurrent "users" on the same account, verify the atomic RPC preserves
// every increment, then restore the day-4 state row.
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { neon } from '@neondatabase/serverless';

const BASE = process.env.BRUTAL_BASE || 'http://127.0.0.1:8788';
const results = [];

function record(name, pass, detail = '') {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

function readDevVars() {
  try {
    const txt = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8');
    const out = {};
    for (const line of txt.split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].replace(/^"|"$/g, '');
    }
    return out;
  } catch {
    return {};
  }
}

const cfg = { ...readDevVars(), ...process.env };
const hasDb = !!cfg.DATABASE_URL && cfg.DATABASE_URL.startsWith('postgresql');
const dbSql = hasDb ? neon(cfg.DATABASE_URL) : null;

async function dbGetRow(id) {
  const rows = await dbSql`select data from qurban_state where id = ${id}`;
  return rows.length ? rows[0].data : null;
}

async function dbUpsertRow(id, data) {
  await dbSql`insert into qurban_state (id, data, updated_at)
    values (${id}, ${JSON.stringify(data)}::jsonb, now())
    on conflict (id) do update set data = ${JSON.stringify(data)}::jsonb, updated_at = now()`;
}

async function dbDeleteRow(id) {
  await dbSql`delete from qurban_state where id = ${id}`;
}

// node:http with agent:false — bun fetch's connection pool stalls on workerd's
// empty-body 302 keep-alive responses (Windows local dev), which fetch cannot
// avoid since Connection is a forbidden header there.
async function api(method, path, { body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const payload = body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      agent: false,
      headers: {
        'Content-Type': 'application/json',
        ...(payload !== null ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(cookie ? { Cookie: `qurban_auth=${cookie}` } : {}),
      },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch {}
        resolve({ status: res.statusCode, json, headers: res.headers });
      });
    });
    req.setTimeout(120000, () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

async function login(email, password) {
  const r = await api('POST', '/api/login', { body: { email, password } });
  const setCookie = r.headers['set-cookie']?.[0] || r.headers['set-cookie'] || '';
  const m = r.json && r.json.ok ? /qurban_auth=([^;]+)/.exec(Array.isArray(setCookie) ? setCookie[0] : setCookie) : null;
  return { ...r, cookie: m ? m[1] : null };
}

// Phase A — public endpoints, hostile input, no credentials needed.

async function phaseA() {
  console.log('\n── FASE A · endpoint publik & input hostile ──');
  if (hasDb) await dbSql`delete from login_attempts`;
  let r = await api('GET', '/api/health');
  record('A1  health 200', r.status === 200 && r.json?.status === 'ok');

  r = await api('POST', '/api/login', { body: '{bukan json' });
  record('A2  JSON rusak -> 400', r.status === 400, `dapat ${r.status}`);

  const sqli = ["admin'--", "' OR 1=1--", 'admin@x.com" --', "'; DROP TABLE qurban_users;--"];
  let ok = true;
  for (const e of sqli) {
    const rr = await api('POST', '/api/login', { body: { email: e, password: 'x' } });
    if (rr.status !== 401) { ok = false; break; }
  }
  record('A3  SQLi di email -> 401 konsisten', ok);

  r = await api('POST', '/api/login', { body: { email: '<script>alert(1)</script>@x.com', password: 'x' } });
  record('A4  XSS payload -> 401', r.status === 401, `dapat ${r.status}`);

  r = await api('POST', '/api/login', { body: { email: 'a'.repeat(10000) + '@x.com', password: 'x' } });
  record('A5  email 10KB tidak 500', r.status === 401 || r.status === 413, `dapat ${r.status}`);

  r = await api('POST', '/api/increment', { body: { day: 1, path: 'karkas.total', delta: 1 } });
  record('A6  increment tanpa login -> 302', r.status === 302, `dapat ${r.status}`);

  r = await api('GET', '/api/state');
  record('A7  state tanpa cookie -> 302', r.status === 302, `dapat ${r.status}`);

  r = await api('GET', '/api/state', { cookie: 'viewer' });
  record('A8  cookie viewer -> 200', r.status === 200, `dapat ${r.status}`);

  r = await api('POST', '/api/increment', { cookie: 'viewer', body: { day: 1, path: 'karkas.total', delta: 1 } });
  record('A9  viewer POST -> 403', r.status === 403, `dapat ${r.status}`);

  let hit429 = false, last = 0;
  for (let i = 0; i < 8; i++) {
    last = (await api('POST', '/api/login', { body: { email: 'brute@ratelimit.test', password: 'wrong' } })).status;
    if (last === 429) { hit429 = true; break; }
  }
  record('A10 rate limit login -> 429', hit429, `status terakhir ${last}`);
}

// Phase B — same shared account, many concurrent users.

function testState(totalHewan) {
  return {
    totalHewan,
    kandang: [1, 2, 3].map(no => ({ no, total: 12, keluar: 0, waktuMulai: '', waktuSelesai: '' })),
    sembelih: [1, 2, 3].map(no => ({ no, dipotong: 0, waktuMulai: '', waktuSelesai: '' })),
    karkas: { total: 0, waktuMulai: '', waktuSelesai: '' },
    abf: { keluar: 0, waktuMulai: '', waktuSelesai: '' },
    cacahDariAbf: 0,
  };
}

async function hammer(cookie, workers, perWorker, payload) {
  const responses = [];
  await Promise.all(Array.from({ length: workers }, async () => {
    for (let i = 0; i < perWorker; i++) responses.push(await api('POST', '/api/increment', { cookie, body: payload(i) }));
  }));
  return responses;
}

async function phaseB() {
  console.log('\n── FASE B · 1 akun, banyak user concurrent ──');

  const logins = await Promise.all(Array.from({ length: 5 }, () => login(cfg.TEST_EMAIL, cfg.TEST_PASSWORD)));
  const tokens = [...new Set(logins.filter(l => l.cookie).map(l => l.cookie))];
  record('B0  5 login paralel akun sama -> 5 sesi valid', tokens.length === 5 &&
    (await Promise.all(tokens.map(t => api('GET', '/api/day-state?day=4', { cookie: t })))).every(r => r.status === 200),
    `${tokens.length} token`);

  await dbUpsertRow('day-4', testState(10));
  const res500 = await hammer(tokens[0], 20, 25, () => ({ day: 4, path: 'karkas.total', delta: 1 }));
  const ok500 = res500.filter(r => r.status === 200 && r.json?.ok === true).length;
  const final500 = (await dbGetRow('day-4')).karkas.total;
  record('B1  500 increment (+1) tidak ada yang hilang', ok500 === 500 && final500 === 500,
    `ok ${ok500}/500, nilai akhir ${final500}`);

  await dbUpsertRow('day-4', testState(10));
  const up = await hammer(tokens[0], 10, 10, () => ({ day: 4, path: 'cacahDariAbf', delta: 1 }));
  const down = await hammer(tokens[0], 10, 10, () => ({ day: 4, path: 'cacahDariAbf', delta: -1 }));
  const mid = (await dbGetRow('day-4')).cacahDariAbf;
  const extraDown = await hammer(tokens[0], 10, 5, () => ({ day: 4, path: 'cacahDariAbf', delta: -1 }));
  const end = (await dbGetRow('day-4')).cacahDariAbf;
  record('B2  100 naik lalu 100 turun -> tepat 0',
    up.every(r => r.status === 200) && down.every(r => r.status === 200) && mid === 0, `tengah ${mid}`);
  record('B3  50 turun lagi saat nol -> semua capped, tetap 0',
    extraDown.every(r => r.json?.capped === true) && end === 0, `capped ${extraDown.filter(r => r.json?.capped).length}/50, akhir ${end}`);

  await dbUpsertRow('day-4', testState(10));
  const resCap = await hammer(tokens[0], 50, 1, () => ({ day: 4, path: 'kandang.0.keluar', delta: 1 }));
  const st = await dbGetRow('day-4');
  const sumKeluar = st.kandang.reduce((a, k) => a + (k.keluar || 0), 0);
  const capped = resCap.filter(r => r.json?.capped === true).length;
  record('B4  cap totalHewan=10 di bawah 50 klik serentak', sumKeluar === 10 && capped === 40 && st.kandang[0].keluar === 10,
    `sum ${sumKeluar}, capped ${capped}`);

  console.log('\n── FASE C · input value brutal ke increment ──');
  const brutal = [
    ['delta float 1.5', { day: 4, path: 'karkas.total', delta: 1.5 }],
    ['delta raksasa 1e15', { day: 4, path: 'karkas.total', delta: 1e15 }],
    ['delta negatif -9999', { day: 4, path: 'karkas.total', delta: -9999 }],
    ['delta string "1"', { day: 4, path: 'karkas.total', delta: '1' }],
    ['delta null', { day: 4, path: 'karkas.total', delta: null }],
    ['delta NaN via 1e999', '{ "day": 4, "path": "karkas.total", "delta": 1e999 }'],
    ['path __proto__', { day: 4, path: '__proto__.polluted', delta: 1 }],
    ['path constructor', { day: 4, path: 'constructor.prototype.x', delta: 1 }],
    ['path sembarangan', { day: 4, path: 'karkas.bogus', delta: 1 }],
    ['day 0', { day: 0, path: 'karkas.total', delta: 1 }],
    ['day 99', { day: 99, path: 'karkas.total', delta: 1 }],
    ["day \"1'--\"", { day: "1'--", path: 'karkas.total', delta: 1 }],
  ];
  let allRejected = true;
  for (const [name, body] of brutal) {
    const rr = await api('POST', '/api/increment', { cookie: tokens[0], body });
    if (rr.status !== 400) { allRejected = false; record(`C   ${name} -> 400`, false, `dapat ${rr.status}`); }
  }
  record('C   12 payload brutal ditolak 400', allRejected);
  const clean = (await dbGetRow('day-4')).karkas.total;
  record('C   state tak tersentuh setelah payload brutal', clean === 0, `karkas.total = ${clean}`);

  console.log('\n── FASE D · PATCH storm (merge atomik di SQL) ──');
  await dbUpsertRow('day-4', testState(10));
  const sent = new Set();
  await Promise.all(Array.from({ length: 10 }, async (_, w) => {
    for (let j = 0; j < 5; j++) {
      const v = w * 1000 + j;
      sent.add(v);
      await api('PATCH', '/api/day-state?day=4', { cookie: tokens[0], body: { karkas: { total: v } } });
    }
  }));
  const finalPatch = (await dbGetRow('day-4')).karkas.total;
  record('D   PATCH storm: merge atomik, nilai akhir salah satu tulisan', Number.isInteger(finalPatch) && sent.has(finalPatch),
    `akhir ${finalPatch}`);

  console.log('\n── FASE E · restore ──');
  const tokens2 = [...tokens];
  await dbUpsertRow('day-4', testState(0));
  try { await dbSql`delete from qurban_sessions where token = any(${tokens2})`; } catch {}
  record('E   sesi test dibersihkan, day-4 direset', true);
}

console.log(`Brutal test → ${BASE}`);
try {
  await phaseA();
} catch (e) {
  record('A   fase A selesai tanpa crash', false, e.message);
}
if (!hasDb) {
  console.log('\nFASE B–E dilewati: butuh DATABASE_URL (Neon) di .dev.vars + TEST_EMAIL/TEST_PASSWORD.');
} else {
  const main = await login(cfg.TEST_EMAIL, cfg.TEST_PASSWORD);
  if (!main.cookie) {
    console.log(`\nFASE B–E dilewati: login test account gagal (${main.status}).`);
  } else {
    const backup = await dbGetRow('day-4');
    try {
      await phaseB();
    } finally {
      if (backup === null) await dbDeleteRow('day-4');
      else if (backup.karkas) await dbUpsertRow('day-4', backup);
    }
    console.log('\nFASE E · backup day-4 dipulihkan.');
  }
}
const failed = results.filter(r => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} PASS${failed ? ` — ${failed} FAIL` : ''}`);
process.exit(failed ? 1 : 0);
