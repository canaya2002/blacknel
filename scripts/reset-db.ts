#!/usr/bin/env tsx
/**
 * Drop every table the migration tooling owns and the `_migrations`
 * tracker itself. Intended for local dev when you want a clean slate.
 *
 *   pnpm db:reset       # drop + recreate via `pnpm db:migrate`
 *
 * REFUSES to run when `NODE_ENV=production`. Never deletes Supabase
 * Auth data (`auth.users`) — only the `public` schema's app tables.
 */
import postgres from 'postgres';

import { env } from '../lib/env';
import { log } from '../lib/log';

async function main(): Promise<void> {
  if (env.NODE_ENV === 'production') {
    log.error('db:reset refuses to run in production.');
    process.exit(1);
  }
  if (!env.DATABASE_URL) {
    log.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  const sql = postgres(env.DATABASE_URL, { max: 1, prepare: false });
  try {
    log.warn('db.reset.start — dropping app tables');
    await sql.unsafe(`
      DROP TABLE IF EXISTS public.audit_events CASCADE;
      DROP TABLE IF EXISTS public.usage_counters CASCADE;
      DROP TABLE IF EXISTS public.subscriptions CASCADE;
      DROP TABLE IF EXISTS public.locations CASCADE;
      DROP TABLE IF EXISTS public.brands CASCADE;
      DROP TABLE IF EXISTS public.brand_voices CASCADE;
      DROP TABLE IF EXISTS public.invitations CASCADE;
      DROP TABLE IF EXISTS public.organization_members CASCADE;
      DROP TABLE IF EXISTS public.organizations CASCADE;
      DROP TABLE IF EXISTS public.users CASCADE;
      DROP TABLE IF EXISTS public.plans CASCADE;
      DROP TABLE IF EXISTS public._migrations CASCADE;

      DROP TYPE IF EXISTS audit_actor_type CASCADE;
      DROP TYPE IF EXISTS location_status CASCADE;
      DROP TYPE IF EXISTS brand_status CASCADE;
      DROP TYPE IF EXISTS subscription_status CASCADE;
      DROP TYPE IF EXISTS plan_code CASCADE;
      DROP TYPE IF EXISTS member_status CASCADE;
      DROP TYPE IF EXISTS member_role CASCADE;
      DROP TYPE IF EXISTS organization_status CASCADE;

      DROP FUNCTION IF EXISTS public.touch_updated_at() CASCADE;
      DROP FUNCTION IF EXISTS public.handle_new_auth_user() CASCADE;
    `);
    log.info('db.reset.done. Now run `pnpm db:migrate` and `pnpm db:seed`.');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  log.error({ err }, 'db.reset.failed');
  process.exit(1);
});
