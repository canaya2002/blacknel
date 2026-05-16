# TODO

Cross-cutting follow-ups not scoped to a specific phase. Each entry has an
anchor (the `## name` slug) that source code references via
`Tracking: TODO.md#<anchor>`.

## dbas-tx-type

**Problem.** `lib/db/client.ts` types the Drizzle PG database and
transaction loosely as `any` (`AnyPgDb`, `AnyPgTx`). The wrappers
(`runAs`, `runAdmin`, `dbAs`, `dbAdmin`) accept `any` for the `tx`
parameter passed to the user callback. Callers narrow results by
passing a schema `$inferSelect` type as the generic on `runAs<T>` /
`runAdmin<T>` — see the RLS tests for the pattern.

**Why.** The two Drizzle PG adapters Blacknel uses produce structurally
compatible runtime objects but slightly different TypeScript generics:

- `drizzle-orm/postgres-js` — production code path (wired in Phase 11
  alongside the Supabase cutover).
- `drizzle-orm/pglite` — dev runtime + integration tests for Phases 1–10.

Until Drizzle ships a shared `PgDatabase` / `PgTransaction` base across
adapters (or we consolidate to one adapter everywhere), the wrappers
stay loosely typed.

**Affected files.**

- `lib/db/client.ts` (the two `any` declarations + the eslint-disable
  comments below them).
- `tests/integration/rls.test.ts` and `tests/integration/rls.live.test.ts`
  (explicit `runAs<Brand[]>` / `runAdmin<Brand[]>` calls to narrow
  result types — these become unnecessary once `tx` is typed).
- Any future Server Action that calls `dbAs` and assigns the result to a
  variable will currently need an explicit type annotation. When this
  TODO closes, those annotations can go.

**Resolution criteria.** Close this when both of these hold:

1. `AnyPgDb` / `AnyPgTx` are removed from `lib/db/client.ts` and the
   wrappers accept a precise `PgTransaction<...>` (or equivalent
   shared base) instead.
2. The `// FIXME(blacknel)` and adjacent `// eslint-disable-next-line
   @typescript-eslint/no-explicit-any` comments are gone, and
   `pnpm verify` still passes.

Triggering conditions to revisit:

- Drizzle 0.40+ unifies adapter types.
- We commit to a single runtime for tests (e.g., a `pglite`-only test
  stack across the board, or a postgres-js-only stack via a
  testcontainer in Phase 11+).

**Target phase.** Phase 11 (opportunistic). The cutover to Supabase
is the moment we consolidate on a single runtime in production;
tests can follow with a testcontainer. If Drizzle ships unified
types before Phase 11, close earlier.

## trigger-defaulted-cols

**Problem.** `inbox_messages.organization_id` and
`internal_notes.organization_id` are NOT NULL columns auto-populated by
a BEFORE INSERT trigger (`public.inbox_messages_set_org_id` /
`public.internal_notes_set_org_id`, see `0005_inbox.sql`). Drizzle's
generated insert type still requires the field — it can't introspect the
trigger — so the Server Action in `app/(app)/inbox/actions.ts`
(`addInternalNoteAction`) currently casts the `values()` payload through
`as any` to omit it.

**Resolution criteria.** Close this when either of these holds:

1. Drizzle adds a column annotation (or `$defaultFn`) that marks a
   column as DB-defaulted-on-insert so the generated insert type makes
   it optional.
2. We add a typed wrapper in `lib/inbox/` that constructs a partial
   insert object and stamps `organization_id` explicitly from the
   session before reaching Drizzle — bypassing the trigger but keeping
   the SQL as a defense-in-depth fallback.

**Affected files.**

- `lib/db/migrations/0005_inbox.sql` — the `inbox_messages_set_org_id`
  / `internal_notes_set_org_id` / `review_responses_set_org_id`
  triggers (added in Commit 12 to extend the same pattern).
- `app/(app)/inbox/actions.ts` — `addInternalNoteAction` (the
  `as any` cast).
- Future review-response actions in Commit 14 already use explicit
  `organizationId` from session so they don't trip the issue; if
  any future caller forgets, this TODO is the reference for the
  workaround.

**Target phase.** Deferred indefinitely; this is a Drizzle ergonomics
issue, not a correctness one. Phase 11 may close path #2 (typed
wrapper) opportunistically when refactoring inbox queries for
Supabase real-time.

