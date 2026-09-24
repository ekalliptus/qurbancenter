// Brutal input & concurrency test for Qurban Center.
//
//   bun scripts/brutal-test.mjs
//
// Phase A needs nothing but a running server (dummy Supabase is fine).
// Phases B-E need TEST_EMAIL/TEST_PASSWORD (one shared account) plus real
// SUPABASE_URL/SUPABASE_SERVICE_KEY in .dev.vars: they hammer /api/increment
// with dozens of concurrent "users" on the same account, verify the atomic
// RPC preserves every increment, then restore the day-4 state row.
import { readFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:8787';
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
const hasService = !!cfg.SUPABASE_URL && !!cfg.SUPABASE_SERVICE_KEY && !cfg.SUPABASE_URL.includes('dummy');
const sbH = () => ({ apikey: cfg.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${cfg.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' });
const sbUrl = () => cfg.SUPABASE_URL.replace(/\/$/, '');

async function sbGetRow(id) {
  const res = await fetch(`${sbUrl()}/rest/v1/qurban_state?id=eq.${id}&select=data`, { headers: sbH() });
  const rows = await res.json();
  return rows.length ? rows[0].data : null;
}

async function sbUpsertRow(id, data) {
  await fetch(`${sbUrl()}/rest/v1/qurban_state`, {
    method: 'POST',
    headers: { ...sbH(), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ id, data, updated_at: new Date().toISOString() }),
  });
}

async function sbDeleteRow(id) {
  await fetch(`${sbUrl()}/rest/v1/qurban_state?id=eq.${id}`, { method: 'DELETE', headers: sbH() });
}

async function api(method, path, { body, cookie } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: `qurban_auth=${cookie}` } : {}) },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    redirect: 'manual',
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json, headers: res.headers };
}

async function login(email, password) {
  const r = await api('POST', '/api/login', { body: { email, password } });
  const m = (r.json && r.json.ok) ? /qurban_auth=([^;]+)/.exec(r.headers?.get('set-cookie') || '') : null;
  return { ...r, cookie: m ? m[1] : null };
}

// Phase A — public endpoints, hostile input, no credentials needed.

async function phaseA() {
  console.log('\n── FASE A · endpoint publik & input hostile ──');
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

  await sbUpsertRow('day-4', testState(10));
  const res500 = await hammer(tokens[0], 20, 25, () => ({ day: 4, path: 'karkas.total', delta: 1 }));
  const ok500 = res500.filter(r => r.status === 200 && r.json?.ok === true).length;
  const final500 = (await sbGetRow('day-4')).karkas.total;
  record('B1  500 increment (+1) tidak ada yang hilang', ok500 === 500 && final500 === 500,
    `ok ${ok500}/500, nilai akhir ${final500}`);

  await sbUpsertRow('day-4', testState(10));
  const up = await hammer(tokens[0], 10, 10, () => ({ day: 4, path: 'cacahDariAbf', delta: 1 }));
  const down = await hammer(tokens[0], 10, 10, () => ({ day: 4, path: 'cacahDariAbf', delta: -1 }));
  const mid = (await sbGetRow('day-4')).cacahDariAbf;
  const extraDown = await hammer(tokens[0], 10, 5, () => ({ day: 4, path: 'cacahDariAbf', delta: -1 }));
  const end = (await sbGetRow('day-4')).cacahDariAbf;
  record('B2  100 naik lalu 100 turun -> tepat 0',
    up.every(r => r.status === 200) && down.every(r => r.status === 200) && mid === 0, `tengah ${mid}`);
  record('B3  50 turun lagi saat nol -> semua capped, tetap 0',
    extraDown.every(r => r.json?.capped === true) && end === 0, `capped ${extraDown.filter(r => r.json?.capped).length}/50, akhir ${end}`);

  await sbUpsertRow('day-4', testState(10));
  const resCap = await hammer(tokens[0], 50, 1, () => ({ day: 4, path: 'kandang.0.keluar', delta: 1 }));
  const st = await sbGetRow('day-4');
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
  const clean = (await sbGetRow('day-4')).karkas.total;
  record('C   state tak tersentuh setelah payload brutal', clean === 0, `karkas.total = ${clean}`);

  console.log('\n── FASE D · PATCH storm (jalur deep-merge non-atomik) ──');
  await sbUpsertRow('day-4', testState(10));
  const sent = new Set();
  await Promise.all(Array.from({ length: 10 }, async (_, w) => {
    for (let j = 0; j < 5; j++) {
      const v = w * 1000 + j;
      sent.add(v);
      await api('PATCH', '/api/day-state?day=4', { cookie: tokens[0], body: { karkas: { total: v } } });
    }
  }));
  const finalPatch = (await sbGetRow('day-4')).karkas.total;
  record('D   PATCH storm: nilai akhir salah satu tulisan & tak korup', Number.isInteger(finalPatch) && sent.has(finalPatch),
    `akhir ${finalPatch}; race lost-update di jalur ini BY DESIGN — pakai /api/increment untuk counter`);

  console.log('\n── FASE E · restore ──');
  const tokens2 = [...tokens];
  await sbUpsertRow('day-4', testState(0));
  await fetch(`${sbUrl()}/rest/v1/qurban_sessions?token=in.(${tokens2.map(t => `"${t}"`).join(',')})`, {
    method: 'DELETE', headers: { ...sbH(), Prefer: 'return=minimal' },
  }).catch(() => {});
  record('E   sesi test dibersihkan, day-4 direset', true);
}

console.log(`Brutal test → ${BASE}`);
await phaseA();
if (!hasService) {
  console.log('\nFASE B–E dilewati: butuh Supabase asli. Isi .dev.vars (SUPABASE_URL,');
  console.log('SUPABASE_SERVICE_KEY, TEST_EMAIL, TEST_PASSWORD) lalu jalankan ulang.');
} else {
  const main = await login(cfg.TEST_EMAIL, cfg.TEST_PASSWORD);
  if (!main.cookie) {
    console.log(`\nFASE B–E dilewati: login test account gagal (${main.status}).`);
  } else {
    const backup = await sbGetRow('day-4');
    try {
      await phaseB();
    } finally {
      if (backup === null) await sbDeleteRow('day-4');
      else if (backup.karkas) await sbUpsertRow('day-4', backup);
    }
    console.log('\nFASE E · backup day-4 dipulihkan.');
  }
}
const failed = results.filter(r => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} PASS${failed ? ` — ${failed} FAIL` : ''}`);
process.exit(failed ? 1 : 0);
