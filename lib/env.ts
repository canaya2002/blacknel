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
  /**
   * Whether `seedDatabase()` should seed the demo `connected_accounts`
   * + `connector_sync_runs` set. Default `true` so a fresh
   * `pnpm db:seed` / `pnpm dev` leaves /integrations populated.
   * Integration tests set this to `false` to keep their seeded
   * worlds minimal and fast — Phase-3 connector tests stand up the
   * exact rows they need explicitly.
   */
  BLACKNEL_SEED_CONNECTED: boolFromString(true),
  /**
   * Whether `seedDatabase()` should seed the demo publishing data
   * (campaigns + content_assets + posts + post_targets). Default
   * `true`. Integration tests for unrelated features can flip this
   * to `false` to skip the ~150-row insert. The composer tests
   * (Commit 19) stand up their own posts explicitly anyway.
   */
  BLACKNEL_SEED_PUBLISHING: boolFromString(true),
  /**
   * Publish-job cron (Commit 20a). When `true` AND
   * `NODE_ENV='development'`, `instrumentation.ts` arranca el
   * `setInterval` que llama `runPublishTick()` cada 60s. Vitest
   * setup lo fuerza a `false` para no contaminar tests con un
   * cron lateral. Production (Phase 12 con Inngest Cloud) lo
   * deshabilita y usa el handler de queue en su lugar.
   */
  BLACKNEL_PUBLISH_JOB_ENABLED: boolFromString(true),
  /**
   * Ads-sync cron (Commit 28). Same lifecycle as the publish/crisis
   * crons: only fires when `NODE_ENV='development'` AND this flag
   * is true. Vitest forces it off. Phase 11 swaps the in-process
   * loop for Inngest with real OAuth-backed connectors.
   */
  BLACKNEL_ADS_SYNC_ENABLED: boolFromString(true),
  /**
   * Ads-alerts producer cron (Commit 29). Same lifecycle as
   * ads-sync. Vitest setup forces off; dev defaults on. The
   * producer reads from `ads_spend_daily` populated by the
   * ads-sync tick — they must both be enabled together to see
   * alerts populate.
   */
  BLACKNEL_ADS_ALERTS_ENABLED: boolFromString(true),
  /**
   * Whether `seedDatabase()` seeds WhatsApp Business demo data
   * (Phase 9 / Commit 31). 1 wa_account per brand + 5 mixed-
   * status templates + 3 inbound mock messages. Default `true`
   * so a fresh `pnpm db:seed` shows the full Growth-tier flow
   * end-to-end without manual SQL. Integration tests flip off
   * via `tests/helpers/react-act-setup.ts`.
   */
  BLACKNEL_SEED_WHATSAPP: boolFromString(true),
  /**
   * NPS post-resolution cron (Phase 9 / Commit 32). Same lifecycle as
   * ads-sync: only fires when `NODE_ENV='development'` AND this flag
   * is true. Vitest setup forces it off so tests never trigger a
   * cross-tenant scan from a lateral cron.
   */
  BLACKNEL_NPS_JOB_ENABLED: boolFromString(true),
  /**
   * Whether `seedDatabase()` seeds NPS demo data (Phase 9 / Commit
   * 32, Ajuste J). 2 surveys per demo org + 50 invitations with
   * mixed-bucket responses (50% promoter / 25% passive / 25%
   * detractor). Default `true` so the /nps Analytics tab has real
   * numbers out of the box.
   */
  BLACKNEL_SEED_NPS: boolFromString(true),
  /**
   * Listening cron (Phase 9 / Commit 33). 60-min tick scans
   * active tracked terms and persists deterministic mock mentions
   * with AI sentiment + intent classification. Vitest forces off.
   * Phase 11 swaps the mock connector for Brand24 / Mention.com.
   */
  BLACKNEL_LISTENING_JOB_ENABLED: boolFromString(true),
  /**
   * Whether `seedDatabase()` seeds listening demo data (Phase 9
   * / Commit 33). 4 tracked terms + 80 mentions with deterministic
   * pre-classified sentiment + is_lead (R-33-1: no AI skills
   * invoked from seed). Default `true`.
   */
  BLACKNEL_SEED_LISTENING: boolFromString(true),
  /**
   * Scheduled-reports dispatcher cron (Phase 9 / Commit 34).
   * 15-min cadence selects active rows where `next_run_at <= now`,
   * builds HTML reports + pushes through the dev outbox. Phase 11
   * swap routes through Resend with the same calling convention
   * (the `html` field on `sendEmail`).
   */
  BLACKNEL_SCHEDULED_REPORTS_JOB_ENABLED: boolFromString(true),
  /**
   * Whether `seedDatabase()` seeds competitor watchlist + scheduled
   * report demo data (Phase 9 / Commit 34). 3 competitors per
   * demo org with 30 days of pre-computed metrics + 1 active
   * weekly scheduled report. Default `true`.
   */
  BLACKNEL_SEED_COMPETITORS_REPORTS: boolFromString(true),
  /**
   * Audit anomaly detection cron (Phase 10 / Commit 37). 60-min
   * cadence scans last 1h of audit_events + per-user 90d IP
   * history. Vitest forces off.
   */
  BLACKNEL_AUDIT_ANOMALY_JOB_ENABLED: boolFromString(true),
  /**
   * Audit retention purge cron (Phase 10 / Commit 37). 24h
   * cadence applies per-org `audit_retention_policies`. Bounded
   * delete (5000 rows/tick) for safety. Vitest forces off.
   */
  BLACKNEL_AUDIT_RETENTION_JOB_ENABLED: boolFromString(true),
  /**
   * Whether `seedDatabase()` seeds the Enterprise Networks demo
   * (Phase 10 / Commit 38). 5 Enterprise-tier platforms (yelp,
   * tripadvisor, trustpilot, bbb, avvo) × 7 days of deterministic
   * mock reviews. Gated so integration tests can opt out and keep
   * their seeded worlds focused on Phase-5 base reviews. Default
   * `true`.
   */
  BLACKNEL_SEED_ENTERPRISE_NETWORKS: boolFromString(true),

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
