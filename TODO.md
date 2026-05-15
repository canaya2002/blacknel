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
