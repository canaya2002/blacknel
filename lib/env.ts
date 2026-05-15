import { z } from 'zod';

/**
 * Strongly-typed, validated environment access for Blacknel.
 *
 * Every server-side variable is declared here. Importing modules read `env.X`
 * and never `process.env.X` directly — that way Zod catches missing/invalid
 * values at boot and we have a single index of all configuration.
 *
 * Variables are intentionally *optional* during Phase 1 / Commit 2 because
 * Supabase is not provisioned yet. The db client raises a clear error if
 * called without DATABASE_URL set; nothing else fails on import.
 */

const TRUTHY = new Set(['true', '1', 'yes', 'on']);
const FALSY = new Set(['false', '0', 'no', 'off', '']);

const boolFromString = (defaultValue: boolean) =>
  z.preprocess((raw) => {
    if (typeof raw === 'boolean') return raw;
    if (typeof raw !== 'string') return defaultValue;
    const s = raw.trim().toLowerCase();
    if (TRUTHY.has(s)) return true;
    if (FALSY.has(s)) return false;
    return defaultValue;
  }, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),

  // --- Database (Supabase Postgres, used by Drizzle) ---
  DATABASE_URL: z.string().url().optional(),
  DATABASE_URL_POOLED: z.string().url().optional(),

  // --- Supabase Auth (wired in Commit 3) ---
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  // --- Auth ---
  // Secret used to sign the session cookie (JWT HS256). In Phase 1-10
  // the cookie carries `{userId, orgId, role}` and the app trusts it
  // directly. In Phase 11 the cutover switches to Supabase Auth tokens
  // and this variable becomes unused. Must be ≥32 chars in production;
  // dev/test fall back to a stable placeholder via `lib/auth/cookie.ts`.
  BLACKNEL_COOKIE_SECRET: z.string().min(32).optional(),

  // --- Feature flags ---
  BLACKNEL_USE_MOCKS: boolFromString(true),
  BLACKNEL_MOCK_ERRORS: boolFromString(false),
  /**
   * When `true`, the /integrations page ticks a synthetic event loop
   * on visit: some active accounts roll forward to `expired` / `error`
   * and successful syncs accumulate. Phase 11 swaps this for Inngest
   * crons against real platforms.
   */
  BLACKNEL_MOCK_EVENTS: boolFromString(false),

  // --- Logging ---
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).optional(),
  LOG_FORMAT: z.enum(['pretty', 'json']).optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('[env] Invalid environment configuration:');
  console.error(JSON.stringify(parsed.error.flatten(), null, 2));
  throw new Error('Invalid environment configuration. See errors above.');
}

export const env = parsed.data;
export type Env = z.infer<typeof envSchema>;
