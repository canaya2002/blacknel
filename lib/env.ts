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

/**
 * Wrap a validator so an empty / whitespace-only string is treated as
 * "unset" (undefined) instead of failing `.url()` / `.min()`. Lets
 * `.env.example` be copied verbatim, and lets vitest `test.env`
 * (`DATABASE_URL=''`) neutralise a prod-pointed `.env.local` without
 * tripping validation.
 */
const optionalEnv = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    schema.optional(),
  );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),

  // --- Database (Supabase Postgres, used by Drizzle) ---
  // For Vercel serverless, point this at the Supabase Transaction pooler
  // (port 6543); the client sets prepare:false which the tx pooler requires.
  DATABASE_URL: optionalEnv(z.string().url()),

  // --- Supabase Auth (wired in Commit 3) ---
  NEXT_PUBLIC_SUPABASE_URL: optionalEnv(z.string().url()),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalEnv(z.string().min(1)),
  SUPABASE_SERVICE_ROLE_KEY: optionalEnv(z.string().min(1)),

  // --- Auth ---
  // Secret used to sign the session cookie (JWT HS256). In Phase 1-10
  // the cookie carries `{userId, orgId, role}` and the app trusts it
  // directly. In Phase 11 the cutover switches to Supabase Auth tokens
  // and this variable becomes unused. Must be ≥32 chars in production;
  // dev/test fall back to a stable placeholder via `lib/auth/cookie.ts`.
  BLACKNEL_COOKIE_SECRET: optionalEnv(z.string().min(32)),

  // --- Meta (Facebook / Instagram / Threads) App Review --------------------
  /**
   * Meta App secret. Used to validate the `signed_request` payload posted
   * by Meta to `/api/meta/data-deletion` (App Review requirement) via
   * HMAC-SHA256. Optional in dev — the route returns 503 when missing in
   * production so misconfigured deploys are loud rather than silently
   * accepting unsigned requests.
   *
   * This is DISTINCT from `META_APP_ID` (which is public) — the secret
   * never leaves the server.
   */
  META_APP_SECRET: optionalEnv(z.string().min(1)),

  /**
   * Verify-token Meta echoes back when subscribing the webhook URL
   * (`/api/webhooks/meta`). Carlos sets this in both Vercel (this
   * env var) AND in the Meta App Dashboard's webhook config — they
   * must match exactly. 32-char random hex is the recommended shape;
   * see runbook for rotation procedure. Optional in dev — GET
   * verification returns 503 in prod when unset.
   *
   * NOT used by POST event ingestion (those are HMAC-signed with
   * META_APP_SECRET, not this token).
   */
  META_WEBHOOK_VERIFY_TOKEN: optionalEnv(z.string().min(1)),

  // --- Meta connector (OAuth + Graph API) — Phase 11 / C46 -----------------
  // Real Meta (Facebook Pages + Instagram Business) connect/publish/ingest
  // serves only when these are set AND use_real_meta='on'; otherwise the mock
  // connector is used (fail-safe). META_APP_SECRET (above) is reused.
  /** Public Meta App ID (client_id in the OAuth dialog + Graph calls). */
  META_APP_ID: optionalEnv(z.string().min(1)),
  /** OAuth redirect URI registered in the Meta App (= our callback route). */
  META_REDIRECT_URI: optionalEnv(z.string().url()),
  /** Graph API version, e.g. v21.0. Pinned so a Meta version bump is a config change. */
  META_GRAPH_VERSION: z.string().default('v21.0'),
  /**
   * AES-256-GCM key for encrypting connector OAuth tokens at rest
   * (connected_accounts.oauth_tokens_encrypted). A 32-byte key is derived via
   * scrypt, so any input works — but use a high-entropy value ≥32 chars in prod
   * (`openssl rand -base64 48`). min(1) (not min(32)) matches the C43 placeholder
   * pattern so `__LO_PONE_CARLOS__` validates at build. Server-only secret —
   * tokens are NEVER stored plaintext nor sent to the client. Required (a real
   * value) before `pnpm db:flag use_real_meta on`.
   */
  CONNECTION_ENCRYPTION_KEY: optionalEnv(z.string().min(1)),

  // --- Social connectors batch 2 (OAuth) — Phase 11 / C47 ------------------
  // Each platform's real path serves only when its creds are set AND
  // use_real_<platform>='on'; else mock (fail-safe). Redirect URI is derived
  // from NEXT_PUBLIC_APP_URL (/api/connectors/<platform>/callback) — register
  // that exact URL in each platform's app. Secrets stay server-side.
  LINKEDIN_CLIENT_ID: optionalEnv(z.string().min(1)),
  LINKEDIN_CLIENT_SECRET: optionalEnv(z.string().min(1)),
  TIKTOK_CLIENT_KEY: optionalEnv(z.string().min(1)),
  TIKTOK_CLIENT_SECRET: optionalEnv(z.string().min(1)),
  X_CLIENT_ID: optionalEnv(z.string().min(1)),
  X_CLIENT_SECRET: optionalEnv(z.string().min(1)),
  YOUTUBE_CLIENT_ID: optionalEnv(z.string().min(1)),
  YOUTUBE_CLIENT_SECRET: optionalEnv(z.string().min(1)),
  // Google Business Profile (C49) — separate Google OAuth client so the consent
  // dialog only requests business.manage (not YouTube's upload scope).
  GBP_CLIENT_ID: optionalEnv(z.string().min(1)),
  GBP_CLIENT_SECRET: optionalEnv(z.string().min(1)),

  // --- AI (Anthropic) — Phase 11 / C43a ---
  /**
   * Anthropic API key. Required when the real-AI gate is open; the adapter
   * falls back to the mock when missing (so a misconfigured deploy degrades
   * to deterministic mocks rather than 500ing). Server-only secret.
   */
  ANTHROPIC_API_KEY: optionalEnv(z.string().min(1)),
  /**
   * OpenAI API key (C43c fallback). Required for the OpenAI fallback to fire;
   * when missing, a primary (Anthropic) transient failure simply propagates
   * (the router can't fall back). Server-only secret.
   */
  OPENAI_API_KEY: optionalEnv(z.string().min(1)),

  // --- Storage (Cloudflare R2, S3-compatible) — Phase 11 / C44 -------------
  // Real storage serves only when these are set AND use_real_storage='on';
  // otherwise the in-memory mock adapter is used. Secrets never reach the client.
  R2_ACCOUNT_ID: optionalEnv(z.string().min(1)),
  R2_ACCESS_KEY_ID: optionalEnv(z.string().min(1)),
  R2_SECRET_ACCESS_KEY: optionalEnv(z.string().min(1)),
  R2_BUCKET: optionalEnv(z.string().min(1)),
  /** Public CDN base for read URLs, e.g. https://media.blacknel.com. */
  R2_PUBLIC_BASE_URL: optionalEnv(z.string().url()),

  // --- Email (Resend) — Phase 11 / C44 -------------------------------------
  RESEND_API_KEY: optionalEnv(z.string().min(1)),

  // --- Jobs + crons (Inngest) — Phase 11 / C44 -----------------------------
  /** Used to EMIT events to Inngest. */
  INNGEST_EVENT_KEY: optionalEnv(z.string().min(1)),
  /** Verifies Inngest's signed calls to the /api/inngest serve endpoint. */
  INNGEST_SIGNING_KEY: optionalEnv(z.string().min(1)),

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
   * `rls_dynamic` row in the `app_settings` table (C42c-hotfix 0024
   * replaced the original `blacknel.rls_dynamic` GUC, which Supabase
   * managed rejects), flipped via `pnpm db:rls on/off`. This env var
   * lets app code know whether
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
   * Phase 11 / C43a — real-AI cutover flag (the ENV half of the gate). The
   * real Anthropic adapter is used ONLY when ALL hold: this is true AND
   * `app_settings.use_real_ai = 'on'` AND `ANTHROPIC_API_KEY` is set —
   * otherwise the deterministic mock adapter serves. Default false so the
   * cutover merges dark. Operator rollback to mock: `pnpm db:ai off`.
   */
  BLACKNEL_USE_REAL_AI: boolFromString(false),
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
