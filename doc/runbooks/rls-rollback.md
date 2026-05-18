# Runbook: RLS dynamic policies rollback

Phase 11 / Commit 42c. **Owner**: Carlos.

## What this rolls back

The third-layer RLS gate installed by `0023_rls_dynamic_policies.sql`
on four critical tables:

- `posts UPDATE` (gates on `posts:publish`)
- `posts DELETE` (gates on `posts:delete`)
- `audit_events SELECT` (gates on `audit:read`)
- `custom_roles INSERT/UPDATE/DELETE` (gates on `team:manage_roles`)

When rolled back, behaviour reverts to the C42b state — tenant-only
RLS plus layers 1+2 (TS `authorize` + `assertPermissionInDb`).

## When to roll back

Hit the rollback in any of these scenarios:

- Sentry shows a spike in errors related to RLS evaluation
  (e.g. "permission denied for relation", "new row violates RLS
  policy") that correlates with the C42c flag-on event.
- Production complaints: users report "can't update X" /
  "can't see audit events" / "can't manage roles" and the issue
  cannot be reproduced in staging within 15 minutes.
- The third-layer RLS is masking a real bug elsewhere — e.g.
  `assertPermissionInDb` reports a permission held but RLS denies.
  Indicates a `app_permission_check` vs `app_user_has_permission`
  divergence that needs investigation with the flag off.
- Synthetic transactions (C44+) start failing the
  posts-publish / audit-view paths.

## Procedure

### 1. Confirm the trigger

Before flipping the flag, **commit an `incident-YYYYMMDD-HHMM.md`
post-mortem draft** to `doc/post-mortems/` describing what was
observed. This is the same audit-trail rule the global kill switch
uses (`doc/runbooks/kill-switch.md`). The draft can be minimal —
"flipping rls_dynamic off because of N production reports of
posts:publish denials starting at T" — but it goes in git BEFORE
the production state change.

### 2. Flip the flag

From a workstation with `.env.local` pointing at the affected DB:

```powershell
pnpm exec tsx --env-file=.env.local --tsconfig=tsconfig.scripts.json scripts/rls-switch.ts off
```

Or the alias:

```powershell
pnpm db:rls off
```

The script issues:

```sql
ALTER DATABASE <current_database> SET blacknel.rls_dynamic = 'off';
```

and verifies via `pg_db_role_setting` that the persisted value matches.

### 3. Force connection cycling (optional but recommended)

`ALTER DATABASE SET` applies to NEW sessions. Existing pooled
connections retain their inherited value. To force cycle on Vercel:

- Trigger a redeploy (Vercel functions restart on deploy → new
  connections → new sessions → new flag value).
- Or wait ~10 min for normal cold-start cycling.

For maximum speed:

```powershell
# (Optional) Sigkill pooled connections so they reconnect fresh.
psql "$env:DATABASE_URL" -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid != pg_backend_pid();"
```

⚠️ The `pg_terminate_backend` drops in-flight queries. Only run
during a maintenance window or when the immediate rollback urgency
exceeds the cost of dropped requests.

### 4. Verify

```powershell
pnpm db:rls status
```

Expected output: `blacknel_rls_dynamic: off`.

In the app, the RESTRICTIVE policies now short-circuit. Test
manually: a viewer should now be able to UPDATE a post (the
TS layer 1 will still reject if `authorize('posts:publish')` is
called in the action — that's correct, the third layer is just
off).

### 5. Monitor

- Sentry: confirm the error spike subsides within 15 minutes.
- Synthetic transactions (when wired in C44): confirm green
  within the next scheduled run.

## Investigation checklist (after rollback, before re-enable)

- [ ] Reproduce the issue in staging with `BLACKNEL_LIVE_TEST=true`
      + flag=on. If not reproducible, the cause was production-
      specific (data shape, traffic pattern) — escalate.
- [ ] Compare `app_permission_check` vs `app_user_has_permission`
      output for the affected user / permission. They should
      agree; if not, the bug is in the wrapper.
- [ ] Check if any `dbAs` caller for the four critical tables
      is missing the role / customRoleId argument. Should have
      been caught by C42b's optional-fallback logic, but worth
      reconfirming.
- [ ] Check if the `app_user_has_permission` STABLE caching is
      caching a stale result. STABLE is safe within a query but
      across queries it's per-call.
- [ ] Review the four restrictive policies in `0023_*.sql` for
      typos in permission strings. Permission catalog is the
      source of truth: `lib/permissions/roles.ts`.

## Re-enable criteria

After the root cause is fixed (commit landed, soak in Preview
clean for 24h+):

```powershell
pnpm db:rls on
```

Watch Sentry + synthetic-tx for 1 hour. If clean, proceed.
If the spike recurs, roll back again and escalate to a deeper
investigation — could indicate a non-deterministic interaction
with another commit or with production data shape.

## Cost of staying rolled back

Layer 3 off means the four critical tables fall back to layers
1 (TS) + 2 (DB cross-check) only. That's the C42b security
posture, which is still defense-in-depth and was the production
state for the entire pre-C42c period. Staying rolled back for
days while a fix is investigated is **acceptable** — the
security guarantees of layers 1+2 are documented in
`doc/PATTERNS.md#critical-actions-dual-ts--db-enforcement` and
were considered sufficient before C42c.

## Anti-patterns

- ❌ Flipping the flag on production without prior staging
  rehearsal of the rollback procedure.
- ❌ Skipping the `incident-open` post-mortem commit.
- ❌ DROP-ing the restrictive policies as a "rollback" — keep them
  installed, just toggle the flag. Re-installing them is a
  migration that requires redeploy and risks drift.
- ❌ Using `psql` against the production DB to flip the flag
  outside the `pnpm db:rls` script — the script's `pg_db_role_setting`
  verify step catches "appeared to succeed but didn't persist"
  edge cases that raw `psql` would miss.

## Related runbooks

- `doc/runbooks/kill-switch.md` — global maintenance switch (heavier
  hammer; cuts all traffic).
- `doc/runbooks/staging-environment.md` — operator setup for
  Supabase pooler, env-var matrix, live test invocation.
