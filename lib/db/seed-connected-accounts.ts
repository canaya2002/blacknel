import 'server-only';

import { getCapabilities } from '../connectors/registry';
import type { PlatformCode } from '../connectors/base';

import { connectedAccounts, connectorSyncRuns } from './schema';
import { SEED_IDS } from './seed';

import type { AnyPgTx } from './client';

/**
 * Demo `connected_accounts` + `connector_sync_runs` seed. Promoted
 * from `scripts/dev-checks/seed-connected-accounts.ts` into the
 * canonical seed pipeline (Commit closing Phase 5) so a fresh
 * `pnpm db:seed` / `pnpm dev` leaves /integrations populated.
 *
 * # 8 accounts across the 2 demo brands
 *
 *   La Trattoria (5):    facebook · instagram · gbp · whatsapp · tiktok
 *   Clínica Solis (3):   facebook · instagram · gbp
 *
 * # Status distribution (matches the operator's spec)
 *
 *   - 6 connected
 *   - 1 expired (Clínica Solis · Instagram)
 *   - 1 error    (La Trattoria · WhatsApp)
 *
 * # Capabilities
 *
 * Pulled live from the connector registry so the seeded snapshot
 * always matches what /integrations would render at runtime. If we
 * ever extend a connector's capability set, the seed stays correct
 * without manual sync.
 *
 * # Idempotency
 *
 * `ON CONFLICT (org, platform, external_account_id) DO NOTHING` —
 * re-running the seed on an existing dev DB is a no-op. Sync runs
 * are NOT deduped because the unique constraint there is the row
 * id, but the seed picks deterministic ids and uses the same
 * `ON CONFLICT DO NOTHING` semantics there too.
 *
 * Gated by `env.BLACKNEL_SEED_CONNECTED`. Integration tests pass
 * `BLACKNEL_SEED_CONNECTED=false` so they keep their seeded worlds
 * fast + minimal — Phase-3 connector tests stand up exactly the
 * rows they assert against.
 */

const ORG = SEED_IDS.org.demo;

interface DemoAccount {
  /** Deterministic UUID. */
  readonly id: string;
  readonly brandId: string;
  readonly locationId: string | null;
  readonly platform: PlatformCode;
  readonly externalAccountId: string;
  readonly displayName: string;
  readonly handle: string;
  readonly status: 'connected' | 'expired' | 'error';
  readonly errorMessage: string | null;
}

