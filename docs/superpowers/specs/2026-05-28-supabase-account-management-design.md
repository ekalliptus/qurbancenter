# Desain: Manajemen Akun Dinamis via Supabase

**Tanggal:** 2026-05-28
**Status:** Disetujui untuk implementasi

## Tujuan

Memindahkan akun (admin/editor/viewer) dari environment variable ke Supabase
sehingga akun bisa **ditambah, diubah, dan dihapus tanpa deploy ulang**.
Saat ini kredensial hardcoded di env (`ADMIN_EMAIL`, `ADMIN_PASSWORD`, dst)
hanya mendukung 1 admin + 1 editor tetap.

## Keputusan Kunci (hasil brainstorming)

1. **Tujuan:** tambah/hapus/ubah akun tanpa deploy
2. **Pengelolaan:** UI admin di app + edit manual di Supabase dashboard
3. **Keamanan:** service_role key + RLS + password hashing (PBKDF2)
4. **Token:** session token per login (revocable, ada expiry)

## Konteks Keamanan (PENTING)

- Anon key Supabase **terlihat di browser** (`index.astro` merender-nya ke
  client JS untuk Supabase Realtime).
- **RLS belum aktif** di project Supabase.
- Konsekuensi: tabel apapun yang dapat diakses anon key bisa dibaca siapa saja
  yang membuka View Source. **Karena itu tabel akun WAJIB dikunci dari anon
  key dan hanya diakses server via service_role key.**

## Arsitektur

### Tabel Baru

```sql
-- Akun pengguna
create table qurban_users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  password_hash text not null,          -- format "salt_b64:hash_b64" (PBKDF2)
  role          text not null check (role in ('admin','editor','viewer')),
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- Session aktif (token login)
create table qurban_sessions (
  token       text primary key,         -- 32-byte random hex
  user_id     uuid not null references qurban_users(id) on delete cascade,
  role        text not null,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

create index on qurban_sessions (expires_at);
```

### RLS

```sql
alter table qurban_users    enable row level security;
alter table qurban_sessions enable row level security;
-- TANPA policy untuk anon/authenticated → hanya service_role (server) yang
-- bisa akses (service_role bypass RLS by design).
```

**`qurban_state` JUGA diamankan** (scope diperluas atas permintaan user):
```sql
alter table qurban_state enable row level security;
-- TANPA policy anon → anon key tidak bisa baca/tulis qurban_state langsung.
```
Aman karena: (1) client TIDAK pernah baca qurban_state langsung — semua data
lewat `/api/*` (server, service_role). (2) Realtime app pakai **public
broadcast channel** (`qurban-sync`, tanpa `private:true`) yang TERPISAH dari
RLS tabel — broadcast tetap jalan dengan anon key meski tabel terkunci.

Setelah ini, anon key yang terlihat di browser **tidak berguna** untuk
akses data (hanya tersisa untuk subscribe broadcast channel).

### Environment Variables

| Var | Lokasi | Render ke browser? |
|---|---|---|
| `SUPABASE_URL` | server + client | Ya (untuk realtime) |
| `SUPABASE_KEY` (anon) | server + client | Ya (untuk realtime) |
| `SUPABASE_SERVICE_KEY` (service_role) | **server saja** | **TIDAK PERNAH** |

`SUPABASE_SERVICE_KEY` diambil dari Supabase Dashboard → Settings → API →
`service_role` secret. Ditambahkan ke `.dev.vars` (lokal) dan
`wrangler secret put SUPABASE_SERVICE_KEY` (produksi).

Env lama `ADMIN_EMAIL/PASSWORD/TOKEN`, `EDITOR_EMAIL/PASSWORD/TOKEN` **dihapus**
setelah migrasi.

## Komponen

### 1. `src/lib/crypto.ts` (baru)
- `hashPassword(plain: string): Promise<string>` — PBKDF2 (Web Crypto,
  SHA-256, 100.000 iterasi), salt acak 16 byte. Return `"saltB64:hashB64"`.
- `verifyPassword(plain: string, stored: string): Promise<boolean>` — derive
  ulang dengan salt tersimpan, bandingkan timing-safe.
- `generateToken(): string` — 32 byte acak (crypto.getRandomValues) → hex.

Alasan PBKDF2: bcrypt/argon2 tidak tersedia di Cloudflare Workers; Web Crypto
PBKDF2 native dan didukung penuh.

### 2. `src/lib/users.ts` (baru) — akses DB via service_role
- `findUserByEmail(email)` — untuk login
- `listUsers()` — tanpa `password_hash`
- `createUser(email, plain, role)`
- `updateUser(id, {password?, role?, active?})`
- `deleteUser(id)`
- `createSession(userId, role)` → token, expires 7 hari
- `getSession(token)` → `{role}` jika valid & belum expired, else null
- `deleteSession(token)` — logout
- (opsional) `purgeExpiredSessions()` — best-effort saat login

Semua fetch ke Supabase REST pakai `SUPABASE_SERVICE_KEY`.

### 2b. `src/lib/db.ts` (diubah) — pindah ke service_role
Karena `qurban_state` kini RLS-locked, SEMUA akses data server (`supaGet`,
`supaUpsert`, `supaSelect`, `atomicIncrement`) harus pakai
`SUPABASE_SERVICE_KEY`, bukan anon key. `supaConfig()` diubah untuk membaca
service key. `supaBroadcast` tetap berfungsi (broadcast endpoint). Anon key
TIDAK lagi dipakai server — hanya client (realtime subscribe).

