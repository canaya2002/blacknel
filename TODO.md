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

**Status update — Commit 25 shipped the AI crisis detector.** The
Phase-7 producer (`lib/jobs/crisis-scan.ts`) runs every 60min, calls
`detectCrisis` (Opus), and persists results to
`ai_recommendations` with the D-25-3 refined merge logic. The TWO
existing crisis surfaces now coexist on `/reputation`:

  - `<CrisisAlertBanner />` — Phase-5 heuristic via
    `lib/reputation/crisis-rule.ts`. Strict 72h spike predicate.
    No YoY awareness.
  - `<CrisisRecommendationsBanner />` — Phase-7 AI driver via
    `ai_recommendations`. Better severity reasoning, durable
    decision lifecycle (pending → accepted | dismissed). Still
    no YoY awareness.

**Remaining problem.** Neither surface compares the current 24h
window against the same period in prior years. A location with a
recurring seasonal negative cluster (holiday week, exam period,
sale-promo aftermath) will fire crisis every year for the same
legitimate reason.

**Resolution criteria (Phase 9 polish — delayed from Phase 7).**
Requires ≥1 year of historical review data per org, which most
seed orgs don't have yet. Implementation when ready:

1. Same-window-last-year recall: `lib/jobs/crisis-scan.ts` pulls
   negative counts for the matching ISO week 1 year prior.
2. Delta gate: if YoY delta is within ±X% (config default ±30%),
   suppress the rec OR downgrade severity by one level.
3. Audit captures the suppression: new audit action
   `ai_recommendation.crisis.suppressed_yoy` with prior-year
   counts + delta in `after` metadata.
4. `<CrisisRecommendationsBanner />` shows a "Suppressed:
   matches 2025 holiday week pattern" annotation when the
   rec was downgraded by YoY instead of merged-skipped.

**Why deferred (Commit 25 explicit decision).** The current data
volumes in dev / seed orgs don't span a year; testing the YoY
predicate without real historical data leads to false confidence.
Phase 9 / 10 is when the earliest production orgs reach the
12-month mark and the feature actually has signal.

**Affected files (when Phase 9 lands).**

- `lib/jobs/crisis-scan.ts` — extend `scanForCrisis` with the
  YoY pull + delta check.
- `components/reputation/crisis-recommendations-banner.tsx` —
  show the suppression annotation.
- `lib/ai/recommendations.ts` — surface `suppressedYoy` flag
  on `CrisisRecListItem`.

**Target phase.** Phase 9 (polish — requires ≥1y historical
data).

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

## publish-job-concurrency-live

**Problem.** `tests/integration/publish-job.test.ts` exercises
SELECT FOR UPDATE serialization SEQUENTIALLY because pglite is
single-threaded WASM Postgres — `Promise.all` of two ticks does
not produce the real concurrency that two production worker
processes would. The architectural contract (FOR UPDATE +
conditional update via `transitionPostStatus`) cannot be
verified against the test runtime.

**Why.** Phase 6 ships against pglite (dev + integration tests).
The cron runs in-process via `setInterval` so even in dev there
is only one tick at a time. Production (Phase 11+) runs against
Supabase Postgres where the queue handoff to multiple workers
(or a worker plus a manual-retry action) genuinely races on the
same `posts` row.

**Resolution criteria (Phase 11).** Add
`tests/integration/publish-job.live.test.ts` (mirror of
`rls.live.test.ts` shape) that:

1. Opens two real-Postgres transactions concurrently.
2. Both call `processOneCandidate` against the same scheduled
   post.
3. Asserts exactly one transaction acquires the lock + drives
   `scheduled → publishing`; the other reads the post in
   `publishing` and silently skips.
4. Asserts a single `post.publishing.started` audit row is
   emitted (no double-dispatch).

**Affected files.**

- `tests/integration/publish-job.test.ts` (the sequential test
  documents the gap).
- `lib/jobs/publish-post.ts` (`processOneCandidate` is the SUT
  for the live test).

**Target phase.** Phase 11 (Supabase cutover).

## composer-readonly-bypass

**Problem.** `components/publish/composer/composer-shell.tsx`
wraps its subtree in `<fieldset disabled={readOnly}>` for the
Commit-20b read-only modes (`pending_approval`, `failed`). The
native `disabled` cascade covers inputs / textareas / buttons /
selects but NOT:

- Server-Action buttons mounted outside the form tree (the
  cancel button uses a form-action wrapper).
- Radix portal-mounted dialogs (Dialog content renders outside
  the `<fieldset>` DOM subtree, so its buttons stay enabled).
- `<Link href>` anchors (`<a>` is not affected by `disabled`).

If a user under `readOnly=true` clicks one of these, the
Server Action still fires. Today the backing Server Actions
reject mutations on `pending_approval` / `failed` posts via
their own status gates, so the UX outcome is an error toast —
not data corruption — but the affordance is misleading.