## inbox-fts-trigram

**Problem.** `inbox_messages.search_tsv` uses `to_tsvector('simple', body)`
and a GIN index — the Phase-4 baseline. The `'simple'` config skips
language stemming, which means a search for `"refund"` won't match
`"reembolso"`, and accented variants only collapse approximately. Trigram
indexing (`pg_trgm`) would close the gap for fuzzy / typo-tolerant
search and substring matches.

**Why deferred.** `@electric-sql/pglite` 0.2.x does not bundle `pg_trgm`
in its standard extension set. Adding it on the dev runtime would
require pulling a separate WASM extension build and wiring it into
`lib/db/dev-runtime.ts`, which is overkill for Phase 4's UX. Supabase
Postgres has `pg_trgm` available by default — the production path is
unblocked whenever we wire it in.

**Resolution criteria.** Close this when:

1. The dev pglite loads `pg_trgm` (either via an upstream pglite update
   or by sideloading the extension).
2. A new migration `00NN_trigram.sql` adds
   `CREATE INDEX inbox_messages_body_trgm_idx ON inbox_messages USING GIN (body gin_trgm_ops);`
   and the search path in `lib/inbox/queries.ts` (Commit 8) consults it
   for fuzzy matches when the `tsvector` query is empty.
3. `lib/reviews/queries.ts` (Commit 13) also switches its current
   ILIKE fallback to the trigram index — the same TODO covers both
   surfaces.

**Affected files.**

- `lib/inbox/queries.ts` — `filters.q` branch using `plainto_tsquery`.
- `lib/reviews/queries.ts` — `filters.q` branch using ILIKE (the
  Phase-5 fallback explicitly notes this TODO).
- `lib/db/dev-runtime.ts` — extension loading (pending pglite
  support).
- New migration `00NN_trigram.sql` (to be added at resolution time).

**Target phase.** Phase 11. Supabase Postgres ships with `pg_trgm`
in the default extension set; the production cutover unblocks the
real change. Dev runtime side may close earlier if pglite ships
trigram support.

Until then, the `'simple'` tsvector index is good enough for inbox
search at Phase-4 volumes; ILIKE is fine for /reviews search at
Phase-5 volumes (~200 reviews per org).

## audit-events-atomicity

**Problem.** `audit_events` rows are currently written via `dbAdmin`
(separate `service_role` transaction) AFTER the decision transaction
commits in `app/(app)/approvals/actions.ts`. The four actions affected
are `approveAction`, `approveWithEditsAction`, `rejectAction`, and
`escalateApprovalAction`. The same pattern exists in
`lib/inbox/send-reply.ts` for inbox reply audits.

**Why deferred.** Phase 4 ships with the dispatch+approve atomic pair
inside one txn — that's the load-bearing guarantee (no double-send).
The audit row is "nice to have" atomic but the consequence of audit
failing post-effect is "missing log line", not "duplicate publish".

**Why fix in Phase 11.** Once Supabase Postgres is the real backend,
we want every audit row to live or die with its triggering effect.
A crashed worker between effect-commit and audit-insert today would
leave production with an untraceable side effect.

**Resolution criteria.** Close this when:

1. Audit writes move inside the same `dbAs` transaction as the
   `UPDATE approvals` / `INSERT inbox_messages` they describe.
2. The `auditEvents` RLS policy allows `authenticated` to INSERT
   when `organization_id = current_setting('app.current_org_id')`,
   replacing the current admin-only path (or audit table grants
   stay admin-only and we use a SECURITY DEFINER function wrapper).
3. Tests confirm: if the audit row insert is forced to fail, the
   approval/decision rolls back too — no orphan effects.

**Affected files.**

- `app/(app)/approvals/actions.ts` — 4 actions (approve,
  approveWithEdits, reject, escalate).
- `lib/inbox/send-reply.ts` — 3 audit call sites (sent, blocked,
  routed).
- `lib/reviews/send-response.ts` — 5 audit call sites added in
  Commit 14 (drafted / sent / routed_to_approval / published /
  rejected).
- `lib/reviews/send-request.ts` — 4 audit call sites added in
  Commit 16 (sent / skipped_dup / plan_limit / cancelled).
- `lib/reviews/public-feedback.ts` — `feedback.received` audit
  (Commit 16). This one already runs inside the `dbAdmin` txn so
  is atomic by accident; the resolution still needs to verify it.