### 3. `src/lib/auth.ts` (diubah)
- Hapus `getAuthConfig()` dan konstanta env akun.
- Pertahankan `COOKIE_NAME`.
- `getRole()` lama (string-compare token) **dihapus** — diganti lookup session
  di middleware.

### 4. `src/middleware.ts` (diubah)
- Ganti `getRole(cookie)` menjadi `await getSession(cookie)`.
- Sisanya (CSRF check, viewer non-GET block, security headers) tetap.
- Path publik tetap: `/login`, `/api/login`, `/api/public-state`.

### 5. `src/pages/api/login.ts` (diubah)
- POST: viewer → tetap pakai token statis `'viewer'` (anonim, tanpa akun) ATAU
  dibuatkan session viewer. **Keputusan:** viewer tetap token statis `'viewer'`
  (tidak perlu akun DB; viewer = akses baca publik). Login email/password →
  `findUserByEmail` + `verifyPassword` + `createSession` → set cookie token.
- DELETE: `deleteSession(token)` lalu hapus cookie.

### 6. `src/pages/api/users.ts` (baru, admin-only)
- `GET` list, `POST` create, `PATCH` update, `DELETE` delete.
- Guard: `locals.role !== 'admin'` → 403 (middleware sudah set role).
- Tidak boleh menghapus/menonaktifkan akun admin terakhir & akun diri sendiri.

### 7. UI "Kelola Akun" di `src/pages/index.astro` (baru, admin-only)
- Nav item `users` (admin-only) setelah Pengaturan.
- Render: tabel user (email, role, status, aksi), form tambah user, aksi ubah
  password / toggle aktif / hapus.
- Fetch via `/api/users`. Escape semua output (XSS) — pakai `escapeHtml` yang
  sudah ada.

## Alur Data

**Login:**
```
browser POST /api/login {email,password}
 → server findUserByEmail (service_role)
 → verifyPassword (PBKDF2)
 → createSession → token
 → Set-Cookie qurban_auth=token (HttpOnly, Secure, SameSite=Lax, 7d)
```

**Request terautentikasi:**
```
browser request + cookie
 → middleware getSession(token) (service_role, cek expires_at)
 → valid: locals.role=role, lanjut
 → invalid/expired: redirect /login
```

**Kelola akun:**
```
admin → UI Kelola Akun → /api/users (CRUD)
 → middleware pastikan role=admin → operasi DB via service_role
```

## Migrasi (sekali jalan)

Script `scripts/seed-users.mjs` (Node, pakai service_role key dari .dev.vars):
1. Buat tabel jika belum ada (atau via SQL file manual di dashboard).
2. Seed:
   - `admin@alfatihah.com` / `Support99` / admin
   - `DB@alfatihah.com` / `QurbanJaya99` / editor
   Password di-hash via PBKDF2 sebelum insert.
3. Idempotent: skip kalau email sudah ada.

Helper `scripts/hash-password.mjs <password>` untuk generate hash kalau admin
mau tambah user manual lewat Supabase dashboard.

## Error Handling

- DB error saat login → 500 generic, jangan bocorkan detail.
- Email tidak ada / password salah → 401 pesan sama ("Email atau password
  salah") biar tidak bisa enumerasi akun.
- service_role key kosong/invalid → login gagal aman (return null user).
- Session expired → redirect login, hapus cookie basi.

## Testing (verifikasi via wrangler dev / curl)

1. Seed jalan → 2 akun ada di DB, password ter-hash (bukan plaintext).
2. Login admin baru (Support99) sukses; password salah → 401.
3. Login editor baru (QurbanJaya99) sukses; role=editor.
4. Cookie token tersimpan; request berikut lolos middleware.
5. Logout → session row terhapus → request berikut redirect /login.
6. Session expired (set expires_at lampau manual) → redirect /login.
7. `/api/users` tanpa admin → 403; dengan admin → CRUD jalan.
8. Tambah user baru via UI → bisa login.
9. Hapus user → tidak bisa login lagi.
10. **Anon key TIDAK bisa baca qurban_users/qurban_sessions** (curl dengan anon
    key → kosong/error setelah RLS aktif). Test keamanan utama.
11. **Anon key TIDAK bisa baca qurban_state** (curl anon → kosong/error).
12. **App tetap berfungsi penuh** lewat /api/* (server pakai service_role):
    load data, increment, save, login, realtime broadcast tetap jalan.
13. Tidak bisa hapus admin terakhir / diri sendiri.

## Out of Scope (sekarang)

- Rotasi anon key / service_role key (service_role key sempat ditempel di chat;
  disarankan rotate setelah verifikasi).
- Password reset via email, 2FA, lockout brute-force (bisa ditambah nanti;
  untuk 14 user internal, YAGNI dulu).
- Audit log perubahan akun.

## Risiko & Catatan

- Middleware kini query DB tiap request (sebelumnya string compare). Untuk
  skala 14 user + traffic rendah, dapat diterima. Cache opsional bila perlu.
- service_role key = akses penuh DB. Wajib hanya di server env, jangan sampai
  ter-render ke browser atau ter-commit.
- Setelah migrasi, env `ADMIN_*`/`EDITOR_*` dihapus dari `.dev.vars`,
  `.dev.vars.example`, `env.d.ts`/types, dan secrets produksi.
