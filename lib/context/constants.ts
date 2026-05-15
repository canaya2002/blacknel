/**
 * Client-safe constants for the brand/location context. Kept separate
 * from `./brand-location.ts` (which is `server-only`) so that client
 * components can read these names without pulling the server-side db
 * resolver into the browser bundle.
 */
export const CONTEXT_COOKIE_NAME = 'blacknel_context';
