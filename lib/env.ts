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
  /**
   * Whether `seedDatabase()` seeds the Custom Report Builder demo
   * (Phase 10 / Commit 39). 2 published custom reports (Marketing
   * Overview, Operations Dashboard) using the bundled templates.
   * Gated so integration tests can opt out and keep their seeded
   * worlds focused. Default `true`.
   */
  BLACKNEL_SEED_CUSTOM_REPORTS: boolFromString(true),
  /**
   * Phase 11 / Commit 40 — Sentry observability flag. Production
   * captures unhandled errors and forwards via `lib/observability/sentry.ts`.
   * Dev/preview default off — Sentry DSN missing → wrapper no-ops.
   */
  BLACKNEL_USE_REAL_SENTRY: boolFromString(false),
  /**
   * Phase 11 / Commit 40 — PostHog analytics flag. When on,
   * `lib/observability/posthog.ts` captures named events
   * (custom_report.created, nps_response.submitted, …). Identifies
   * by (orgId, userId, planCode) only — no PII.
   */
  BLACKNEL_USE_REAL_POSTHOG: boolFromString(false),
  /**
   * Phase 11 / Commit 42a — Supabase Auth cutover flag.
   *
   *   `false` (default) → JOSE-signed session cookie (`lib/auth/cookie.ts`)
   *                        + dev impersonation `/login`. Phase 1-10 behavior.
   *   `true`            → Supabase Auth magic links via `@supabase/ssr`;
   *                        `getSession()` reads custom claims (org_id, role,
   *                        custom_role_id) injected by the
   *                        `add_org_claims` Custom Access Token Hook.
   *
   * The public auth API (`requireUser`, `requireOrg`, `requirePermission`)
   * is intentionally identical across both paths so the ~95 call sites
   * don't change. Switch lives in `lib/auth/server.ts`.
   *
   * Production rollout: false in Preview at code-deploy time → flip
   * true in Preview for 3-5 day soak → flip true in Production during
   * low-traffic window. JOSE path stays as fallback until C50 closure
   * pass removes it.
   */
  BLACKNEL_USE_REAL_AUTH: boolFromString(false),
  /**
   * Phase 11 / Commit 42c — Dynamic RLS policies awareness flag.
   *
   * **Pure visibility flag — does NOT control behavior.** The actual
   * RLS dynamic-policies switch lives at the Postgres layer as the
   * `blacknel.rls_dynamic` database setting, flipped via
   * `pnpm db:rls on/off`. This env var lets app code know whether
   * the operator intended the dynamic gate to be active (useful for
   * surfacing degraded-mode banners, debug logs, or matching the
   * cookie-secret rotation policy if/when needed).
   *
   * Default false. Flip in Vercel env to mirror the SQL-side state
   * after running `pnpm db:rls on` against the matching environment.
   * Mismatch is non-fatal — RLS uses the SQL setting as truth, this
   * flag is informational only.
   */
  BLACKNEL_USE_REAL_RLS_DYNAMIC: boolFromString(false),
  /**
   * Phase 11 / Commit 40 — Sentry DSN. Public-safe value but rate-
   * limit-attackable; Sentry Spike Protection mitigates.
   */
  SENTRY_DSN: z.string().optional(),
  /**
   * Phase 11 / Commit 40 — PostHog project API key. Public-safe.
   */
  POSTHOG_KEY: z.string().optional(),
  /**
   * Phase 11 / Commit 40 — PostHog API host. Defaults to PostHog
   * Cloud US; EU customers override.
   */
  POSTHOG_HOST: z.string().url().default('https://us.posthog.com'),
  /**
   * Phase 11 / Commit 40 — global kill switch.
   *
   *   `false` (default)  → app serves normally.
   *   `read-only`        → GETs serve, POSTs/PUTs/DELETEs return 503.
   *   `true`             → all routes return 503 + Retry-After.
   *
   * Activation procedure documented in `doc/runbooks/kill-switch.md`.
   * Solo-operator rule (Carlos pre-team): create an
   * `incident-YYYYMMDD-HHMM.md` post-mortem draft and commit
   * BEFORE flipping the env var (audit trail in git).
   *
   * `/api/health`, `/maintenance` and static assets bypass the
   * switch so monitoring + status pages stay reachable.
   */
  BLACKNEL_KILL_SWITCH: z
    .enum(['false', 'read-only', 'true'])
    .default('false'),
  /**
   * Phase 11 / Commit 40 — production demo org seed flag.
   *
   * Only honored in production when explicitly set. The seed is
   * idempotent (ON CONFLICT DO NOTHING) but UUIDs match the dev
   * `SEED_IDS.org.demo` so Sales screenshares are identical
   * across environments. Procedure: set true, deploy, verify,
   * UNSET (so subsequent deploys don't re-trigger).
   */
  BLACKNEL_SEED_DEMO_ORG: boolFromString(false),
  /**
   * Phase 11 / Commit 40 — Blacknel-internal master org UUID.
   *
   * Gates `/admin/*` routes. Owner of this org sees the cost
   * dashboard, kill switch admin, post-mortem index. Dev default
   * is the standard demo org for convenience; production sets a
   * dedicated UUID.
   */
  BLACKNEL_MASTER_ORG_ID: z
    .string()
    .uuid()
    .default('11111111-1111-4111-8111-111111111111'),

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
