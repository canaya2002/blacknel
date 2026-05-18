# Blacknel — UI Patterns

Reusable structural patterns for the Blacknel app surface. Each
pattern is defined once here and consistently applied across pages
that share its shape, so a new feature in Phase 10+ has an obvious
template to start from instead of inventing one.

> The shorter the doc, the more useful it stays. When you have an
> answer for "should this look like X or Y", write it down here and
> link from the file you applied it to.

---

## Detail page template (Phase 9 / Commit 35 · Ajuste 1)

Every detail surface in the app — `/nps/surveys/[id]`,
`/competitors/[id]`, `/reports/scheduled/[id]`, future Phase-10
Enterprise dashboards — follows the same 5-section layout. The
order is fixed; sections may be omitted but never reordered.

### Section order

```
+-------------------------------------------------------------+
| 1. PageHeader                                               |
|    title · subtitle · status badge · action buttons (TR)    |
+-------------------------------------------------------------+
| 2. KPI cards row (3-5 cards, same shape as /reports KPIs)   |
+-------------------------------------------------------------+
| 3. Timeline / chart / sparkline                             |
|    Placeholder text when no data yet — never blank          |
+-------------------------------------------------------------+
| 4. Tab nav (if sub-views) OR tables / lists directly        |
+-------------------------------------------------------------+
| 5. Footer actions (delete / archive / dangerous ops)        |
|    Only when the page exposes destructive surface           |
+-------------------------------------------------------------+
```

### What each section is for

1. **PageHeader.** `<PageHeader />` from
   `components/common/page-header.tsx`. The `eyebrow` slot
   carries the "← Back to X" link. `actions` slot holds primary
   buttons (Edit, Pause, Run now). Status badges sit beside the
   title or to the right of the description; pick one and stick
   with it within a feature.

2. **KPI cards row.** A flat horizontal strip of 3-5 `<Card />`s.
   Each carries a small uppercase label + a large tabular-nums
   value. Match the size hierarchy already used in `/reports`
   (`text-2xl font-semibold tabular-nums`) so the visual rhythm
   stays consistent. When showing a delta vs previous period,
   reuse the trend coloring from `DeltaShape` in
   `lib/reports/period.ts`.

3. **Timeline / chart / sparkline.** This is where the
   time-series live (rolling 30d response rate, daily share of
   voice, run history). When the feature has no chart yet,
   render an explanatory placeholder text inside a `<Card />`
   instead of leaving a gap. Never ship a blank section.

4. **Tabs OR tables.** Tabs only when the detail page legitimately
   has sub-views (e.g. an `Inbox` vs `Reviews` split). Otherwise
   put the table/list directly. Tab nav uses the same URL-driven
   `?tab=` pattern as `/listening`, `/nps`, `/reports`.

5. **Footer actions.** Destructive operations (archive, delete)
   live at the bottom, separated visually. Confirms via dialog
   are handled per-component; the template just establishes the
   slot.

### When to deviate

- **List pages** (the index over many entities, e.g. `/listening`
  Mentions tab) follow a different shape — KPI row + filter row +
  feed. Don't try to force them into the detail template.
- **Onboarding / wizard surfaces** have their own shell — see
  `app/(onboarding)/`.

### Compliance helpers

- `components/common/page-header.tsx` — section 1.
- `components/ui/card.tsx` — sections 2-5.
- No dedicated `<DetailPageShell />` component exists — the
  pattern is intentionally inline because each page's KPI mix
  + chart shape differs enough that a shell would just be a flex
  container. The doc IS the contract.

---

## Critical actions — dual TS + DB enforcement (Phase 10 / Commit 36a)

Some operations are sensitive enough that a bug in the TS auth
layer (forgetting to call `authorize()`, mis-typing a permission,
caller bypassing the helper) would cause real harm: data loss,
auth bypass, billing compromise, compliance violation.

For these operations we apply **dual enforcement**: the TS layer
checks first (as for all 144+ pre-C36a callers), and the DB
function `app_permission_check()` cross-checks against live
state. Bypass of one layer is not enough — the call needs the
permission in BOTH.

### Canonical list (10 actions)

1. **`billing:manage`** — any operation that touches subscriptions
   or payment methods.
2. **`team:manage_roles`** — any default-role change on
   `organization_members`.
3. **Custom role assignments** — assigning / un-assigning a member
   to a `custom_roles` row (`organization_members.custom_role_id`).
4. **Default role changes** — changing `organization_members.role`
   itself (owner → admin, manager → agent, etc).
5. **`reports:export` with `mass=true`** — CSV / JSON exports of
   >1000 rows.
6. **`audit:read` with `export` flag** — bulk audit log dumps.
7. **`posts:delete` massive** — single-action delete of >10 posts.
8. **`whatsapp:manage_templates`** — template create/edit.
   Compliance surface (Meta API).
9. **`integrations:manage`** — disconnect (potential data-loss op).
10. **Custom role mutations** — create / edit / archive of
    `custom_roles` rows themselves.

### Process to add a new critical action

When a new operation is proposed, ask:

> Could bypass of the TS layer on this operation cause (a) data
> loss masiva, (b) auth bypass, (c) billing comprometido, (d)
> compliance violation?

- **If YES to any** → critical action. Add to the list above.
  Wire `assertPermissionInDb(session, permission)` from
  `lib/permissions/db-check.ts` into the Server Action body
  AFTER the existing `authorize()` call.
