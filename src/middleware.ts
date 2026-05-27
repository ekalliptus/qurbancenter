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

  if (role === 'viewer' && pathname.startsWith('/api/') && context.request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Viewer tidak dapat mengubah data' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  context.locals.role = role;
  return next();
});