- Possibly `lib/db/migrations/00NN_audit_authenticated_grant.sql`
  (new) or a SECURITY DEFINER function wrapper.

**Target phase.** Phase 11 (Supabase cutover). The atomicity gain
is meaningful once a real network sits between the app and the
DB; in pglite the post-commit window is sub-millisecond.

## polling-scroll-and-url-state

**Problem.** `usePolling` invokes `router.refresh()` on each tick.
Next.js preserves URL state by default, so:

- Active URL filters survive across refresh — the URL is the source
  of truth and polling never touches it.
- "Cargar más" accumulated rows held in client `useState` (see
  `components/inbox/thread-list.tsx` and `components/approvals/approvals-list.tsx`)
  are LOST on each poll refresh — the next render re-fetches page 1
  from the URL cursor. Intentional for Phase 4; tracked for polish.
- Scroll position with `router.refresh()` in Next 16 + virtuoso is
  "best effort" — short lists stay put; a virtualized list that
  re-mounts on RSC re-render can jump to the top.

**Why deferred.** Phase 4 ships with explicit "Cargar más" buttons
(not infinite scroll), so the page-1 reset is acceptable for now.
Real users editing a thread will be on the detail page where there's
no accumulated state. The scroll concern surfaces mainly when a
moderator scrolls deep into /inbox or /approvals and the 30s/60s
poll catches them mid-scroll.

**Resolution criteria (Phase 12 polish).**

1. Persist accumulated rows across `router.refresh()` — likely by
   lifting the list state into a Context that survives RSC re-render,
   or by polling a JSON endpoint instead of `router.refresh()`.
2. Pin scroll position in `<Virtuoso>` across refresh by remembering
   the topmost-visible item id and restoring after.
3. Verify behavior end-to-end with Playwright when the e2e harness
   lands in Phase 12.

**Affected files.**

- `components/common/use-polling.ts` — the hook that runs
  `router.refresh()` on tick.
- `components/inbox/thread-list.tsx` — accumulated `useState`
  list (Commit 8).
- `components/approvals/approvals-list.tsx` — same shape
  (Commit 10).
- `components/reviews/reviews-list.tsx` — same shape (Commit 13).
- Future virtualized lists added in Phase 6 (Publishing
  calendar) and Phase 8 (Reports) will inherit the same TODO
  until this is closed.

**Target phase.** Phase 12 (polish + Playwright e2e harness).

## history-collapsed-commit

**Problem.** On 2026-05-16, the operator's `git pull` brought down all
of Phase 4 (Commits 7–11) plus Commit 12 squashed into a single commit
`9054859` with the placeholder message `"sefjs}"`. 15,736 LOC across
109 files (schemas, migrations, Server Actions, components, tests for
inbox, approvals, and the reviews-schema portion of Phase 5) are in
that one commit. The local Commits 7–12 progress narrative the
operator dictated in chat is real work — it just isn't reflected in
git's commit-by-commit history.

**Impact.** Cosmetic for now. `git log` doesn't tell the story of each
commit's scope, `git blame` lumps every line into the same SHA, and a
bisect against any regression introduced in that range collapses to
"it was already broken in 9054859". Commit 13 onward is back to clean
incremental commits.

**Why deferred.** Reconstructing 6 commits requires `git filter-branch`
or `git rebase -i` with careful chunking of the 109 files into the
right commits. That's a destructive history rewrite on `main` —
appropriate before any external contributor sees the repo, dangerous
once it's been shared. Phase 12 is when we cut a clean
`origin/release/v1` branch anyway.

**Resolution criteria (Phase 12 evaluation).** Pick one:

1. **Rewrite path** — branch from before `9054859`, replay Commits 7–12
   from the chat-recorded narrative (schemas → inbox list → inbox
   detail → approvals → polling → reviews schema), force-push the
   rewritten `main`. Coordinate with the operator that no external
   clones exist.
2. **Accept and document** — leave history as-is, add a long-form
   description to the v1 release notes explaining what landed in
   `9054859`. `CHANGELOG.md` already groups changes by phase, which
   covers most archaeology needs.

**Affected files.** None in `lib/` or `app/`. This is a git-history
concern; resolution operates on the commit graph, not on source
files. `CHANGELOG.md` carries the per-phase narrative the squashed
commit obscures.

