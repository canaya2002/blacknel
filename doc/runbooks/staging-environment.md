# Runbook: Staging environment

Phase 11 / Commit 40. **Owner**: Carlos.

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
