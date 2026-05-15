# TODO

Cross-cutting follow-ups not scoped to a specific phase. Each entry has an
anchor (the `## name` slug) that source code references via
`Tracking: TODO.md#<anchor>`. When a remote GitHub repo is wired up, these
entries graduate to issues and the references switch to `Tracking: #123`.

## dbas-type

`lib/db/client.ts` types the Drizzle PG database and transaction loosely as
`any` (`AnyPgDb`, `AnyPgTx`).

The two Drizzle PG adapters Blacknel uses produce structurally compatible
runtime objects but slightly different TypeScript generics:

- `drizzle-orm/postgres-js` — production code path via `getRawDb()`.
- `drizzle-orm/pglite` — integration tests via `tests/helpers/test-db.ts`.

Until Drizzle ships a shared `PgDatabase` / `PgTransaction` base (or we drop
one of the two adapters), the wrappers stay loosely typed. Callers narrow
results by passing a schema `$inferSelect` type as the generic on `runAs<T>`
/ `runAdmin<T>` — see the RLS test for the pattern.

Revisit when either:

- Drizzle 0.40+ unifies adapter types, or
- We commit to a single runtime for tests (e.g., a docker-postgres
  testcontainer that lets us use `drizzle-orm/postgres-js` everywhere).

Acceptance: the `// eslint-disable-next-line @typescript-eslint/no-explicit-any`
and the matching `FIXME(blacknel)` comments in `lib/db/client.ts` are gone,
and `tx` in caller code autocompletes against the real Drizzle query builder.
