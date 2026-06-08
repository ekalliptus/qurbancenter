// Runtime environment access.
//
// On Cloudflare Workers, secrets are NOT available at runtime through the
// build-time inlined values; they live on the Workers `env` object, populated
// from `.dev.vars` (local dev via platformProxy) and `wrangler secret` (prod).
// We read them lazily at request time. Accessing `env.X` only inside functions
// (never at module top-level) keeps it within request scope.
import { env } from 'cloudflare:workers';

export function getEnv(key: keyof typeof env): string {
  const v = env[key];
  return typeof v === 'string' ? v : '';
}
