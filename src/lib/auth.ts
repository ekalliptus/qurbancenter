import { getEnv } from './env';

export const VIEWER_TOKEN = 'viewer';
export const COOKIE_NAME = 'qurban_auth';

// Secrets are read at request time (see env.ts). Do not cache at module scope.
export function getAuthConfig() {
  return {
    adminEmail: getEnv('ADMIN_EMAIL'),
    adminPassword: getEnv('ADMIN_PASSWORD'),
    adminToken: getEnv('ADMIN_TOKEN'),
    editorEmail: getEnv('EDITOR_EMAIL'),
    editorPassword: getEnv('EDITOR_PASSWORD'),
    editorToken: getEnv('EDITOR_TOKEN'),
  };
}

export function getRole(cookieValue: string | undefined): 'admin' | 'editor' | 'viewer' | null {
  if (!cookieValue) return null;
  const { adminToken, editorToken } = getAuthConfig();
  if (adminToken && cookieValue === adminToken) return 'admin';
  if (editorToken && cookieValue === editorToken) return 'editor';
  if (cookieValue === VIEWER_TOKEN) return 'viewer';
  return null;
}
