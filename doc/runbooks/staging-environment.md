# Runbook: Staging environment

Phase 11 / Commit 40 (initial draft) + Commit 41 (operator setup
section: pooler matrix, IPv6 trap, sentinel UUID cleanup).
**Owner**: Carlos.

## What it is

`staging.blacknel.app` — a clone of production that runs with ALL
real APIs enabled (`BLACKNEL_USE_REAL_*=true`) but seeded with
synthetic data. Used for:

- 2-week pre-cutover smoke before promoting to production (C41,
  C42, C45, C48 — the high-risk commits).
- Synthetic transactions (Inngest cron, lands in C44) that run
  end-to-end flows every 5 minutes and page on failure.
- Vendor/connector sandbox testing (Meta sandbox app, Google Ads
  test account, etc.).

## Setup (one-time, ops work)

### Vercel project

```
1. Vercel dashboard → New project → import blacknel-app repo
2. Project name: blacknel-staging
3. Production branch: staging (NOT main)
4. Domain: staging.blacknel.app
   ← Configure CNAME on the registrar to point at the new
     Vercel deployment.
5. Disable preview deployments for non-staging branches to
   avoid cost explosion.
```

### Supabase staging project

```
1. Supabase dashboard → New project → blacknel-staging
2. Region: same as production
3. Tier: Free initially. Upgrade to Pro ($25/mo) when DB > 400MB.
4. Copy connection string + service role key to Vercel staging env.
5. Run migrations against staging:
     pnpm db:migrate  (with DATABASE_URL=staging)
6. Seed synthetic data:
     pnpm db:seed   (BLACKNEL_SEED_* flags all true; demo org seed
                     skipped — staging gets a different demo org UUID)
```

### Env vars to set on Vercel staging project

```
BLACKNEL_USE_REAL_SENTRY=true
BLACKNEL_USE_REAL_POSTHOG=true
BLACKNEL_USE_REAL_AI=true                       # C43+
BLACKNEL_USE_REAL_STORAGE=true                  # C44+
BLACKNEL_USE_REAL_EMAIL=true                    # C44+
BLACKNEL_USE_REAL_CRONS=true                    # C44+
BLACKNEL_USE_REAL_CONNECTORS=true               # C45+
BLACKNEL_KILL_SWITCH=false
BLACKNEL_MASTER_ORG_ID=<staging-master-org-uuid>  # different from prod
SENTRY_DSN=<staging Sentry project DSN>
POSTHOG_KEY=<staging PostHog project key>
ANTHROPIC_API_KEY=<separate key with $50/day budget cap>
SUPABASE_URL=<staging Supabase URL>
SUPABASE_SERVICE_ROLE_KEY=<staging Supabase service role>
RESEND_API_KEY=<staging Resend API key, test domain>
R2_ACCESS_KEY=<staging R2 keys>
R2_SECRET_KEY=<staging R2 keys>
R2_BUCKET=blacknel-staging
INNGEST_EVENT_KEY=<staging Inngest>
INNGEST_SIGNING_KEY=<staging Inngest>
```

Use Vercel's "Environment Variables" panel + tag each as
`staging` only (not `preview` / `production`).

### TLS + DNS verification

```
curl -I https://staging.blacknel.app
# expect: HTTP/2 200, valid LetsEncrypt cert (Vercel managed)

dig staging.blacknel.app
# expect: CNAME to <project>.vercel.app
```

## Synthetic transactions

**Status**: not active in C40 — script exists but not wired to a
scheduler. C44 (Inngest cutover) activates it.

**Location**: `scripts/staging/synthetic-tx.ts` (created in C40
as a stub; expanded in C44).

**What it does** (when active):
- Login as a synthetic user
- Create a draft post
- Publish it
- Verify it appears in `/posts` listing
- Archive it
- Logout

Failure → page Carlos via Sentry alert tagged
`synthetic-tx.staging.failed`.

## Cost ceiling

