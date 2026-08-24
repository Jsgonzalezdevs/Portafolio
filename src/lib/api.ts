/**
 * Base URL for the Express API.
 *
 * Empty by default, which yields same-origin relative paths — what local
 * development needs (Vite proxies /api to :3000) and what a single-host deploy
 * needs (Express serves both `dist` and /api).
 *
 * It only has to be set when the front end and the API live on DIFFERENT hosts,
 * which is exactly the current production setup: the site is on Vercel and the
 * API on Render, so a relative /api hits Vercel — where nothing serves it — and
 * returns 404. Setting VITE_API_URL to the Render origin points the calls at the
 * right host; `cors()` is already enabled server-side for that case.
 */
const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '') ?? '';

/** `apiUrl('/api/x')` -> '/api/x' locally, 'https://host/api/x' when configured. */
export const apiUrl = (ruta: string): string => `${BASE}${ruta}`;
