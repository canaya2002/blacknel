# Runbook: RLS dynamic policies rollback

Phase 11 / Commit 42c (+ C42c-hotfix in migration 0024). **Owner**: Carlos.

## Mechanism (post-hotfix)

The dynamic-RLS gate is controlled by a single row in `public.app_settings`:

```sql
SELECT value FROM app_settings WHERE key = 'rls_dynamic';   -- 'on' | 'off'
```

`service_role` can UPDATE it; `authenticated` can only SELECT. The 6
RESTRICTIVE policies installed by migration 0023 call
`app_rls_dynamic_enabled()` which reads this row. STABLE caches the
result per query plan only — every NEW query plan sees the latest
committed value, so flipping the flag takes effect within ~1s without
redeploy or connection cycling.

> **Why a table, not a GUC**: the original C42c plan used
> `blacknel.rls_dynamic` as a custom Postgres GUC flipped via
> `ALTER DATABASE … SET …`. Supabase managed projects restrict that
> statement to true superusers via `supautils`; the `postgres` role on
> hosted Supabase is NOT a true superuser. The table-based replacement
> works on any Postgres deploy with no privilege escalation.

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
<<<<<<< HEAD
UPDATE runtime_config SET value = 'off', updated_at = now()
WHERE key = 'rls_dynamic';
```

and verifies the row returned by `RETURNING value` matches.

> **Note (2026-05-19):** the original C42c design flipped a custom
> Postgres GUC via `ALTER DATABASE … SET blacknel.rls_dynamic`. Supabase
> managed rejects that on the `postgres` role (it lacks `rolsuper`, and
> custom GUCs are not pre-registered) with `42501 permission denied to
> set parameter`. Migration `0024_runtime_config.sql` replaced the GUC
> with a one-row `runtime_config` table that any `postgres` connection
> can `UPDATE`. The helper `app_rls_dynamic_enabled()` was extended to
> read both sources — session-local GUC first (preserves
> `SET LOCAL blacknel.rls_dynamic = 'on'` in CI tests), then the table.

### 3. New sessions pick up the value immediately

Unlike the previous `ALTER DATABASE` mechanism (which only affected
new connections), an UPDATE on `runtime_config` is visible to every
new transaction immediately. Existing in-flight transactions still
see the snapshot from when they started — Postgres MVCC — so a
long-running tx may briefly straddle the change. Typical Vercel
function transactions are <100ms; effective propagation is bounded
by request duration.

There is no need to force-cycle the pool. If you want to drop
in-flight queries anyway (maintenance window, urgent rollback):

```powershell
psql "$env:DATABASE_URL" -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid != pg_backend_pid();"
```

⚠️ The `pg_terminate_backend` drops in-flight queries. Only run
during a maintenance window or when the immediate rollback urgency
exceeds the cost of dropped requests.
=======
SET ROLE service_role;
UPDATE public.app_settings
   SET value = 'off', updated_at = now()
 WHERE key = 'rls_dynamic'
RETURNING value, updated_at;
```

and verifies the returned `value` matches the requested action.

### 3. Propagation (no connection cycling needed)

UPDATE commits immediately. Every NEW query plan that calls
`app_rls_dynamic_enabled()` sees the new value (the STABLE function
caches only within a single query plan, not across queries or
connections). Live web traffic picks up the new value within ~1s of
the UPDATE committing.

Long-running queries already executing on the OLD value finish on the
old value — acceptable for our sub-second query profile. If a future
report job runs minutes-long under load, schedule the rollback during
a quiet window.
>>>>>>> 87f3d84a2a3d8946fce2c3e831d335402437c8bf

### 4. Verify

```powershell
pnpm db:rls status
```

<<<<<<< HEAD
Expected output: `rls_dynamic: "off"` (plus the `updated_at` timestamp
from the UPDATE).
=======
Expected output: `rls_dynamic: off, updated_at: <ISO timestamp>`.
>>>>>>> 87f3d84a2a3d8946fce2c3e831d335402437c8bf

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
<<<<<<< HEAD
  outside the `pnpm db:rls` script — the script's `RETURNING` verify
  step catches "appeared to succeed but didn't persist" edge cases
  that raw `psql` would miss. Direct `UPDATE runtime_config` is
  recoverable but bypasses the operator log entry.
=======
  outside the `pnpm db:rls` script — the script's RETURNING-based
  verify step catches "appeared to succeed but didn't persist"
  edge cases that raw `psql` would miss.
>>>>>>> 87f3d84a2a3d8946fce2c3e831d335402437c8bf

## Related runbooks

- `doc/runbooks/kill-switch.md` — global maintenance switch (heavier
  hammer; cuts all traffic).
- `doc/runbooks/staging-environment.md` — operator setup for
  Supabase pooler, env-var matrix, live test invocation.
