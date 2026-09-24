import { defineMiddleware } from 'astro:middleware';
import { COOKIE_NAME, VIEWER_TOKEN } from './lib/auth';
import { getSession } from './lib/users';

// CSP allowlist: inline scripts are load-bearing (Astro define:vars + inline
// handlers), pinned CDNs for supabase-js/xlsx, Google Fonts, and Supabase
// REST/realtime for client sync. Everything else falls back to default-src 'self'.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdn.sheetjs.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

function applySecurityHeaders(res: Response, pathname: string): Response {
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('Content-Security-Policy', CSP);
  if (pathname.startsWith('/api/')) res.headers.set('Cache-Control', 'no-store');
  return res;
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  if (pathname === '/login' || pathname === '/api/login' || pathname === '/api/public-state' || pathname === '/api/health') {
    return applySecurityHeaders(await next(), pathname);
  }

  const token = context.cookies.get(COOKIE_NAME)?.value;
  let role: 'admin' | 'editor' | 'viewer' | null = null;
  if (token === VIEWER_TOKEN) role = 'viewer';
  else if (token) {
    const session = await getSession(token);
    role = session ? session.role : null;
  }

  if (!role) return applySecurityHeaders(context.redirect('/login'), pathname);

  if (context.request.method !== 'GET') {
    const origin = context.request.headers.get('origin');
    const host = context.url.origin;
    if (origin && origin !== host) {
      return applySecurityHeaders(new Response(JSON.stringify({ error: 'CSRF rejected' }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      }), pathname);
    }
  }

  if (role === 'viewer' && pathname.startsWith('/api/') && context.request.method !== 'GET') {
    return applySecurityHeaders(new Response(JSON.stringify({ error: 'Viewer tidak dapat mengubah data' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    }), pathname);
  }

  context.locals.role = role;
  return applySecurityHeaders(await next(), pathname);
});
