/**
 * CHECK 6 helper — reset the demo-org connected_accounts table and seed
 * a larger pool (12 connected accounts on platforms allowed by the
 * Growth plan) so the dev-events tick has a meaningful sample to roll
 * forward.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';

const DATA_DIR = path.resolve(process.cwd(), '.blacknel/pglite-data');
const DEMO_ORG = '11111111-1111-4111-8111-111111111111';

const GROWTH_PLATFORMS = [
  ['facebook', ['read_comments', 'reply_comments', 'read_dms', 'send_dms', 'publish_post', 'schedule_post', 'read_insights']],
  ['instagram', ['read_comments', 'reply_comments', 'read_dms', 'send_dms', 'publish_post', 'schedule_post', 'read_insights']],
  ['gbp', ['read_reviews', 'reply_reviews', 'read_insights', 'send_review_request']],
  ['whatsapp', ['read_dms', 'send_dms', 'read_insights']],
  ['tiktok', ['read_comments', 'reply_comments', 'publish_post', 'schedule_post', 'read_insights']],
  ['linkedin', ['publish_post', 'schedule_post', 'read_insights']],
] as const;

async function main(): Promise<void> {
  const pg = new PGlite(DATA_DIR);
  await pg.waitReady;

  await pg.query(`DELETE FROM connector_sync_runs`);
  await pg.query(`DELETE FROM connected_accounts WHERE organization_id = $1`, [DEMO_ORG]);

  let n = 0;
  for (const [platform, caps] of GROWTH_PLATFORMS) {
    for (let i = 1; i <= 2; i++) {
      n++;
      const id = `bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12, '0')}`;
      await pg.query(
        `INSERT INTO connected_accounts
           (id, organization_id, platform, external_account_id, display_name, handle,
            status, capabilities, last_sync_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'connected', $7::jsonb, $8)`,
        [
          id,
          DEMO_ORG,
          platform,
          `${platform}-mock-${i}`,
          `Demo ${platform} #${i}`,
          `@blacknel-${platform}-${i}`,
          JSON.stringify(caps),
          new Date().toISOString(),
        ],
      );
    }
  }
  console.log(`Seeded ${n} connected accounts (all status=connected) for demo org.`);

  const r = await pg.query<{ status: string; n: number }>(
    `SELECT status, count(*)::int AS n FROM connected_accounts WHERE organization_id = $1 GROUP BY status`,
    [DEMO_ORG],
  );
  console.log('By status:', r.rows);
  await pg.close();
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
