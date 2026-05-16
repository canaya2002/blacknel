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

Until then, the `'simple'` tsvector index is good enough for inbox
search at Phase-4 volumes.

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

Affected files:

- `app/(app)/approvals/actions.ts` — 4 actions (approve, approveWithEdits,
  reject, escalate).
- `lib/inbox/send-reply.ts` — 3 audit call sites (sent, blocked, routed).
- Possibly `lib/db/migrations/0006_audit_authenticated_grant.sql` (new).

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
