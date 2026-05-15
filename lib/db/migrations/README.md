# Database migrations

Hand-written SQL applied in order by `scripts/migrate.ts`.

## Files

| File                  | Purpose                                                                    |
| --------------------- | -------------------------------------------------------------------------- |
| `0000_setup.sql`      | Extensions (`pgcrypto`) and Postgres roles (`authenticated`, `service_role`). Idempotent — safe on Supabase where roles already exist. |
| `0001_schema.sql`     | All Phase 1 tables, enums, foreign keys, indexes. Mirrors `lib/db/schema/*.ts`. |
| `0002_rls.sql`        | `ENABLE ROW LEVEL SECURITY` + per-table policies + `GRANT`s for both roles. |
| `0003_triggers.sql`   | `updated_at` touchers + the `auth.users` → `public.users` mirror trigger.  |

The order is load-bearing: `0001` references roles from `0000`, `0002`
references tables from `0001`, `0003` references tables from `0001` and
`auth.users` (provided externally — see below).

## How `scripts/migrate.ts` works

1. Connects to `DATABASE_URL` as the default (superuser-class) role.
2. Ensures a `_migrations` table exists (created on first run).
3. Reads every `*.sql` file in this directory in lexical order.
4. For each file not yet recorded in `_migrations`, runs it in a single
   transaction and records `(filename, sha256, applied_at)`.

If a file's content changes after it has been applied, the script
**aborts** rather than re-running it. Migrations are append-only — add a
new file, never edit an applied one. (Exception: pre-merge local dev
where you can `pnpm db:reset` to drop the test DB and re-apply
everything.)

## The `auth.users → public.users` trigger

The single most subtle piece of the whole data layer. Read this before
debugging anything sign-up related.

### Why it exists

Supabase Auth (GoTrue) owns the `auth.users` table. End-user identity —
email, password hash, OAuth provider tokens, MFA factors — lives there
and is managed entirely by GoTrue. Application code is **not** allowed
to write into `auth.users` directly.

Blacknel's app schema (organizations, members, brands, …) lives in the
`public` schema and references users by uuid. Those references are
foreign keys to **`public.users`**, not `auth.users`. So we need a row
in `public.users` for every authenticated user — created the moment
GoTrue creates the `auth.users` row.

The trigger `on_auth_user_created` (defined in `0003_triggers.sql`)
does that.

### How it fires

```
GoTrue inserts into auth.users
              │
              ▼
AFTER INSERT trigger on_auth_user_created (FOR EACH ROW)
              │
              ▼
public.handle_new_auth_user()
   INSERT INTO public.users (id, email, ...)
   ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, updated_at = NOW();
```

The function runs as `SECURITY DEFINER`, meaning it executes with the
privileges of its **owner** (typically the migration runner, a
superuser-class role), not the caller. Without this, the GoTrue
internal role would lack `INSERT` privilege on `public.users` and
sign-up would crash with a permission error.

The `SET search_path = public` line is a defensive hardening — it
prevents a malicious user from rebinding `public.users` to a hostile
table in their own schema and writing through us. Standard
`SECURITY DEFINER` hygiene.

### Failure modes & how to debug

| Symptom                                                        | Likely cause                                                                                                                                                                                                                            |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-up returns `500` with `permission denied for table users` | Function not `SECURITY DEFINER`, or owner of the function is not a superuser-class role. Re-apply `0003_triggers.sql`.                                                                                                                  |
| Sign-up returns `500` with `relation "auth.users" does not exist` | Migrations applied against a database with no Supabase Auth. Tests stub this in `tests/helpers/test-db.ts`; production needs Supabase Auth enabled before migrations run.                                                            |
| `public.users` row never appears after sign-up                 | Trigger missing or disabled. Check: `SELECT tgenabled FROM pg_trigger WHERE tgname = 'on_auth_user_created';` (should be `'O'`). Look for trigger failures in Postgres logs.                                                            |
| Email in `public.users` is stale after a user updates it       | Currently the trigger only fires AFTER INSERT, not AFTER UPDATE. By design — Supabase exposes user metadata changes through different paths. If you need email sync on update, add a second trigger here.                              |
| Duplicate-key error when applying `0003_triggers.sql`          | A prior partial install left the trigger behind. `DROP TRIGGER IF EXISTS` should handle this; if not, manually drop and re-run.                                                                                                         |

### Manual smoke test (with Supabase Auth)

#### Option A — via the Supabase Dashboard (recommended after provisioning)

Run this after applying migrations against a fresh Supabase project to
confirm the trigger is wired correctly end-to-end:

1. **Supabase Dashboard → Authentication → Users → "Add user"**.
   Use an email like `smoke@blacknel.test`. Pick either "Send invitation"
   or "Create user with password" — both end up calling GoTrue's INSERT.
2. **Supabase Dashboard → SQL Editor**. Run:

   ```sql
   SELECT id, email, created_at
   FROM public.users
   WHERE email = 'smoke@blacknel.test';
   ```

   You should see exactly **one row**, with `id` matching the value shown
   in the Authentication → Users list.
3. **Cleanup**. Authentication → Users → menu → "Delete user". That
   removes the `auth.users` row. The mirror in `public.users` is **not**
   deleted automatically (no `ON DELETE CASCADE` against `auth.users` —
   see below). Run:

   ```sql
   DELETE FROM public.users WHERE email = 'smoke@blacknel.test';
   ```

If step 2 returns no rows, debug in this order:

```sql
-- 1. Trigger exists and is enabled?
SELECT tgname, tgenabled
FROM pg_trigger
WHERE tgname = 'on_auth_user_created';
-- tgenabled = 'O' means enabled (origin). 'D' = disabled.

-- 2. Function exists and is SECURITY DEFINER?
SELECT proname, prosecdef, proowner::regrole
FROM pg_proc
WHERE proname = 'handle_new_auth_user';
-- prosecdef = true; proowner should be a role with INSERT on public.users.

-- 3. Recent errors? Look in Supabase Dashboard → Database → Logs for
-- "handle_new_auth_user" or "permission denied for table users".
```

If `proowner` is not a superuser-class role, re-apply `0003_triggers.sql`
as a superuser. The function must be owned by a role that has INSERT on
`public.users`, or `SECURITY DEFINER` won't grant the necessary
privilege.

#### Option B — pure SQL (works on any Postgres with an `auth.users` table)

```sql
INSERT INTO auth.users (id, email, created_at)
  VALUES (gen_random_uuid(), 'smoke@blacknel.test', NOW());

SELECT id, email FROM public.users WHERE email = 'smoke@blacknel.test';

DELETE FROM auth.users WHERE email = 'smoke@blacknel.test';
DELETE FROM public.users WHERE email = 'smoke@blacknel.test';
```

Note: we deliberately do **not** declare a foreign key `users.id →
auth.users.id` because we treat `auth.users` as external infrastructure
owned by GoTrue. App-level cascade behavior (deleting an org, removing a
member, etc.) is handled through `public.users` and our own FKs.

## Testing migrations locally

The integration tests in `tests/integration/` boot a fresh
[`pglite`](https://github.com/electric-sql/pglite) instance, stub
`auth.users`, then apply every file in this directory. If a migration
breaks under pglite but works on Supabase, the discrepancy is the
extension set or the role catalog — log it and add a note.
