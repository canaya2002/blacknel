# Dev checks

Repeatable HTTP smoke harness used to validate phase closures without spinning
up Playwright. None of these scripts ship in production paths; they exist to
manually exercise routes that integration tests can't (Server Components,
Server Action wiring, the dev runtime, mock events).

Run while the Next dev server is up (`pnpm dev`), except for the seed scripts
which need exclusive access to the pglite data dir.

| Script | Purpose |
| --- | --- |
| `seed-connected-accounts.ts` | Insert 4 demo connected accounts (connected / expired / error mix) directly into the pglite data dir. Stop the dev server first. |
| `reset-and-seed-many.ts` | Wipe + reseed 12 connected accounts on Growth-allowed platforms — for exercising the `BLACKNEL_MOCK_EVENTS` ticker on a larger sample. Stop dev server first. |
| `check-integrations-ui.ts` | Sign a dev session cookie and curl `/integrations` + a few detail pages. Asserts 16 tiles, 9 Upgrade buttons on Growth, Yelp shape, reconnect banners. |
| `check-mock-events.ts` | Run one tick of `maybeTickConnectorEvents()` via a page visit, then report the status-badge distribution and confirm reconnect banners on `expired`/`error` rows. |

Invoke them with `pnpm tsx scripts/dev-checks/<name>.ts`.
