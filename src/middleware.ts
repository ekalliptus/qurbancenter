import { defineMiddleware } from 'astro:middleware';
import { COOKIE_NAME, getRole } from './lib/auth';

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  if (pathname === '/login' || pathname === '/api/login' || pathname === '/api/public-state') {
    return next();
  }

  const auth = context.cookies.get(COOKIE_NAME)?.value;
  const role = getRole(auth);

  if (!role) {
    return context.redirect('/login');
  }

  // CSRF: reject non-GET requests without matching Origin
  if (context.request.method !== 'GET') {
    const origin = context.request.headers.get('origin');
    const host = context.url.origin;
    if (origin && origin !== host) {
      return new Response(JSON.stringify({ error: 'CSRF rejected' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  if (role === 'viewer' && pathname.startsWith('/api/') && context.request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Viewer tidak dapat mengubah data' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  context.locals.role = role;
  return next();
});