**Why deferred.** Commit 20b held a strict "single change in
composer-shell" rule (`<fieldset>` wrap, NO subcomponent
refactor). Auditing every subcomponent + propagating a
`readOnly` prop is a non-trivial follow-up and the safety net
(action-level gates) already prevents drift.

**Resolution criteria.** Audit each subcomponent under
`components/publish/composer/`:

1. List which ones bypass the `<fieldset>` cascade.
2. Add a `readOnly?: boolean` prop where needed (cancel-button,
   ai-caption-button, media-uploader's dialog launchers).
3. Render disabled visual state (cursor-not-allowed, opacity).
4. Add a Vitest case that mounts ComposerShell with
   `readOnly=true` and asserts the cancel-button + ai-caption
   dialog trigger are `aria-disabled` / `pointer-events-none`.

**Affected files.**

- `components/publish/composer/composer-shell.tsx`
- `components/publish/composer/cancel-button.tsx`
- `components/publish/composer/ai-caption-button.tsx`
- `components/publish/composer/media-uploader.tsx`

**Target phase.** Phase 12 (polish).

## composer-edit-modal-post-kind

**Problem.** `components/approvals/edit-modal.tsx` only exposes
a textarea bound to `messageBody` — the inbox_reply payload
field. The dispatchers for review_response (`body`) and post
(`editedText`, Commit 20b) both honor their respective fields,
but the queue UI can't drive an approveWithEdits for those kinds
end-to-end. Tests cover the dispatcher contract directly via
`runAs` + manual editedPayload construction (see
`reviews-approval-dispatch.test.ts` and
`post-approval-dispatch.test.ts`).

**Why deferred.** Commit 20b lands the dispatcher only; the
modal extension is a follow-up to keep the diff scoped. The
operational workaround is to reject + ask the author to edit
the draft, then re-route to approval.

**Resolution criteria.** Extend `EditModal` to:

1. Detect kind via `initialPayload.kind`.
2. For `kind='post'`, render a textarea bound to `editedText`
   (multi-line, 8 000 char max).
3. For `kind='review_response'`, render a textarea bound to
   `body`.
4. For `kind='inbox_reply'`, keep the existing `messageBody`
   path.
5. Add a Vitest case per branch asserting the resulting
   editedPayload shape is what each dispatcher consumes.

**Affected files.**

- `components/approvals/edit-modal.tsx`
- `tests/integration/approvals-flows.test.ts` (or a new file
  if the existing one becomes unwieldy).

**Target phase.** Phase 12 (polish).

## composer-campaign-picker-multi-brand

**Problem.** When the user changes the post's brand inside the
composer mid-edit, the `<CampaignPicker />` (Commit 21) still
shows campaigns for the OLD brand until the page reloads.

**Why deferred.** The composer loader fetches `campaignOptions`
once at page-load time. Refreshing on brand change requires
either a Server Action round-trip per brand swap or a Client
fetch hook — both add complexity for a flow that today involves
saving the brand change first (the brand picker is itself a
Server Action — `saveDraftAction`).

**Resolution criteria.** Either:

1. Wire a `useTransition`-driven re-fetch when `data.postDetail.brandId`
   changes in the shell's state — call a new server action
   `listCampaignsForBrandAction(brandId)` and rebuild `campaignOptions`
   client-side.
2. OR add a "Cambia la marca antes de elegir campaña" hint when
   brand is dirty + a campaign is selected.

**Affected files.**

- `components/publish/composer/campaign-picker.tsx`
- `components/publish/composer/composer-shell.tsx`
- `lib/publish/composer/loader.ts` (option 1)

**Target phase.** Phase 12 (polish).

## campaign-timeline-real-engagement

**Problem.** `/publish/campaigns/[id]` Resumen tab shows an
`Engagement: —` KPI placeholder. The data isn't aggregated
anywhere today; Phase 8 (Reports) is the natural home for
per-post engagement aggregation against a campaign dimension.

**Resolution criteria.** Phase 8 lands the reports query layer
that aggregates likes / comments / shares per post and groups
by `campaign_id`. Replace the placeholder in `campaign-detail`
with a real read.

**Affected files.**

- `app/(app)/publish/campaigns/[id]/page.tsx` (Resumen tab)
- `lib/campaigns/queries.ts` (`getCampaignDetail`)
- `lib/reports/*` (Phase 8)

**Target phase.** Phase 8 (Reports).

## previews-fiel-x-tiktok-pinterest-youtube

**Problem.** `preview-shell.tsx` dispatches X / TikTok /
Pinterest / YouTube to `<PreviewGeneric />`. Per the Commit 21
D-21-1 decision, we shipped LinkedIn fiel only to validate the
swap pattern; the other 4 wait until either Phase 12 polish or
the Phase 11 connector cutover surfaces real preview chrome
the user expects to see.

**Resolution criteria.** For each platform, build
`preview-<platform>.tsx` mirroring the LinkedIn shape:

- Square or circular avatar matching the real platform.
- Platform-specific meta line.
- Body truncated via the existing `truncateBody`.
- Media grid that respects the platform's display semantics
  (X = single image priority, TikTok = vertical aspect, etc).
- Footer with the real action buttons.

Add the platform to the `switch` in `preview-shell.tsx`. Each
preview gets a `React.memo` wrapper with `arePreviewPropsEqual`
and a perf cutoff test in `tests/unit/preview-perf.test.tsx`.

**Affected files.**

- `components/publish/composer/previews/preview-x.tsx` (new)
- `components/publish/composer/previews/preview-tiktok.tsx` (new)
- `components/publish/composer/previews/preview-pinterest.tsx` (new)
- `components/publish/composer/previews/preview-youtube.tsx` (new)
- `components/publish/composer/previews/preview-shell.tsx`

**Target phase.** Phase 12 (polish) — decide per platform
whether Phase 11 connector data changes the design.

## composer-dirty-state-dialog-polish

**Problem.** The composer's cancel/leave-with-unsaved-changes
guard uses `window.confirm()`. Functionally correct (per the
Commit 21 D-21-2 decision the user explicitly authorized
keeping it). Aesthetically a native browser confirm doesn't
match the rest of the shadcn UI vocabulary.

**Resolution criteria.** Replace `window.confirm()` with a
controlled `<Dialog>` from `components/ui/dialog.tsx`. Wire it
into the existing `<CancelButton />` flow so the surface is
identical apart from the chrome.

**Affected files.**

- `components/publish/composer/cancel-button.tsx`

**Target phase.** Phase 12 (polish). Purely aesthetic; no
behavior change.

## phase-11-anthropic-cutover

**Problem.** Commit 22 ships the complete Claude SDK adapter
structure but with a mock body. The real Anthropic SDK
integration is gated on Phase 11 (the same phase that swaps
the entire mock layer for real connectors + Supabase).

**Resolution criteria.** Full migration steps are documented
inline in `lib/ai/adapter-real.ts` JSDoc:

1. `pnpm add @anthropic-ai/sdk`
2. `lib/env.ts` declares `ANTHROPIC_API_KEY` (required in
   production, optional in dev → fall back to mock).
3. Implement `adapter-real.ts` body using
   `withTimeout(withRetry(...))` + `cache_control: ephemeral`
   on system prompts ≥1024 tokens.
4. Update `lib/ai/client.ts` to export `adapterReal`.
5. Run the smoke test in `tests/integration/ai-adapter-real-swap.test.ts`
   (a new test added in Phase 11 that stubs the Anthropic
   client and asserts every Phase-7 skill still typechecks).

**Affected files.**

- `lib/ai/adapter-real.ts`
- `lib/ai/client.ts`
- `lib/env.ts`
- `package.json`

**Target phase.** Phase 11 (Supabase + real-adapter cutover).

## prompt-cache-hit-metrics-dashboard

**Problem.** `/audit/ai`'s cache hit rate KPI collapses two
distinct signals into one number:

1. **Anthropic prompt-cache hits** (`cached_input_tokens` /
   `input_tokens`) — system prompts re-used within Anthropic's
   5-min cache window get a 90% input discount.
2. **Dedup hits** (`cache_hit` boolean) — same `(orgId,
   request_hash)` within our 5-min window returns the
   cached output without any model call.

These are economically very different (one saves ~70% per
call; the other saves 100%). Phase 11's budget surface needs
both visible.

**Resolution criteria.** Split the KPI into two distinct
numbers; add a stacked-area chart of daily token usage
broken down by `uncached_input + cached_input + output`.
Add per-skill cost ranking.

**Affected files.**

- `lib/ai/persistence.ts` (`getGenerationKpis` returns 4
  metrics instead of 1)
- `components/audit-ai/ai-generations-kpi-cards.tsx`
- `components/audit-ai/ai-generations-daily-chart.tsx` (new)

**Target phase.** Phase 11 polish (once real costs flow in).

## ai-stubs-shim-retirement

**Problem.** After Commit 24, the 4 original AI stub files are
re-export shims:

  - `lib/ai/compliance-stub.ts` — body still hosts the keyword
    heuristic; re-exported as `complianceHint` (sync) and
    consumed by `mock-bodies/compliance.ts`.
  - `lib/ai/caption-stub.ts` — body hosts the FNV1a bucket
    logic; consumed by `mock-bodies/caption.ts`.
  - `lib/ai/reviews-stub.ts` — body hosts the variant table;
    consumed by `mock-bodies/review-response.ts`.
  - `lib/inbox/detect-language.ts` — body hosts the stopword
    classifier; re-exported as the sync render-path entry
    (REGLA BLACKNEL AI-FEEDBACK PATTERN) AND consumed by
    `mock-bodies/language-detect.ts`.

Every PRODUCTION caller now imports through `lib/ai/skills/*`
or (for sync render paths) through the explicit hint name
(`complianceHint`, `detectLanguage`). The stub files exist
mostly because their bodies are still the source of truth for
the keyword/heuristic logic.

**Resolution criteria.** When the Phase-11 real adapter lands
and replaces the mock-body content, evaluate three paths:

  (a) **Delete the 4 stub files outright.** Move the
      synchronous keyword bodies into either `mock-bodies/`
      or dedicated `lib/ai/heuristics/` modules. Update
      every test that still imports from the stub paths.
      Break-change for any out-of-tree consumer. *Cleanest.*

  (b) **Mark @deprecated on each export.** Lets callers
      migrate at their own pace; the deprecation surfaces
      via the TS LSP. Phase 12 closes the door.

  (c) **Keep indefinitely as BC.** Lowest risk, highest
      tech-debt cost.

**Recommendation.** **(a)** in Phase 12 polish, alongside the
other breaking refactors (`composer-edit-modal-post-kind`,
`composer-readonly-bypass`, etc.). Single PR, single
deprecation cycle.

**Affected files.**

- `lib/ai/compliance-stub.ts` (delete)
- `lib/ai/caption-stub.ts` (delete)
- `lib/ai/reviews-stub.ts` (delete)
- `lib/inbox/detect-language.ts` (delete OR move sync body
  into `lib/ai/heuristics/language.ts`)
- `lib/ai/compliance-hint.ts` (move body here)
- `lib/ai/mock-bodies/*.ts` (inline the moved heuristic
  bodies)
- Every test under `tests/unit/` and `tests/integration/`
  that imports from the stub paths.

**Target phase.** Phase 12 (polish).

## turbopack-builds-webpack-fallback-applied

**Problem.** `pnpm build` (Next.js 16.2.6 with Turbopack) on
Windows occasionally crashes with exit code `3221225477` —
`STATUS_ACCESS_VIOLATION` (0xC0000005). Observed during the
Commit 31 audit (`6e9141d`): first invocation crashed before
emitting any route output; immediate retry produced a clean
build with full route tree. `pnpm verify` (lint + typecheck +
vitest) is unaffected — the flake is isolated to Turbopack's
production-build path on Windows.

**Why.** Likely a known transient inside Turbopack's native
addon on Windows; the access violation comes from outside V8
(otherwise we'd see a JS stack). No code change repros it;
no code change fixes it. Not a regression — the flake landed
quietly when we moved to Turbopack-by-default in an earlier
Next minor.

**Resolution criteria.** Revisit if either:

1. The flake starts repeating in eventual CI (Phase 11+),
   especially blocking PRs on retry-once. At that point,
   options are:
   - Pin Turbopack to a known-good patch in `package.json`
     overrides.
   - Fall back to webpack for the build step only
     (`next build --no-turbo`) while keeping Turbopack for
     dev (HMR is the bigger Turbopack win anyway).
   - File upstream with a minimal repro.
2. We hit the same access-violation pattern in another
   Next.js subsystem (proxy/middleware, dev server) — would
   suggest a deeper Node-on-Windows issue worth investigating
   before Phase 11 cutover.

**Affected files.** `package.json` (the `build` script).
`doc/PATTERNS.md` for the bundler split documentation. This
anchor exists so future Turbopack regressions can reference
`TODO.md#turbopack-builds-webpack-fallback-applied` instead of
relitigating diagnosis.

**Status — ESCALATED applied (Phase 10 / Commit 36b first step).**
The flake recurred 8+ times in a row during the C36a build
verification with materially different errors per retry:

- `STATUS_ACCESS_VIOLATION 3221225477` (4×)
- SWC parser `assertion failed: span.lo >= ...` (1×)
- `memory allocation of 442746541700 bytes failed` (442GB OOM
  Rust panic) (1×)
- `TurbopackInternalError: Parenthesized expression cannot be
  empty` (1×)
- CSS module loader failures (1×)

Webpack fallback (`next build --webpack`) succeeds cleanly on
the first try. Turbopack on the Blacknel Windows dev env is
materially unstable at our codebase size.

**Action taken (C36b first step):**

1. `package.json` → `"build": "next build --webpack"` (was
   `next build`). `"dev": "next dev --turbopack"` unchanged —
   HMR is the main Turbopack win and dev does NOT show the
   build-time crashes.
2. `doc/PATTERNS.md` adds a `## Build configuration` section
   that documents the split and the re-evaluation criteria.
3. This anchor renamed from
   `turbopack-windows-segfault-flake` →
   `turbopack-builds-webpack-fallback-applied` to reflect
   that mitigation is now live, not pending.

**Re-evaluate when:**

- Next.js / Turbopack ships a major Windows stability fix
  (track upstream; Next 17.x candidate).
- Move to Linux CI runners (the Windows-specific failure modes
  may not reproduce there → could re-add a `build:turbopack`
  variant for CI).

**Target phase.** Phase 11 (Turbopack 17.x maturation). Anchor
stays open as a tracker, no active work today.

## nps-analytics-sparkline

**Problem.** D-32-8 deferred. The `/nps` Analytics tab and
`/nps/surveys/[id]` detail today render a static "Trend rolling
90d sparkline aterriza en Fase 10" placeholder. Functional KPI
cards exist; what's missing is the time-series visualization.

**Why deferred.** Sparklines aren't critical for the demo. The
KPI bucket math is correct (verified in
`tests/unit/nps-aggregate.test.ts`); the placeholder is honest
about what's coming.

**Resolution criteria.** Phase 10 — add a tiny inline SVG
helper (`<Sparkline points={[...]} />`) that takes a 90-day
buckets array and renders a single-color path. Do NOT pull a
chart library; keep email-compatible if the same component
ends up in `lib/scheduled-reports/report-builder.ts`.

**Target phase.** Phase 10.

## competitor-detail-trend-sparkline

**Problem.** Same shape as `nps-analytics-sparkline`. The
`/competitors/[id]` page renders a coarse 30-day bar cluster
inline today. Functional but unpolished.

**Resolution criteria.** Reuse the Phase-10 `<Sparkline />`
helper from `nps-analytics-sparkline`.

**Target phase.** Phase 10.

## listening-mention-detail-page

**Problem.** `/listening` lists mentions but there's no detail
page per mention. The natural symmetry with
`/nps/surveys/[id]` and `/competitors/[id]` would be a
`/listening/mentions/[id]` page showing the full mention body,
author profile, sentiment + confidence breakdown, and a linked
inbox thread if the mention was promoted.

**Resolution criteria.** Phase 10 page following
`doc/PATTERNS.md#detail-page-template`. Reuse `MentionCard`
content + add an author-profile sidebar.

**Target phase.** Phase 10.

## whatsapp-meta-real

**Problem.** `lib/connectors/whatsapp/templates-mock.ts`
auto-approves templates synchronously. Real Meta WABA API has
async approval (minutes → hours) via webhook.

**Resolution criteria.** Phase 11 swap. Add a real API client
behind the same interface; template approval state flips via
webhook → cron poll → status update. Tests stay green because
the mock interface is the contract.

**Target phase.** Phase 11.

## listening-brand24

**Problem.** `lib/connectors/listening/mock.ts` produces
deterministic mock mentions. Phase 11 swap candidates:
Brand24, Mention.com, Google Alerts (RSS fallback).

**Resolution criteria.** Same shape as `whatsapp-meta-real` —
swap the connector body, keep the `ListeningMockMention`
contract stable so `lib/listening/persist.ts` (AI sentiment
+ intent pipeline) doesn't change.

**Target phase.** Phase 11.

## competitors-brand24-similarweb

**Problem.** `lib/connectors/competitors/mock.ts` →
Brand24/SimilarWeb. Same shape as `listening-brand24`.

**Target phase.** Phase 11.

## scheduled-reports-resend

**Problem.** `lib/emails/send.ts` pushes to the dev outbox.
Phase 11 swaps the body to call Resend with both the `text`
and `html` fields (already lined up per R-34-2).

**Resolution criteria.** Single-file swap in
`lib/emails/send.ts`; 0 call sites change. Add Resend API
key handling in `lib/env.ts`.

**Target phase.** Phase 11.

## scheduled-reports-cron-5

**Problem.** `lib/scheduled-reports/schedule.ts` accepts only
weekly (`<dow> HH:MM`) and monthly (`<1-28> HH:MM`) schedule
expressions. The `custom` kind is documented as "weekly or
monthly form" — a real cron-5 parser is deferred.

**Resolution criteria.** Phase 11 with Inngest swap — Inngest's
own scheduling primitives replace the probe-based next-run
computer. Custom kind accepts standard cron-5.

**Target phase.** Phase 11.

## dev-outbox-html-preview-ui

**Problem.** The dev outbox now stores `html` (R-34-2) but
there's no UI to preview rendered HTML emails. Useful for
debugging scheduled-reports output without opening Postgres
or reading raw HTML in logs.

**Resolution criteria.** `/settings/dev-outbox` page (or
`/dev/outbox`) listing captured emails with an iframe
sandboxed HTML preview.

**Target phase.** Phase 10 or 11 — whichever lands `/settings`
expansion first.

## rbac-rls-dynamic-policies-supabase-auth

**Problem.** Phase 10 / Commit 36a lands enforcement híbrido
(c): TS layer estándar (144 callers) + `app_permission_check()`
DB function para las 10 critical actions documentadas en
`doc/PATTERNS.md#critical-actions-dual-ts--db-enforcement`. Esto
es defendible en security review enterprise pero NO es
defense-in-depth full — el resto del codebase sigue siendo
TS-only enforcement.

**Why deferred.** RLS dynamic policies cross-table requieren
`set_config('app.current_user_role', …)` y `app.current_custom_
role_id` en cada `dbAs()`, más reescritura de ~25 RLS policies
existentes. Demasiado coupling con el código actual; mejor con
Supabase Auth real cuando el patrón de sesión cambia anyway.

**Resolution criteria.** Phase 11 después del cutover Supabase
Auth:

1. Setear `app.current_user_role` + `app.current_custom_role_id`
   en cada `dbAs()` transaction (junto con `app.current_org_id`
   y `app.current_user_id` que ya están).
2. Promover `app_permission_check()` lógica a RLS policies para
   tablas críticas (PRIMERO):
   - `posts` (delete + publish gated)
   - `subscriptions` / `plans` (billing gated)
   - `audit_events` (read gated)
   - `custom_roles` (mutations gated)
3. Resto de tablas se quedan con tenant isolation actual (RLS
   sólo por `app.current_org_id`).
4. Tests `live.test.ts` deben cubrir privilege escalation contra
   RLS bypass (rol viewer no puede UPDATE posts via SQL directo
   aunque tenga `tenant` match).
5. Evaluar mover `app_*` functions a schema dedicado
   `blacknel_internal` (D-36a-11 future direction).

**Target phase.** Phase 11.

## rbac-permission-check-perf-budget

**Problem.** `assertPermissionInDb()` (Phase 10 / Commit 36a)
invoca `app_permission_check()` SQL function — 1 round-trip DB
por critical action por request. Cada query interna es PK
lookup sub-ms en pglite/local; sin medir contra Postgres real
bajo carga.

**Why deferred.** Phase 10 no tiene carga real. Phase 11 con
Supabase Auth + Vercel Functions tendrá perfiles latency reales
para medir.

**Resolution criteria.** Phase 11:

1. Medir **p95 de `assertPermissionInDb()`** bajo carga real
   (load test ~1k req/s, mix de roles default + custom).
2. Si p95 > **10ms** → implementar **LRU cache** dentro de
   `assertPermissionInDb`:
   - Key: `(userId, orgId, permission)`.
   - TTL: 5 min.
   - Invalidación on mutation events:
     `custom_role.{created,updated,archived,assigned}` +
     `organization_members.role.changed`.
3. Si p95 > **50ms** → re-evaluar SQL function vs full RLS
   dynamic policies (acelera el anchor
   `rbac-rls-dynamic-policies-supabase-auth`).
4. Si p95 < 10ms → cero acción, queda como está.

Tests live.test.ts pueden simular load con un loop de 1000
checks contra DB real para sanity baseline.

**Target phase.** Phase 11.

## yelp-fusion-real

**Problem.** El connector `lib/connectors/yelp/` es stub Phase 10:
`MockConnector` declarando capability `read_reviews` + el seed
`seed-enterprise-networks.ts` puebla rows deterministas. Yelp
Fusion API es **read-only** (no reply), 5000 calls/día tier
gratuito.

**Why deferred.** Master-prompt rule: CERO APIs externas en
Fases 1-10. Mocks SON producto hasta Fase 11.

**Resolution criteria.** Phase 11:

1. Implementar `YelpFusionClient` con OAuth client_credentials
   + rate limit guard (tracker que respete `X-RateLimit-Remaining`).
2. Mapear `business/reviews` → `reviews` schema (Yelp expone
   solo 3 reviews/business máximo via API; documentar
   limitación en `/integrations` connector tile como `notes`).
3. Mapear `elite_reviewer` (Yelp lo expone via author profile
   detail) → `platform_specific.elite_reviewer`. Si el detail
   call cuesta otra request, hacer en batch off-cycle.
4. Reply capability sigue OFF: Fusion API no soporta posting
   reviews. La UI ya lo refleja vía `canReply = false`.
5. Retirar `BLACKNEL_SEED_ENTERPRISE_NETWORKS` cuando demo
   tenants ya tengan rows reales.

**Target phase.** Phase 11.

## tripadvisor-business-real

**Problem.** Connector `lib/connectors/tripadvisor/` es stub
Phase 10. TripAdvisor Content API (B2B) requiere partner
agreement + per-property API key.

**Why deferred.** Onboarding TripAdvisor partner es proceso
contractual de semanas. No bloquea demo Phase 10.

**Resolution criteria.** Phase 11:

1. Solicitar partner access (TripAdvisor Business).
2. Implementar `TripAdvisorClient` con per-property auth.
3. Mapear `category_ratings` + `traveler_choice` → jsonb
   `platform_specific` (mantener render-only rule).
4. `dispute_review` capability requiere flujo manual via
   TripAdvisor Management Center — surface link, no auto.

**Target phase.** Phase 11.

## trustpilot-business-real

**Problem.** Connector `lib/connectors/trustpilot/` es stub
Phase 10. Trustpilot Business API tiene 3 tiers (Free / Plus /
Premium); algunas capabilities sólo van en Plus+.

**Why deferred.** Misma regla: CERO APIs externas en Phases
1-10.

**Resolution criteria.** Phase 11:

1. Implementar `TrustpilotClient` con OAuth2 + business unit
   scoping.
2. Mapear `verified_buyer` + `invitation_based` → jsonb
   `platform_specific`.
3. `send_review_request` capability ya declarada — cablear
   `/reviews/requests` para hablar Trustpilot Invitation API.
4. Surface tier requirements en `/integrations` tile (notes
   field): "Send-request requiere Trustpilot Plus o superior".

**Target phase.** Phase 11.

## bbb-complaint-model-revisit-phase-11

**Problem.** BBB **no es review-based** — son consumer
complaints con lifecycle (pending → assigned → resolved →
closed). Phase 10 / Commit 38 hace **force-fit**:

- `reviews.rating` queda con CHECK BETWEEN 1 AND 5; BBB rows
  almacenan `rating = 1` sentinel + UI oculta stars cuando
  `platform === 'bbb'`.
- Toda la información lifecycle vive en
  `platform_specific` jsonb (`complaint_status`,
  `complaint_type`, `case_id`, `resolution_summary`,
  `filed_at`).
- `<BBBComplaintCard>` reemplaza el row layout entero —
  red left border, FileWarning icon, status pill desde
  complaint_status (no review status).

**Why deferred.** Reorganizar el modelo de datos (nullable
rating, tabla `complaints` separada, o promoción de campos
jsonb → typed columns) tendría impacto cross-fase. Phase 10
prioriza shipping coherent UX over schema purity.

**Resolution criteria.** Phase 11. Elegir UNA opción:

**Opción A** — `rating` nullable. ALTER reviews + actualizar
CHECK a `(rating IS NULL OR rating BETWEEN 1 AND 5)`. Update
seed + UI para no asumir rating. **Pros:** minimal diff.
**Contras:** semántica weird (reviews sin rating).

**Opción B** — `complaints` table separada con FK a brand +
location. Mover BBB rows + retirar `platform_specific`
complaint fields. Migration de los seeded rows. **Pros:**
modelo limpio; querying complaints != reviews. **Contras:**
duplica /reviews list logic (Union query? Tabbed view?).

**Opción C** — Promote `complaint_status` + `case_id` a
typed columns nullable en `reviews`. Híbrido entre A y B.
**Pros:** querying por complaint_status disponible (filtros
de "complaints pendientes"). **Contras:** sigue mezclando
complaints con reviews.

Decisión final pendiente. Reabrir al iniciar Phase 11.

**Target phase.** Phase 11.

## custom-report-pdf-export-phase-11

**Problem.** Phase 10 / Commit 39 ships
`exportCustomReportHtmlAction` as a stub: returns sanitized HTML
of the rendered widget payloads (D-39-8 a). PDF generation
deferred.

**Why deferred.** PDF dependencies (puppeteer / playwright /
jsPDF) add ~50-100MB to the deploy image. Phase 11 cutover
already brings Vercel Functions + bigger deployable surface;
PDF gen lands alongside.

**Resolution criteria.** Phase 11:

1. Choose engine — recommended **`@vercel/og` for chart-heavy
   single-page** OR **playwright** for full multi-page reports.
2. Wire `exportCustomReportPdfAction` that calls a Vercel
   Function (or Vercel Sandbox) to render the same HTML the
   stub produces today + return a PDF blob.
3. Stream PDF via Server Action streaming response.
4. Audit `custom_report.exported` with format=`pdf`.
5. Retire `exportCustomReportHtmlAction` (or keep as
   fallback for print-from-browser).

**Target phase.** Phase 11.

## custom-report-realtime-refresh-phase-12

**Problem.** Phase 10 uses 60s LRU cache (D-39-3 b) — fine for
demo + initial rollout, NOT for "realtime" dashboards where
exec viewers want sub-minute freshness.

**Why deferred.** Realtime requires either polling (wasteful) or
WebSocket infra (Phase 12+ when we have actual operational load
justifying it).

**Resolution criteria.** Phase 12+:

1. Add `realtimeRefresh: boolean` to `custom_reports.layout` jsonb
   (still render-only — flag triggers client behavior, never
   query).
2. Wire Server-Sent Events or WebSocket via Vercel Functions
   streaming. Each connected client receives invalidation
   notifications when underlying data changes.
3. Per-widget granular refresh (data source-driven) instead of
   full report re-render.

**Target phase.** Phase 12+.

## custom-report-builder-dnd-kit-phase-12

**Problem.** Phase 10 / Commit 39 ships **static-position
builder** (numeric position inputs + add/remove/move buttons)
instead of the spec'd DnD-kit drag-drop interaction. Data
model + Server Actions + persistence all support drag-drop —
only the visual interaction is deferred.

**Why deferred.** DnD-kit adds ~35KB gzipped. Bundle budget
review pending. Phase 10 priority was shipping the full data
layer + actions + view/edit pages end-to-end with templates
and seed.

**Resolution criteria.** Phase 12 polish:

1. Add `@dnd-kit/core` + `@dnd-kit/sortable` deps.
2. **Dynamic import** inside `builder-canvas.tsx` so DnD-kit
   loads only on `/reports/custom/[id]/edit` route, not on
   view path.
3. Replace `<PositionInput>` numeric controls with drag-drop
   handles + sortable grid.
4. Keyboard a11y — DnD-kit handles via `@dnd-kit/sortable`
   keyboard sensor. Manual QA on the rúbrica step.
5. Auto-save throttled to 1 save per 500ms (no per-pixel-move
   spam to Server Action).

**Target phase.** Phase 12 polish.

## recharts-evaluation-phase-12-polish

**Problem.** Phase 8 / Commit 27 decided vanilla SVG over
recharts (decisión Fase 8). Phase 10 / Commit 39 inherited and
shipped sparkline + distribution_chart as vanilla SVG.

When Phase 12 polish revisits the whole charts surface (custom
reports + Reports tabs + ads timeline + competitor trends +
listening trend in one pass), revisit:

**Resolution criteria.** Phase 12:

1. Audit current vanilla SVG implementations across the
   codebase. Count LOC of duplicated chart logic.
2. If duplication > ~500 LOC OR if Phase 12 introduces new
   chart kinds (heatmap, scatter, multi-axis) → evaluate
   recharts. Otherwise stay vanilla.
3. If migrating: tree-shake aggressively, keep `recharts`
   import dynamic for edit views only.

**Target phase.** Phase 12.

## phase-11-listening-vendor-decision

**Problem.** C49 (Listening cutover) requires a vendor — Brand24,
Mention.com, Google Alerts (DIY) o solución custom. Decision
deferida hasta tener trials comparados.

**Why deferred.** Vendor lock-in con costo de migración alto.
Decisión apurada = años pagando por suite subóptima. Trial
adecuado lleva 2-3 semanas.

**Resolution criteria.** Antes de C49:

1. Trial 14 días de Brand24 ($99/mo Mid plan).
2. Trial 14 días de Mention.com ($41/mo Solo plan).
3. Evaluar DIY (Google Alerts via Apps Script + RSS parsing).
4. Documento comparativo en `doc/phase-11/listening-vendor-comparison.md`:
   - Calidad sentiment classification (muestra 50 mentions reales).
   - Idiomas soportados (mínimo ES + EN + PT).
   - Rate limits + cost per workspace.
   - Export format (CSV / JSON / API webhook).
   - Vendor switch cost estimado (cómo migramos si después
     queremos cambiar).
5. Decisión final: ✅ vendor seleccionado + razones documentadas.

**Target phase.** Phase 11, pre-C49.

## phase-11-competitors-vendor-decision

**Problem.** C49 (Competitors cutover) requires vendor — SimilarWeb,
Brand24, custom scrape. Mismo problema que listening.

**Why deferred.** Idem listening.

**Resolution criteria.** Antes de C49:

1. Trial 14 días de SimilarWeb ($200+/mo Starter).
2. Re-usar trial Brand24 del listening (algunos planes incluyen
   competitor tracking).
3. Evaluar scraping custom (revisar TOS de cada platform —
   blocker legal probable).
4. Documento `doc/phase-11/competitors-vendor-comparison.md`:
   - Reach metrics methodology.
   - Share-of-voice calculation transparency.
   - Refresh cadence (daily / weekly / monthly).
   - Geographic coverage (LATAM focus matters).
   - Cost per competitor tracked.
5. Decisión final: ✅ vendor seleccionado + razones documentadas.

**Target phase.** Phase 11, pre-C49.

## kill-switch-two-person-rule-when-team-grows

**Problem.** `doc/runbooks/kill-switch.md` Phase 11 / Commit 40
documenta procedure solo-operator (Carlos). Cuando crezca equipo
a ≥2 personas, debe migrar a 2-person rule (1 propone flip, 1
confirma en Slack ANTES del flip).

**Why deferred.** Carlos solo hoy. Procedure 2-person requiere
canal Slack + colaborador async. No tiene sentido implementar
antes de tener 2do operador.

**Resolution criteria.** Cuando hire 2nd engineer:

1. Update `doc/runbooks/kill-switch.md` con 2-person procedure
   reemplazando "Solo-operator procedure".
2. Setup canal Slack `#blacknel-ops` con notificaciones.
3. Dry-run del procedure con un kill switch flip controlado en
   staging.
4. Documentar en CHANGELOG cuándo se cambió la procedure.

**Target phase.** N/A — gated por hiring, no por phase.

## avvo-legal-tos-review

**Problem.** Connector `lib/connectors/avvo/` es stub Phase
10. Avvo no expone API pública oficial. Scrape via partner
sería camino, pero TOS de Avvo prohíbe scraping.

**Why deferred.** Requiere review legal + posible partnership
agreement con Avvo Pro tier. No es decisión técnica.

**Resolution criteria.** Phase 11:

1. Confirmar via legal counsel: ¿Avvo Pro tier expone API
   privada? ¿O sigue siendo scraping prohibido?
2. Si SÍ API privada: implementar cliente, mapear
   `attorney_response_count` + `case_type` →
   `platform_specific`. Surface Avvo Pro requirement en
   `/integrations` connector tile.
3. Si sigue prohibido: convertir connector en **CSV upload**
   manual (mismo patrón que BBB Phase 11). Bot del usuario
   sube CSV mensual export de Avvo dashboard.
4. Documentar la decisión en `doc/PATTERNS.md` para que
   pattern de "CSV upload connectors" quede explícito si
   adoptamos Opción CSV.

**Target phase.** Phase 11.
