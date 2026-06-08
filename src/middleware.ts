import { defineMiddleware } from 'astro:middleware';
import { COOKIE_NAME, getRole } from './lib/auth';

// Security headers previously set via vercel.json. On Cloudflare, a public/_headers
// file only covers static assets, so SSR + API responses get headers here instead.
function applySecurityHeaders(res: Response, pathname: string): Response {
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (pathname.startsWith('/api/')) {
    res.headers.set('Cache-Control', 'no-store');
  }
  return res;
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  if (pathname === '/login' || pathname === '/api/login' || pathname === '/api/public-state') {
    return applySecurityHeaders(await next(), pathname);
  }

  const auth = context.cookies.get(COOKIE_NAME)?.value;
  const role = getRole(auth);

  if (!role) {
    return context.redirect('/login');
  }

  // CSRF: reject non-GET requests whose Origin doesn't match host
  if (context.request.method !== 'GET') {
    const origin = context.request.headers.get('origin');
    const host = context.url.origin;
    if (origin && origin !== host) {
      return applySecurityHeaders(new Response(JSON.stringify({ error: 'CSRF rejected' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }), pathname);
    }
  }

  if (role === 'viewer' && pathname.startsWith('/api/') && context.request.method !== 'GET') {
    return applySecurityHeaders(new Response(JSON.stringify({ error: 'Viewer tidak dapat mengubah data' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    }), pathname);
  }

  context.locals.role = role;
  return applySecurityHeaders(await next(), pathname);
});
