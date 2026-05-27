export const ADMIN_EMAIL = import.meta.env.ADMIN_EMAIL;
export const ADMIN_PASSWORD = import.meta.env.ADMIN_PASSWORD;
export const ADMIN_TOKEN = import.meta.env.ADMIN_TOKEN;
export const EDITOR_EMAIL = import.meta.env.EDITOR_EMAIL;
export const EDITOR_PASSWORD = import.meta.env.EDITOR_PASSWORD;
export const EDITOR_TOKEN = import.meta.env.EDITOR_TOKEN;
export const VIEWER_TOKEN = 'viewer';
export const COOKIE_NAME = 'qurban_auth';

export function getRole(cookieValue: string | undefined): 'admin' | 'editor' | 'viewer' | null {
  if (cookieValue === ADMIN_TOKEN) return 'admin';
  if (cookieValue === EDITOR_TOKEN) return 'editor';
  if (cookieValue === VIEWER_TOKEN) return 'viewer';
  return null;
}
