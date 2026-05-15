# Changelog

All notable changes to Blacknel are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — Phase 1 / Commit 4

**Dev runtime**

- `lib/db/dev-runtime.ts` — pglite with FS persistence at
  `.blacknel/pglite-data/`. Boots once per process, auto-applies every
  SQL migration, idempotent-seeds via `seedDatabase`. Same Postgres
  semantics (RLS, triggers, enums, roles) as the Phase-11 cutover.
- `lib/db/migrate.ts` + `lib/db/seed.ts` — extracted from `scripts/`
  so the migration runner and seed are reusable by the dev runtime
  *and* the standalone CLI scripts.
- `lib/db/client.ts` updated: `getRawDb()` is now async and routes
  between postgres-js and pglite based on `BLACKNEL_USE_MOCKS` + the
  presence of `DATABASE_URL`. Tests refuse to call it — they must
  inject the test fixture instead.
- `.blacknel/` added to `.gitignore`.

**App shell**

- `app/layout.tsx` — root layout with `<Providers>` and `globals.css`.
- `app/globals.css` — Tailwind v4 with `@theme` design tokens
  (`--color-brand-primary`, `--color-brand-accent: #3F4753`,
  `--color-brand-warning`, `--color-brand-danger`) and shadcn-style HSL
  semantic tokens for light/dark.
- `components/ui/*` — minimum shadcn set written in by hand for
  Tailwind v4 compat: button, card, badge, skeleton, separator,
  tooltip, dropdown-menu, avatar, collapsible.
- `components/common/*` — `PageHeader`, `EmptyState` (icon + title +
  specific description + optional disabled CTA with phase tooltip),
  `PlanBadge`, `UpgradePrompt`, `ModuleSkeleton`.
- `components/layout/*` — `Sidebar` (5 grouped collapsible sections,
  plan-aware items with badges + tooltips, redirects gated clicks to
  /billing), `Topbar` (brand + location switchers, theme toggle, user
  menu with sign-out Server Action), `BrandSwitcher` /
  `LocationSwitcher` (URL-driven via `useSearchParams`),
  `Breadcrumbs` (derived from pathname via `SIDEBAR_ITEMS_BY_HREF`),
  `ThemeToggle`, `UserMenu`, `BrandLocationCookieSync` (writes URL
  scope to the cookie for next-session persistence).

**Brand / location context**

- `lib/context/constants.ts` — client-safe `CONTEXT_COOKIE_NAME`.
- `lib/context/brand-location.ts` — `resolveBrandLocationContext`,
  `listBrandsAndLocations`, `writeBrandLocationCookie`. URL params
  win, cookie is the fallback.
- `lib/queries/plan.ts` — `getOrgPlanCode(session)` for plan-aware UI.

**Routes**

- `app/(marketing)/page.tsx` — landing.
- `app/(marketing)/pricing/page.tsx` — pricing comparison generated
  from the `PLANS` const.
- `app/(marketing)/login/page.tsx` + `login-form.tsx` + `actions.ts` —
  dev impersonation. Lists every seeded `(user × org)` pair; selecting
  one signs the session cookie via `loginAsDevUser` and redirects to
  /dashboard. Aborts in production.
- `app/(app)/layout.tsx` — Shell with sidebar, topbar, breadcrumbs,
  cookie sync. `force-dynamic` (the app is request-bound; SSG against
  pglite would freeze the seed).
- `app/(app)/<module>/page.tsx` + `loading.tsx` × 19 — one per module
  in the doc's section 11.3 layout. Each has a specific page header
  description and an `EmptyState` whose copy describes what the
  surface shows once data exists, plus phase-tagged disabled CTAs.
  Plan-gated modules (Approvals, Feedback, Listening, Competitors,
  Ads, Audit) render an `UpgradePrompt` instead of the empty state
  when the org's plan is below the threshold. Locations, Team, and
  Billing render live seed data — cards of the 5 locations / 6 users
  with role tones / current plan summary with usage placeholders.

**Other**

- `proxy.ts` (renamed from `middleware.ts` per Next 16 deprecation) —
  validates the session cookie, drops malformed cookies, redirects
  unauthenticated traffic on protected paths to `/login?next=…`.
  Public marketing routes and `/feedback/*` callbacks stay open.
- `next.config.ts` — `typedRoutes` moved out of `experimental`.
- `app/(app)/actions.ts` — `logoutAction` Server Action.
- `tsconfig.json` updated by Next 16 build (`jsx: react-jsx`, plus
  `.next/dev/types/**` in include).
- New deps: `lucide-react`, `clsx`, `tailwind-merge`,
  `class-variance-authority`, `@radix-ui/react-*` (avatar, collapsible,
  dropdown-menu, popover, separator, slot, tooltip).

### Added — Phase 1 / Commit 3

- `lib/permissions/roles.ts` — `Role` and `Permission` types plus the
  full `ROLE_PERMISSIONS` matrix (owner / admin / manager / agent /
  viewer).
- `lib/permissions/can.ts` — `can(role, permission)` pure predicate,
  `authorize(role, permission)` throwing variant (raises `FORBIDDEN`),
  `sessionCan(session, permission)` convenience.
- `lib/plans/plans.ts` — `PLANS` const (Standard $69 / Growth $299 /
  Enterprise $1,099) with limits + features + platform networks.
  Source of truth; `scripts/seed.ts` now reads from here instead of
  duplicating data.
- `lib/plans/gating.ts` — `planAllowsFeature`, `planFeatureTier`,
  `planAllowsPlatform`, throwing variants `requireFeature` and
  `requirePlatform` (raise `FEATURE_NOT_AVAILABLE_ON_PLAN`).
- `lib/plans/limits.ts` — `getPlanLimit`, `fitsLimit`, `requireLimit`
  (raises `PLAN_LIMIT_REACHED`). Treats `-1` as unlimited.
- `lib/connectors/types.ts` — `PlatformCode` and `Capability` types
  shared between plans, future connectors and UI gates.
- `lib/auth/types.ts` — `Session` shape (userId, orgId, role, email,
  optional name) — same shape Phase 11 Supabase Auth will populate.
- `lib/auth/cookie.ts` — JOSE-backed JWT HS256 sign / verify with
  embedded `v` schema version. Falls back to a stable dev secret when
  `BLACKNEL_COOKIE_SECRET` is unset (with a one-shot warning); throws
  in production.
- `lib/auth/server.ts` — `getSession`, `requireUser`, `requireOrg`,
  `requirePermission`, `setSession`, `clearSession`. Marked
  `server-only` so an accidental client import fails at build.
- `lib/auth/dev.ts` — `loginAsDevUser` / `logoutDevUser`. Aborts in
  production; Commit 4 will wire the dev login UI to it.
- `middleware.ts` — root middleware. Validates the session cookie,
  drops it cleanly when malformed, redirects unauthenticated traffic
  on protected paths to `/login?next=...`. Marketing routes (`/`,
  `/pricing`, `/login`, `/feedback/*`, `/auth/*`) stay open.
- `components/providers.tsx` — client `<Providers>` wrapping
  `<QueryClientProvider>` + `<ThemeProvider>`. Conservative React Query
  defaults (no refetch-on-focus, 30s stale, retry 1).
- `tests/unit/permissions.test.ts` — 11 cases covering matrix invariants
  and `authorize` error shape.
- `tests/unit/plans.test.ts` — 17 cases covering catalog contract,
  feature gating, platform gating, limit fits / requires, and tier
  resolution.
- New deps: `jose`, `@tanstack/react-query`, `next-themes`. Env adds
  `BLACKNEL_COOKIE_SECRET` (optional in dev, required in production).

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