| Service | Tier | Cost/mo |
|---|---|---|
| Vercel | included in main Vercel Pro | $0 marginal |
| Supabase | Free initially, Pro when needed | $0-25 |
| Sentry | included in main quota | $0 marginal |
| PostHog | Free tier (separate project) | $0 |
| Anthropic | $50/day cap × 30 = max $1500 | $0-1500 (cap enforced) |
| Resend | included in main Pro | $0 marginal |
| R2 | tiny staging bucket | $1 |

**Realistic staging cost**: $30-50/mo while synthetic-tx is the
only consumer. Spikes only if a real cutover smoke-test floods
Anthropic — the $50/day cap is the hard limit.

## Promoting staging → production

Promotion is **manual** for foundational cutovers (C41, C42):

```
1. Staging green for 14 consecutive days (no SEV1/SEV2 incidents).
2. Manual smoke: complete the cutover checklist
   (doc/phase-11/cutover-checklist.md).
3. Schedule production deploy in low-traffic window (Tuesday
   morning recommended).
4. Production deploy = exact same commit SHA staging ran.
5. Watch Sentry + synthetic-tx for 24 hours post-deploy.
6. If clean → mark cutover stable in CHANGELOG.
7. After 2 weeks stable → schedule feature flag retirement PR.
```

## Anti-patterns

- ❌ Pointing staging at production database. Catastrophic.
- ❌ Skipping the 14-day staging window for "small" cutovers.
  If it's small enough to skip, it doesn't need a feature flag.
- ❌ Allowing real customer credentials in staging.
- ❌ Granting non-master-org-owner Vercel project access.

---

## Connecting from operator machine (C41 addendum)

### The IPv6 trap

Supabase exposes three connection strings per project. The
"Direct connection" host (`db.<ref>.supabase.co:5432`) only has
an **AAAA (IPv6)** record. Most residential ISPs and corporate
networks in LATAM do not route IPv6 outbound, so any `psql` /
`postgres-js` / migration script against the direct host fails
with `getaddrinfo ENOTFOUND`. Supabase sells an **IPv4 add-on**
(~$4/mo) but the same outcome is reachable for free by using
the pooler hosts.

### Pooler matrix

| Connection | Host | Port | IPv4 | DDL OK | Prepared statements | Use for |
|---|---|---|---|---|---|---|
| Direct | `db.<ref>.supabase.co` | 5432 | ❌ (IPv6-only) | ✅ | ✅ | nothing (without IPv4 add-on) |
| **Session pooler** | `aws-0-<region>.pooler.supabase.com` | **5432** | ✅ | ✅ | ✅ | **migrations, seed, scripts CLI, live tests** |
| Transaction pooler | `aws-0-<region>.pooler.supabase.com` | 6543 | ✅ | ❌ (rejects some DDL + multi-statement) | ❌ | **runtime app** (serverless) |

Username format differs from the direct connection: the pooler
strings use `postgres.<project-ref>` (note the dot-prefix) rather
than `postgres`. Copy the exact string from the dashboard —
`Project Settings → Database → Connection string → Session pooler`.

The Drizzle client in `lib/db/client.ts` sets `prepare: false` on
the `postgres()` factory — Transaction pooler requires it,
Session pooler tolerates it. One config covers both.

### Env-var matrix (Vercel)