**Target phase.** Phase 12 (release-branch cut). Either rewrite
or accept-and-document at that point.

**Not blocking.** Tests, types, lint, and runtime behavior are all
green. This is a historiography issue, not a correctness one.

## reputation-tags-sql-path

**Problem.** `getTopTagsWithTx` (Commit 15) reads `(sentiment, tags)`
for the in-scope reviews and aggregates in JS instead of unrolling
via `jsonb_array_elements_text` + `GROUP BY` on the SQL side. For
Phase-5 volumes (~200 reviews per org) the JS pass is cheaper than
the SQL one; once volumes climb past ~10K reviews per filter window
the trip-time of the raw rows starts to dominate.

**Resolution criteria (Phase 11+).** Close when:

1. A migration / query path exposes `reviews.tags` exploded via
   `jsonb_array_elements_text` with the same RLS scope (predicates
   on `organization_id` / `brand_id` / `location_id` / `platform` /
   `posted_at`).
2. `getTopTagsWithTx` switches to the SQL path; the JS aggregation
   is removed.
3. Integration tests against 10K+ seeded reviews show the SQL path
   is faster than the JS path under the same filter shape.

**Affected files.**

- `lib/reputation/queries.ts` — the `getTopTagsWithTx` JS
  aggregation block.
- `tests/integration/reputation-queries.test.ts` — the
  `getTopTagsWithTx` assertions; will need a 10K-row seed
  performance harness once the SQL path lands.

**Target phase.** Phase 11+ (volume-triggered). The JS aggregation
is fine for top-tags at Phase-5 volumes — top-tags is a dashboard
card, not a hot path.

## crisis-yoy-suppression

**Problem.** `evaluateCrisis` (Commit 15) fires on a strict spike
predicate: ≥5 negative reviews in 72h AND ≤1 in the prior 72h. It
does NOT compare against the same window last year. A location with
a recurring seasonal negative cluster (holiday week, exam period,
sale-promo aftermath) will fire CRISIS_TRIGGER every year for the
same legitimate reason, which is noise.

**Resolution criteria (Phase 7).** Close when `lib/ai/crisis.ts`
ships and includes:

1. Same-window-last-year recall: pull negative counts for the
   matching ISO week from the prior year. If the year-over-year
   count is within a configurable band (default ±30%), downgrade the
   severity by one level (`high` → `medium`, `medium` → suppressed).
2. The Phase-5 `evaluateCrisis` predicate stays as the fallback when
   year-over-year data is missing (new locations, first year).
3. A `crisis_suppressed_by` audit field on `crisis_alerts` records
   the suppression reason so the dashboard can render "Suppressed:
   matches 2025 holiday week pattern".

**Affected files.**

- `lib/reputation/crisis-rule.ts` — current `evaluateCrisis`
  predicate; needs a YoY-aware sibling or a wrapper.
- `lib/reputation/queries.ts` — `getCrisisCountsWithTx` already
  exposes the counts but not the prior-year slice; will need an
  extra branch.
- New file `lib/ai/crisis.ts` (Phase-7) for the IA classifier.
- `lib/db/schema/crisis-alerts.ts` (new) — the persistent
  alerts table with `crisis_suppressed_by` field.

**Target phase.** Phase 7 (IA + crisis detection module). The
heuristic in Commit 15 is the Phase-5 baseline.

## usage-counters-rls-scoped

