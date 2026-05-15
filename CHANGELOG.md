# Changelog

All notable changes to Blacknel are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — Phase 1 / Commit 2

- `.nvmrc` and `.node-version` pinning Node 22; README section
  documenting nvm / fnm / Volta / asdf / mise commands.
- `lib/env.ts` — Zod-validated env access. All keys optional during
  Phase 1 (Supabase not yet provisioned); db client errors clearly if
  `DATABASE_URL` is used while unset.
- `lib/log.ts` — pino structured logger (silent in test, pretty in dev,
  JSON in prod).
- `lib/errors.ts` — typed `AppError` / `AppErrorCode` with HTTP status
  mapping and `isAppError` guard.
- `lib/types/result.ts` — discriminated `Result<T, E>` + `ok()` / `err()`
  helpers for Server Actions.
- Drizzle schema for the 11 Phase 1 tables under `lib/db/schema/`:
  organizations, users, organization_members, invitations, brands,
  brand_voices, locations, plans, subscriptions, usage_counters,
  audit_events (plus shared enums).
- Hand-written SQL migrations under `lib/db/migrations/`:
  - `0000_setup.sql` — extensions + `authenticated` / `service_role` roles.
  - `0001_schema.sql` — tables, enums, FKs, indexes, partial unique on
    active subscriptions.
  - `0002_rls.sql` — RLS on every tenant-scoped table; policies read
    `app.current_org_id` and `app.current_user_id` from session config.
  - `0003_triggers.sql` — generic `touch_updated_at` + the
    `auth.users → public.users` mirror trigger.
  - `README.md` documenting the auth trigger, failure modes, and how to
    debug.
- `lib/db/client.ts` — `dbAs({orgId,userId}, fn)` and `dbAdmin(fn)`
  matching the project spec, plus testable `runAs(db, ...)` /
  `runAdmin(db, fn)` variants and lazy production singleton.
- `scripts/migrate.ts` — idempotent SQL migration runner (sha256-tracked
  in a `_migrations` table; refuses to re-run edited migrations).
- `scripts/seed.ts` — conservative tenancy seed via `dbAdmin`: 3 plans,
  1 org (Blacknel Demo), 2 brands (La Trattoria, Clínica Solis),
  5 locations, 6 users covering every role, 1 active Growth subscription.
- `scripts/reset-db.ts` — drops every app table; refuses to run with
  `NODE_ENV=production`.
- `tests/helpers/test-db.ts` — pglite fixture that stubs `auth.users`,
  applies all migrations, returns a Drizzle handle.
- `tests/integration/rls.test.ts` — the load-bearing tenant-isolation
  test suite. Verifies that `dbAs(orgA, userA)` cannot see org B's
  brands or organizations, and that `dbAdmin` correctly bypasses.
- New deps: `drizzle-orm`, `drizzle-kit`, `postgres`, `zod`, `pino`,
  `pino-pretty`, `@electric-sql/pglite`, `tsx`.
- Scripts: `db:migrate`, `db:seed`, `db:reset`.

### Added — Phase 1 / Commit 1

- Project scaffold for Blacknel.
- Tooling stack:
  - Next.js 16 + React 19 + TypeScript strict (`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`).
  - Tailwind CSS v4 with `@tailwindcss/postcss`. Design tokens are CSS-first
    and will land with the app shell in Commit 4.
  - ESLint 9 flat config extending `next/core-web-vitals` + `next/typescript`.
  - Prettier 3 with `prettier-plugin-tailwindcss`.
  - Vitest 2 + jsdom + `@vitejs/plugin-react`.
- Scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:watch`,
  `format`, `format:check`, `verify`.
- Pinned tooling: `engines.node: "22.x"`, `packageManager: "pnpm@9.15.0"`.
- `.npmrc` with `engine-strict=false` so local dev on Node 24 is unblocked
  while CI/Vercel target Node 22.
- `.gitignore`, `.editorconfig`, `.prettierignore` baseline.
- `.env.example` with placeholders for app URL, Supabase, database, and
  Blacknel mock flags.
- `README.md` describing stack, requirements, scripts and conventions.
- `types/global.d.ts` ambient declarations placeholder.