| Var | Preview | Production | Local `.env.local` |
|---|---|---|---|
| `DATABASE_URL` | Transaction pooler (6543) | Transaction pooler (6543) | Session pooler (5432) |
| `DATABASE_URL_POOLED` | Transaction pooler (6543) | Transaction pooler (6543) | Transaction pooler (6543) |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` | same | same |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon public | anon public | anon public |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role | service_role | service_role |
| `BLACKNEL_USE_MOCKS` | `false` | `false` | `false` (when targeting Supabase) |
| `BLACKNEL_COOKIE_SECRET` | env-specific ≥32 chars | env-specific ≥32 chars | env-specific |

Cookie secrets MUST differ across environments — a dev session is
not a preview session is not a prod session. That's the boundary,
not a bug.

### Local `.env.local` is not auto-loaded by tsx scripts

`scripts/migrate.ts` and `scripts/seed.ts` go straight to
`process.env` (no `dotenv` dependency). `next dev` loads
`.env.local` automatically; `tsx` does not. Use the `--env-file`
flag built into tsx ≥4.7:

```powershell
pnpm exec tsx --env-file=.env.local --tsconfig=tsconfig.scripts.json scripts/migrate.ts
pnpm exec tsx --env-file=.env.local --tsconfig=tsconfig.scripts.json scripts/seed.ts
```

If `DATABASE_URL` is missing the script prints a clear error —
the most common cause is forgetting the `--env-file` flag.

### Migrations against Supabase: gotchas captured in C41

- **`supautils` blocks `ALTER ROLE service_role`.** Supabase
  pre-provisions `service_role` with `BYPASSRLS` and protects it
  via the `supautils` extension. `0000_setup.sql` wraps the
  defensive `ALTER` in `DO $$ … EXCEPTION WHEN insufficient_privilege
  THEN NULL; END $$` so the migration succeeds against both
  Supabase (no-op) and pglite (writes the attribute).

- **Partial unique indexes require an explicit predicate in
  `ON CONFLICT`.** Real Postgres refuses to infer a partial
  unique index as an arbiter unless the conflict clause carries
  the same `WHERE`. pglite is more lenient — code that "works
  in dev" may fail on Supabase. The fix in Drizzle 0.36 is the
  `where:` option on `onConflictDoNothing` (NOT `targetWhere`,
  which only `onConflictDoUpdate` accepts):

  ```ts
  .onConflictDoNothing({
    target: [t.organizationId, t.platform, t.externalThreadId],
    where: sql`external_thread_id IS NOT NULL`,
  })
  ```

- **Migration drift after an in-place edit.** The
  `applyMigrations` runner stores `sha256(filename)` in
  `_migrations` and refuses to re-run a file whose contents
  changed. The C41 fix to `0000_setup.sql` is one such in-place
  edit — devs who pulled C41 onto an existing
  `.blacknel/pglite-data/` will see `migration drift: 0000_setup.sql
  was edited after it was applied`. Resolution: `pnpm db:reset`
  (regenerates the local pglite from scratch). Supabase
  staging is not affected — the file landed there only after
  the fix, so its stored sha already matches.

### Live tests

Three integration tests run against Supabase staging on demand
(skip by default in CI):

- `tests/integration/rls.live.test.ts` — full RLS scope coverage
- `tests/integration/login-seed.live.test.ts` — `/login` query
- `tests/integration/reviews-list.live.test.ts` — RLS read scope
- `tests/integration/posts-create.live.test.ts` — RLS write + readback

All four are gated on `BLACKNEL_LIVE_TEST=true` AND `DATABASE_URL`
set. CI never sets the flag.

Invocation:

```powershell
$env:BLACKNEL_LIVE_TEST="true"
$env:BLACKNEL_USE_MOCKS="false"
$env:DATABASE_URL="postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres"
pnpm vitest run tests/integration/*.live.test.ts
```

### Sentinel UUID cleanup

Live tests insert rows under sentinel UUID prefixes so they are
greppable and removable. If a run is interrupted between INSERT
and `afterAll`, run the cleanup query through the Supabase SQL
editor or psql:

```sql
-- C41 sentinel ranges:
--   9e9e9e9e-0001-*  → organizations  (rls.live.test.ts)
--   9e9e9e9e-0002-*  → users          (rls.live.test.ts)
--   9e9e9e9e-0003-*  → brands         (rls.live.test.ts)
--   9e9e9e9e-0007-*  → posts          (posts-create.live.test.ts)
-- Add new ranges here as live tests grow (one prefix per test family).
DELETE FROM posts                WHERE id::text         LIKE '9e9e9e9e-0007-%';
DELETE FROM brands               WHERE id::text         LIKE '9e9e9e9e-0003-%';
DELETE FROM organization_members WHERE user_id::text    LIKE '9e9e9e9e-0002-%'
                                    OR organization_id::text LIKE '9e9e9e9e-0001-%';
DELETE FROM organizations        WHERE id::text         LIKE '9e9e9e9e-0001-%';
DELETE FROM users                WHERE id::text         LIKE '9e9e9e9e-0002-%';
```

Safe to run quarterly even when no interruption is suspected —
sentinel rows are never real data.
