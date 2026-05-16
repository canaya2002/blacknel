/**
 * Phase 3 CHECK 5 helper — seed demo connected_accounts directly via
 * pglite, bypassing the Next-only `dev-runtime.ts` (which imports
 * `server-only`). Run while the dev server is stopped to avoid pglite
 * lock contention on the data dir.
 */
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';

const DATA_DIR = path.resolve(process.cwd(), '.blacknel/pglite-data');
const DEMO_ORG = '11111111-1111-4111-8111-111111111111';

interface Seed {
  id: string;
  platform: string;
  externalAccountId: string;
  displayName: string;
  handle: string;
  status: 'connected' | 'expired' | 'error';
  errorMessage: string | null;
  capabilities: ReadonlyArray<string>;
}

const SEEDS: Seed[] = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
    platform: 'facebook',
    externalAccountId: 'fb-demo-1',
    displayName: 'La Trattoria FB',
    handle: '@latrattoria',
    status: 'connected',
    errorMessage: null,
    capabilities: ['read_comments', 'reply_comments', 'read_dms', 'send_dms', 'publish_post', 'schedule_post', 'read_insights'],
  },
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002',
    platform: 'instagram',
    externalAccountId: 'ig-demo-1',
    displayName: 'La Trattoria IG',
    handle: '@latrattoria',
    status: 'connected',
    errorMessage: null,
    capabilities: ['read_comments', 'reply_comments', 'read_dms', 'send_dms', 'publish_post', 'schedule_post', 'read_insights'],
  },
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003',
    platform: 'gbp',
    externalAccountId: 'gbp-demo-1',
    displayName: 'Clínica Solis GBP',
    handle: 'Clínica Solis',
    status: 'expired',
    errorMessage: 'OAuth tokens expired 3 days ago.',
    capabilities: ['read_reviews', 'reply_reviews', 'read_insights', 'send_review_request'],
  },
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000004',
    platform: 'whatsapp',
    externalAccountId: 'wa-demo-1',
    displayName: 'Clínica WA Business',
    handle: '+52 55 1234 5678',
    status: 'error',
    errorMessage: 'Plataforma respondió 5xx en la última sync.',
    capabilities: ['read_dms', 'send_dms', 'read_insights'],
  },
];

async function main(): Promise<void> {
  const pg = new PGlite(DATA_DIR);
  await pg.waitReady;

  for (const s of SEEDS) {
    await pg.query(
      `INSERT INTO connected_accounts
        (id, organization_id, platform, external_account_id, display_name, handle,
         status, error_message, capabilities, last_sync_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
       ON CONFLICT (organization_id, platform, external_account_id) DO NOTHING`,
      [
        s.id,
        DEMO_ORG,
        s.platform,
        s.externalAccountId,
        s.displayName,
        s.handle,
        s.status,
        s.errorMessage,
        JSON.stringify(s.capabilities),
        new Date(s.status === 'connected' ? Date.now() : Date.now() - 3 * 86400e3).toISOString(),
      ],
    );

    // 2 sync runs per account.
    await pg.query(
      `INSERT INTO connector_sync_runs
        (connected_account_id, status, started_at, finished_at, items_synced, error_message)
       VALUES
        ($1, 'success', $2, $3, 12, NULL),
        ($1, $4, $5, $6, $7, $8)`,
      [
        s.id,
        new Date(Date.now() - 2 * 3600e3).toISOString(),
        new Date(Date.now() - 2 * 3600e3 + 5000).toISOString(),
        s.status === 'error' ? 'failed' : 'success',
        new Date(Date.now() - 30 * 60e3).toISOString(),
        new Date(Date.now() - 30 * 60e3 + 3000).toISOString(),
        s.status === 'error' ? 0 : 7,
        s.status === 'error' ? 'Mock 503' : null,
      ],
    );
  }

  const r = await pg.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM connected_accounts WHERE organization_id = $1`,
    [DEMO_ORG],
  );
  console.log('Connected accounts in demo org:', r.rows[0]?.n);

  const r2 = await pg.query<{ status: string; n: number }>(
    `SELECT status, count(*)::int AS n FROM connected_accounts WHERE organization_id = $1 GROUP BY status`,
    [DEMO_ORG],
  );
  console.log('By status:', r2.rows);

  await pg.close();
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
