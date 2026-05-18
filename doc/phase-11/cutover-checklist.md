# Cutover checklist (per-commit)

Phase 11 / Commit 40. Use this for **every** Phase 11 commit that
flips a `BLACKNEL_USE_REAL_X` flag in production.

Copy this checklist into the commit description and tick boxes as
you go.

## Pre-commit (development)

- [ ] Feature flag default set: `false` in dev / `false` in preview / `true` in staging / `false` in production
- [ ] Mock adapter NOT deleted (lives 1+ release cycle after cutover graduates)
- [ ] Rollback path documented in commit message body
- [ ] Tests cover both flag states (mock + real adapter paths)
- [ ] `pnpm verify` green locally
- [ ] `pnpm build --webpack` green locally

## Pre-deploy (staging)

- [ ] Deploy to staging
- [ ] `vercel env list staging` confirms the flag is `true`
- [ ] Manual smoke: the feature works end-to-end against the real API
- [ ] Sentry shows zero new error types vs. baseline
- [ ] PostHog confirms the event firing (where applicable)
- [ ] Cost dashboard (when wired, C43+) confirms spend is in expected range
- [ ] Synthetic-tx (when wired, C44+) passes for 30 minutes
- [ ] If foundational (C41 / C42) — staging runs 14 days clean
- [ ] If high-risk (C45 / C48) — shadow mode active for 7 days

## Pre-deploy (production)

- [ ] Production deploy window scheduled (avoid Friday / weekend)
- [ ] Slack #blacknel-ops notified with cutover details
- [ ] Kill switch procedure rehearsed in last 7 days
- [ ] Database snapshot taken (Supabase manual backup, tag `pre-Cxx`)
- [ ] On-call confirmed available for 24h post-deploy

## Deploy

- [ ] `vercel env add BLACKNEL_USE_REAL_X true production`
- [ ] `vercel redeploy production --yes`
- [ ] Watch `vercel logs <deployment>` for boot errors
- [ ] `curl https://blacknel.app/api/health` returns 200

## Post-deploy verification

- [ ] Synthetic-tx green for 30 minutes
- [ ] Manual smoke of the cutover feature in production
- [ ] Sentry alerts none for 1 hour
- [ ] Cost dashboard within projection for 24 hours
- [ ] CHANGELOG.md updated with cutover status: "deployed YYYY-MM-DD"

## Cutover graduation (≥2 weeks post-deploy)

- [ ] Stable for 14 consecutive days (no SEV1/SEV2 incidents)
- [ ] Open PR to:
  - Remove the `BLACKNEL_USE_REAL_X` env var
  - Delete the mock adapter
  - Update `doc/PATTERNS.md` to reflect the real adapter is the only adapter
- [ ] PR merged
- [ ] `vercel env rm BLACKNEL_USE_REAL_X production` (clean up the now-unused env)

## Incident-during-cutover

If something breaks:

1. Activate kill switch (`read-only` first; `true` if needed).
   See `doc/runbooks/kill-switch.md`.
2. File incident-open commit BEFORE any further production state
   change.
3. Reverse the flag: `vercel env rm BLACKNEL_USE_REAL_X production`
   + `vercel redeploy production --yes` → fallback to mock.
4. Investigate via staging reproduction.
5. Fix → re-attempt cutover from "Pre-deploy (staging)" step.
