import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit is used here only for schema introspection / diff checks
 * during development (`drizzle-kit check`, `drizzle-kit studio`). Migration
 * SQL files in `lib/db/migrations/` are hand-written, not generated, so
 * we can ship Postgres roles, RLS policies, and triggers alongside the
 * schema. The custom migration runner (`scripts/migrate.ts`) applies them.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './lib/db/schema/index.ts',
  out: './lib/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://placeholder/blacknel',
  },
  casing: 'snake_case',
  strict: true,
  verbose: true,
});
