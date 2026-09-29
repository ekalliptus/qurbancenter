# Qurban Center

Dashboard operasional harian panitia qurban (kandang, sembelih, transit, karkas, ABF, cacah, packing, distribusi) untuk hingga 4 hari pemotongan, dengan layar monitor yang selalu tersinkron untuk seluruh tim.

## Arsitektur

```
Browser (vanilla JS, version polling)
        │  fetch /api/*
        ▼
Astro SSR (output: 'server')  ──  dijalankan sebagai Cloudflare Worker
        │  Neon serverless driver (HTTP, parameterized)
        ▼
Neon Postgres (state, akun, sesi, rate limit, activity log)
```

- **Runtime**: Cloudflare Workers (`wrangler.jsonc`), tanpa server yang dirawat.
- **Database**: Neon Postgres (`neon/schema.sql`). State aplikasi = satu tabel `qurban_state` (JSON per key). Inkrementan angka lewat RPC `atomic_update_field` (row-locked, anti lost-update); PATCH lewat `jsonb_merge_deep` (atomik di database, tanpa race).
- **Auth**: cookie sesi (`qurban_sessions`, token acak 32 byte, expired 7 hari). Password PBKDF2-SHA256 100k iterasi. Role `admin`/`editor`/`viewer`; viewer read-only tanpa akun; perubahan role/nonaktif otomatis mencabut sesi aktif.
- **Rate limit login**: durable di tabel `login_attempts` (5 kegagalan / 10 menit per IP+email), selamat lintas isolate & restart.
- **Sinkronisasi**: klien polling ringan `/api/version` (timestamp max `updated_at`) tiap 4 detik — refresh penuh hanya saat data berubah. Tidak ada WebSocket/CDN realtime.
- **Export Excel**: xlsx 0.20.3 lazy-load saat tombol export diklik (bukan di load awal).
- **Anti-slop PR**: workflow `.github/workflows/pr-quality.yaml` menutup otomatis PR berkualitas rendah (exempt owner/member).

## Struktur

```
src/
├── lib/            db.ts (Neon), users.ts (akun+sesi+rate limit), crypto.ts, env.ts
├── middleware.ts   auth + security headers + CSP + CSRF origin + role guard + body drain
└── pages/
    ├── index.astro   SPA dashboard (monitor, input, pengaturan, kelola akun + aktivitas)
    ├── login.astro
    └── api/          login, users, activity, state, day-state, day2-*, settings,
                      global-settings, increment (RPC atomik), reset,
                      public-state, version, health
neon/                schema.sql (tabel + fungsi atomik/merge/rate-limit)
scripts/             neon-setup.mjs, seed-users.mjs, hash-password.mjs,
                     brutal-test.mjs, smoke-neon.mjs
```

## Requirements

- [Bun](https://bun.sh) (package manager & runtime dev)
- Akun Cloudflare (Workers) + proyek Neon (Postgres)

## Setup

1. **Install & env**

   ```bash
   bun install
   cp .dev.vars.example .dev.vars   # isi DATABASE_URL dari Neon
   ```

   | Var | Isi | Boleh ke browser? |
   |---|---|---|
   | `DATABASE_URL` | pooled connection string Neon | **jangan** |
   | `PUBLIC_API_KEY` | API key untuk `/api/public-state` | — |

   Ambil `DATABASE_URL`: `npx neon connection-string --project-id <id> --pooled` (atau Neon Console → Connection Details).

2. **Skema database**

   ```bash
   bun scripts/neon-setup.mjs   # idempotent, jalankan ulang setelah edit neon/schema.sql
   ```

3. **Seed akun admin** (password via argumen, tidak disimpan di repo):

   ```bash
   node scripts/seed-users.mjs admin@masjid.id "PasswordKuat123" admin
   ```

## Development

```bash
bun run dev        # Astro dev + platformProxy (baca .dev.vars)
bun test           # unit test crypto
bun run test:brutal  # brutal harness (server harus jalan di :8788, butuh TEST_EMAIL/TEST_PASSWORD)
```

## Build & Deploy

```bash
bun run build      # verifikasi build lokal
bun run deploy     # build + wrangler deploy
bunx wrangler secret put DATABASE_URL
bunx wrangler secret put PUBLIC_API_KEY
```

Setelah deploy, cek `https://<worker-domain>/api/health` → `{"status":"ok"}`.

## Backup

Data ada penuh di Neon. Neon free tier menyimpan history PITR beberapa jam; untuk backup eksplisit gunakan `pg_dump "$DATABASE_URL" > backup.sql` berkala, atau snapshot branch Neon.

## Troubleshooting

- **Inkrementan tidak tersimpan / konflik angka** → pastikan `atomic_update_field` ada (`bun scripts/neon-setup.mjs` idempotent).
- **Login gagal untuk semua akun** → cek `qurban_users.active`; perubahan role/nonaktif menghapus sesi by design; 5 kegagalan login memicu lock 10 menit per IP+email (`login_attempts`).
- **Reset kata sandi** → `node scripts/hash-password.mjs <password>` lalu `UPDATE qurban_users SET password_hash = '...' WHERE email = '...'`.
- **Monitor tidak update** → polling `/api/version` tiap 4 detik; cek tab Network bila data lain berubah tapi monitor diam.
