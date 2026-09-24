# Qurban Center

Dashboard operasional harian panitia qurban (kandang, sembelih, transit, karkas, ABF, cacah, packing, distribusi) untuk hingga 4 hari pemotongan, dengan layar monitor realtime untuk seluruh tim.

## Arsitektur

```
Browser (vanilla JS + Supabase JS realtime broadcast)
        │  fetch /api/*
        ▼
Astro SSR (output: 'server')  ──  dijalankan sebagai Cloudflare Worker
        │  service_role key (server-only)
        ▼
Supabase Cloud (PostgreSQL REST + Realtime broadcast)
```

- **Runtime**: Cloudflare Workers (`wrangler.jsonc`), bukan VPS — tanpa server yang dirawat.
- **State**: satu tabel `qurban_state` (JSON per key: `default`, `day-1..4`, `day2`, `settings`, dst.). Inkremental angka lewat RPC atomik `atomic_update_field` (aman lost-update).
- **Auth**: cookie sesi (`qurban_sessions`, token acak 32 byte, expired 7 hari). Password PBKDF2-SHA256 100k iterasi (`src/lib/crypto.ts`). Role: `admin` / `editor` / `viewer`; viewer masuk tanpa akun (read-only), perubahan role/nonaktif otomatis mencabut sesi aktif.
- **Realtime**: server broadcast event `state-changed` ke channel `qurban-sync`; klien re-fetch, ada fallback polling bila CDN Supabase gagal.
- **Anti-slop PR**: workflow `.github/workflows/pr-quality.yaml` menutup otomatis PR berkualitas rendah (exempt owner/member).

## Struktur

```
src/
├── lib/            db.ts (Supabase REST), users.ts (akun+sesi), crypto.ts, env.ts
├── middleware.ts   auth + security headers + CSRF origin + role guard
└── pages/
    ├── index.astro   SPA dashboard (monitor, input, pengaturan, kelola akun)
    ├── login.astro
    └── api/          login, users, state, day-state, day2-*, settings,
                      global-settings, increment (RPC atomik), reset,
                      public-state, health
supabase/           schema SQL (jalankan di SQL Editor)
scripts/            seed-users.mjs, hash-password.mjs
```

## Requirements

- [Bun](https://bun.sh) (package manager & runtime dev)
- Akun Cloudflare (Workers) + proyek Supabase

## Setup

1. **Install & env**

   ```bash
   bun install
   cp .dev.vars.example .dev.vars   # isi nilai asli
   ```

   | Var | Isi | Boleh ke browser? |
   |---|---|---|
   | `SUPABASE_URL` | URL proyek Supabase | ya (via HTML) |
   | `SUPABASE_KEY` | **anon** key | ya |
   | `SUPABASE_SERVICE_KEY` | **service_role** key | **jangan** |
   | `PUBLIC_API_KEY` | API key untuk `/api/public-state` | — |

2. **Skema database** — jalankan di Supabase Dashboard → SQL Editor (urut):
   1. `supabase/qurban_state_schema.sql`
   2. `supabase/accounts_schema.sql`
   3. `supabase/atomic_update_field.sql`

3. **Seed akun admin** (password via argumen, tidak disimpan di repo):

   ```bash
   node scripts/seed-users.mjs admin@masjid.id "PasswordKuat123" admin
   ```

## Development

```bash
bun run dev        # Astro dev + platformProxy (baca .dev.vars)
```

## Build & Deploy

```bash
bun run build      # verifikasi build lokal
bun run deploy     # build + wrangler deploy
bunx wrangler secret put SUPABASE_SERVICE_KEY   # secrets produksi
bunx wrangler secret put PUBLIC_API_KEY
```

Setelah deploy, cek `https://<worker-domain>/api/health` → `{"status":"ok"}`.

## Backup

Data aplikasi berada penuh di Supabase — cukup backup Supabase (Dashboard → Database → Backups, atau `pg_dump` berkala). Tidak ada state di Worker/VPS.

## Troubleshooting

- **Inkrementan tidak tersimpan / konflik angka** → pastikan `atomic_update_field.sql` sudah dijalankan; tanpa RPC aplikasi jatuh ke read-modify-write yang bisa kehilangan update saat ramai.
- **Login gagal untuk semua akun** → cek tabel `qurban_users.active` dan kadaluarsa `qurban_sessions`; perubahan role/nonaktif menghapus sesi by design.
- **Monitor tidak update realtime** → cek console: kalau muncul `[RT] Supabase JS not loaded`, koneksi ke jsdelivr diblok; aplikasi jatuh ke polling otomatis.
- **Reset kata sandi** → `node scripts/hash-password.mjs <password>` lalu update `qurban_users.password_hash` via SQL Editor.
