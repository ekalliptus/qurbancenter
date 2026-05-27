/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly ADMIN_EMAIL: string;
  readonly ADMIN_PASSWORD: string;
  readonly ADMIN_TOKEN: string;
  readonly EDITOR_EMAIL: string;
  readonly EDITOR_PASSWORD: string;
  readonly EDITOR_TOKEN: string;
  readonly SUPABASE_URL: string;
  readonly SUPABASE_KEY: string;
  readonly PUBLIC_API_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare namespace App {
  interface Locals {
    role: 'admin' | 'editor' | 'viewer';
  }
}