const ACCOUNTS: ReadonlyArray<DemoAccount> = [
  // ── La Trattoria — 5 accounts ──────────────────────────────────
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
    brandId: SEED_IDS.brand.trattoria,
    locationId: SEED_IDS.location.trattoriaDowntown,
    platform: 'facebook',
    externalAccountId: 'fb-demo-trattoria',
    displayName: 'La Trattoria FB',
    handle: '@latrattoria',
    status: 'connected',
    errorMessage: null,
  },
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002',
    brandId: SEED_IDS.brand.trattoria,
    locationId: SEED_IDS.location.trattoriaDowntown,
    platform: 'instagram',
    externalAccountId: 'ig-demo-trattoria',
    displayName: 'La Trattoria IG',
    handle: '@latrattoria',
    status: 'connected',
    errorMessage: null,
  },
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003',
    brandId: SEED_IDS.brand.trattoria,
    locationId: SEED_IDS.location.trattoriaDowntown,
    platform: 'gbp',
    externalAccountId: 'gbp-demo-trattoria',
    displayName: 'La Trattoria GBP',
    handle: 'La Trattoria — Downtown',
    status: 'connected',
    errorMessage: null,
  },
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000004',
    brandId: SEED_IDS.brand.trattoria,
    locationId: SEED_IDS.location.trattoriaDowntown,
    platform: 'whatsapp',
    externalAccountId: 'wa-demo-trattoria',
    displayName: 'La Trattoria WhatsApp Business',
    handle: '+52 55 1234 5678',
    status: 'error',
    errorMessage: 'Plataforma respondió 5xx en la última sync.',
  },
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000005',
    brandId: SEED_IDS.brand.trattoria,
    locationId: SEED_IDS.location.trattoriaNorth,
    platform: 'tiktok',
    externalAccountId: 'tk-demo-trattoria',
    displayName: 'La Trattoria TikTok',
    handle: '@latrattoria.mx',
    status: 'connected',
    errorMessage: null,
  },
  // ── Clínica Solis — 3 accounts ─────────────────────────────────
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000006',
    brandId: SEED_IDS.brand.clinica,
    locationId: SEED_IDS.location.clinicaCentral,
    platform: 'facebook',
    externalAccountId: 'fb-demo-clinica',
    displayName: 'Clínica Solis FB',
    handle: '@clinicasolis',
    status: 'connected',
    errorMessage: null,
  },
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000007',
    brandId: SEED_IDS.brand.clinica,
    locationId: SEED_IDS.location.clinicaCentral,
    platform: 'instagram',
    externalAccountId: 'ig-demo-clinica',
    displayName: 'Clínica Solis IG',
    handle: '@clinicasolis',
    status: 'expired',
    errorMessage: 'OAuth tokens expired 3 days ago.',
  },
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000008',
    brandId: SEED_IDS.brand.clinica,
    locationId: SEED_IDS.location.clinicaWest,
    platform: 'gbp',
    externalAccountId: 'gbp-demo-clinica',
    displayName: 'Clínica Solis GBP',
    handle: 'Clínica Solis — Poniente',
    status: 'connected',
    errorMessage: null,
  },
];

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export async function seedConnectedAccounts(tx: AnyPgTx): Promise<void> {
  const now = new Date();
  const accountRows = ACCOUNTS.map((a) => {
    // Capabilities pulled live from the registry so a connector
    // capability change auto-propagates to the seed.
    const caps = getCapabilities(a.platform);
    const lastSyncAt =
      a.status === 'connected'
        ? new Date(now.getTime() - 30 * 60 * 1000) // 30 min ago
        : a.status === 'expired'
          ? new Date(now.getTime() - 3 * DAY_MS) // 3 days ago
          : new Date(now.getTime() - 2 * HOUR_MS); // last attempt 2h ago
    return {
      id: a.id,
      organizationId: ORG,
      brandId: a.brandId,
      locationId: a.locationId,
      platform: a.platform,
      externalAccountId: a.externalAccountId,
      displayName: a.displayName,
      handle: a.handle,
      status: a.status,
      lastSyncAt,
      errorMessage: a.errorMessage,
      capabilities: caps.supported as ReadonlyArray<string>,
    };
  });

  await tx
    .insert(connectedAccounts)
    .values(accountRows)
    .onConflictDoNothing({
      target: [
        connectedAccounts.organizationId,
        connectedAccounts.platform,
        connectedAccounts.externalAccountId,
      ],
    });

  // 2 sync runs per account — a successful one ~2h ago and the
  // most recent attempt, whose status matches the account's status.
  // Deterministic ids keep the rows idempotent across re-runs.
  const runRows = ACCOUNTS.flatMap((a, idx) => {
    // 12 hex chars in the last UUID segment: prefix `ccd` (3) + idx
    // padded to 8 (zero-padded) + per-run suffix (1 char appended
    // below) = 12. Pre-Phase-12 token-format chore (TODO.md history
    // entries flagged similar UUID-length traps).
    const baseId = `bbbbbbbb-bbbb-4bbb-8bbb-ccd${String(idx).padStart(8, '0')}`;
    return [
      {
        id: `${baseId}1`,
        connectedAccountId: a.id,
        status: 'success' as const,
        startedAt: new Date(now.getTime() - 2 * HOUR_MS),
        finishedAt: new Date(now.getTime() - 2 * HOUR_MS + 5 * 1000),
        itemsSynced: 12,
        errorMessage: null,
      },
      {
        id: `${baseId}2`,
        connectedAccountId: a.id,
        status:
          a.status === 'error'
            ? ('failed' as const)
            : a.status === 'expired'
              ? ('failed' as const)
              : ('success' as const),
        startedAt: new Date(now.getTime() - 30 * 60 * 1000),
        finishedAt: new Date(now.getTime() - 30 * 60 * 1000 + 3 * 1000),
        itemsSynced: a.status === 'connected' ? 7 : 0,
        errorMessage:
          a.status === 'error'
            ? 'Mock 503 from upstream platform.'
            : a.status === 'expired'
              ? 'OAuth refresh failed: token expired.'
              : null,
      },
    ];
  });

  await tx
    .insert(connectorSyncRuns)
    .values(runRows)
    .onConflictDoNothing({ target: connectorSyncRuns.id });
}