- **If NO** → TS-only enforcement is sufficient. Do not add
  to the list (every entry is a DB round-trip; the list stays
  short on purpose).

This rule prevents the failure mode "we forgot to add X to the
list" because every new action goes through this gate by default.

### SQL function naming convention (D-36a-11)

DB functions implementing internal Blacknel domain logic use the
**`app_` prefix**. Distinguishes from:

- `pg_*` — Postgres system functions.
- Unprefixed in `public` schema — potentially shared / exposed.

Current `app_*` functions (Phase 10 / Commit 36a):

- `app_permission_check(user_id, org_id, permission)` — RBAC check.
- `app_valid_permission_format(perms text[])` — format validation
  for `custom_roles.grants` / `revokes` CHECK constraints.

### Phase 11 follow-up

In Phase 11 with Supabase Auth, evaluate moving `app_*` functions
to a dedicated `blacknel_internal` schema for isolation. Tracked
in `TODO.md#rbac-rls-dynamic-policies-supabase-auth`.

---

## Triple-layer defense-in-depth (Phase 11 / Commit 42c)

C42c lands RESTRICTIVE RLS policies on **four critical tables**
that promote the C36a dual TS+DB enforcement to a triple
TS+DB+RLS stack. The gate is the third layer; both prior layers
remain in place and are NOT to be removed in C42c.

### Three layers

| Layer | Where | When it fires | Failure mode |
|---|---|---|---|
| 1. `authorize(role, perm)` | every Server Action (144 callers) | always (cheap, mock-friendly) | TS error caught by `<form>` action / error boundary → user toast |
| 2. `assertPermissionInDb(session, perm)` | the 10 critical actions in `lib/permissions/db-check.ts` | always for those 10 (one DB round-trip each) | `AppError('FORBIDDEN', …)` → 403 |
| 3. RESTRICTIVE RLS policies (migration 0023) | 4 critical tables, when `blacknel.rls_dynamic = 'on'` | per-row during query execution | UPDATE/DELETE → 0 rows affected (silent); INSERT → "new row violates RLS policy" error |

### Which 4 tables + which operations are gated

| Table | Operation | Required permission |
|---|---|---|
| `posts` | UPDATE | `posts:publish` |
| `posts` | DELETE | `posts:delete` |
| `audit_events` | SELECT | `audit:read` |
| `custom_roles` | INSERT | `team:manage_roles` |
| `custom_roles` | UPDATE | `team:manage_roles` |
| `custom_roles` | DELETE | `team:manage_roles` |

`custom_roles` SELECT stays tenant-only — any org member can list
the custom roles defined in their org (UI surface). `subscriptions`
mutations stay behind `dbAdmin` (no GRANT to authenticated) so no
RLS gate is needed for now.

### The `blacknel.rls_dynamic` flag

The third layer is gated by a Postgres setting that the operator
flips via `pnpm db:rls on/off` (which issues `ALTER DATABASE …
SET blacknel.rls_dynamic = …`). Default is "off" → restrictive
policies short-circuit as no-ops, behaviour is identical to C42b.
Rollback is a single SQL statement and takes effect on the next
session reconnect — no redeploy required.

Full procedure: `doc/runbooks/rls-rollback.md`.

### Do NOT remove layer 2 (`assertPermissionInDb`)

Layer 2 is the fallback that lets the operator flip layer 3 off
without losing security guarantees during an incident. Removal
happens (if at all) in the C50 closure pass after months of stable
layer-3 operation, and only with explicit charter sign-off.

### Where the RLS denial UX surfaces

The third layer's denials are silent for UPDATE/DELETE (Postgres
USING semantics — invisible rows yield 0 affected). End-user UX
errors still come from layers 1/2 because those fire first for
any authenticated request. RLS catches only the bypass path —
the place we don't expect to see traffic. If Sentry shows "0
rows updated" from layer 3 during normal operation, that signals
a layer-1/2 bug to investigate.

---

## Build configuration (Phase 10 / Commit 36b)

Blacknel uses two different bundlers:

- **`pnpm dev`** → `next dev --turbopack`. Turbopack stays for
  development because its HMR (hot-module-reload) is materially
  faster than webpack's; that is the main Turbopack value
  proposition.
- **`pnpm build`** → `next build --webpack`. **Webpack is the
  default for production builds** because Turbopack on the
  Blacknel Windows dev env recurrently crashes during build
  (8+ different errors in a single C36a session:
  `STATUS_ACCESS_VIOLATION`, SWC parser assertions, 442GB OOM
  Rust panics, CSS module loader failures). Webpack succeeds
  cleanly on the first try.

The escalation was applied at the start of Commit 36b after the
C36a session burned ~30 min in retry loops. Tracking:
`TODO.md#turbopack-builds-webpack-fallback-applied`.

### When to re-evaluate

Re-evaluate switching `build` back to Turbopack when:

1. The Next.js / Turbopack project ships a major stability fix
   (track upstream issue tracker; Next 17.x candidate).
2. The Blacknel codebase shrinks materially (unlikely as we add
   Phase 11+ features).
3. CI moves to Linux runners where the Windows-specific failure
   modes don't apply — at that point `build` can split into
   `build:webpack` (kept here) + `build:turbopack` (CI-only).