**Problem.** 11 sites use `dbAdmin` to read or write
`usage_counters`. The pattern is correct but ergonomically
suboptimal — `usage_counters` only grants `SELECT` to the
`authenticated` role (RLS-scoped to the caller's org), so every
INSERT / UPDATE has to escape into `dbAdmin`. The repetition
spreads `dbAdmin` references across the codebase, which makes
the Phase-11 security audit surface harder to reason about.

The actual security boundary is: a counter writer must never
write outside its org. The current implementation enforces this
by convention (every caller passes `session.orgId`); RLS would
enforce it structurally.

Two paths to evaluate at the Phase-11 security audit:

  (a) **RLS-scoped writes.** Add a policy
      `usage_counters_tenant_write` that allows INSERT / UPDATE
      for `authenticated` when `organization_id = NULLIF(
      current_setting('app.current_org_id', true), '')::uuid`.
      Drop the `dbAdmin` wrapper from all 11 sites; they call
      the counter helpers through `dbAs` like every other write.
      Pro: structural enforcement matches the rest of the schema.
      Con: any future migration that forgets the policy silently
      demotes the guarantee.

  (b) **Centralized admin wrapper.** Keep `dbAdmin` but funnel
      every counter mutation through a single
      `lib/usage/admin-write.ts` exposing
      `bumpUsageAsAdmin(orgId, metric, delta)`. The 11 sites
      lose their direct `dbAdmin` imports; the audit surface
      for usage-counter writes shrinks to one file. Pro:
      explicit, auditable. Con: another indirection layer.

Decision depends on the Phase-11 security audit. Path (a) is
more idiomatic; path (b) is more conservative.

**Affected files (11 sites; also referenced from
`lib/usage/counters.ts` JSDoc).**

- `app/(app)/integrations/actions.ts:70` — `checkUsage`
- `app/(app)/integrations/actions.ts:112` — `incrementUsage(socialAccounts)`
- `app/(app)/integrations/actions.ts:145` — `decrementUsage(socialAccounts)`
- `app/(app)/team/actions.ts:66` — `checkUsage(users)`
- `app/(app)/team/actions.ts:116` — `incrementUsage(users)`
- `app/(app)/team/actions.ts:243` — `decrementUsage(users)`
- `app/(app)/team/actions.ts:280` — `decrementUsage(users)`
- `app/(app)/billing/page.tsx:28–32` — five `readUsage` calls
  (one per metric)
- `app/(onboarding)/onboarding/start/actions.ts:235` —
  `incrementUsage(brands)`
- `app/(onboarding)/onboarding/start/actions.ts:298` —
  `incrementUsage(locations)`
- `app/(onboarding)/onboarding/start/actions.ts:371` —
  `incrementUsage(users)`
- `lib/reviews/send-request.ts` —
  `incrementUsage(reviewRequestsPerMonth)` (added in Commit 16;
  same pattern, separated from the main txn for the same RLS
  reason)

If path (a) wins, also update the JSDoc on
`lib/usage/counters.ts` to drop the admin reference.

**Resolution criteria.** Close when either of these holds:

1. **Path (a) chosen.** A new migration adds the RLS write
   policy. Every site listed above drops its `dbAdmin` wrapper
   and calls the counter helpers under `dbAs`. `pnpm verify`
   still passes.
2. **Path (b) chosen.** `lib/usage/admin-write.ts` is the only
   place that imports `dbAdmin` for counter mutations. The 11
   sites import the wrapper instead.

Verification command (either path):
`grep -rn "dbAdmin.*\(increment\|decrement\|check\|read\)Usage" app/ lib/`
should return exactly one hit (path b, the wrapper) or zero hits
(path a, all through `dbAs`).

**Target phase.** Phase 11 (security audit + Supabase cutover).

## connector-publish-limits-2026

**Problem.** Commit 17 added `publishLimits` to the
`ConnectorCapabilities` interface and populated values for the
8 publish-capable platforms (facebook, instagram, x, linkedin,
tiktok, pinterest, youtube, gbp). Values are sourced from public
API docs as of 2026-Q1 and JSDoc-annotated with the source URL
in each capabilities.ts.

Platform APIs change limits without notice (X tripled long-form
in Q3 2025; Instagram's carousel cap moved from 10 to a
threaded-post model in beta). The Phase-5 composer is mock-only;
divergence between our `publishLimits` and reality doesn't break
anything until the real connector lands.

**Resolution criteria (Phase 11).** Close when:

1. For each of the 8 publish-capable platforms, the connector
   integration test calls a tiny sandbox API call that confirms
   the limit values are still accurate, OR a manual checklist in
   the Phase-11 connector README records the verification per
   platform with a date.
2. The 8 `capabilities.ts` files have their JSDoc source-date
   updated to the verification date.
3. Any limit that drifted gets a one-line update + a one-line
   note in CHANGELOG.

**Affected files (8).**

- `lib/connectors/facebook/capabilities.ts`
- `lib/connectors/instagram/capabilities.ts`
- `lib/connectors/x/capabilities.ts`
- `lib/connectors/linkedin/capabilities.ts`
- `lib/connectors/tiktok/capabilities.ts`
- `lib/connectors/pinterest/capabilities.ts`
- `lib/connectors/youtube/capabilities.ts`
- `lib/connectors/gbp/capabilities.ts`

**Target phase.** Phase 11 (connector cutover).
