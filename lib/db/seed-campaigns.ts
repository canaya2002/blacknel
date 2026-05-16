import 'server-only';

import { campaigns } from './schema';
import { SEED_IDS } from './seed';

import type { AnyPgTx } from './client';

/**
 * Phase-6 / Commit-17 campaigns seed. 3 campaigns covering the
 * common-shape mix:
 *
 *   - Evergreen always-on (no end date)
 *   - Time-bounded promotion (current month)
 *   - Awareness push (next 30 days, future-dated)
 *
 * These are the containers the seed-posts module attaches `posts`
 * to. Idempotent: `ON CONFLICT DO NOTHING` on the deterministic id.
 */

const ORG = SEED_IDS.org.demo;
const NOW = new Date('2026-05-15T16:00:00Z').getTime();
const DAY = 24 * 60 * 60 * 1000;

export const SEED_CAMPAIGN_IDS = {
  evergreen: 'eeeeeeee-eeee-4eee-8eee-cc0000000001',
  promotion: 'eeeeeeee-eeee-4eee-8eee-cc0000000002',
  awareness: 'eeeeeeee-eeee-4eee-8eee-cc0000000003',
} as const;

export async function seedCampaigns(tx: AnyPgTx): Promise<void> {
  await tx
    .insert(campaigns)
    .values([
      {
        id: SEED_CAMPAIGN_IDS.evergreen,
        organizationId: ORG,
        brandId: SEED_IDS.brand.trattoria,
        name: 'Siempre Trattoria — always-on',
        goal: 'evergreen',
        status: 'active',
        startsAt: new Date(NOW - 180 * DAY),
        endsAt: null,
        ownerId: SEED_IDS.user.manager,
        budgetCents: null,
        metadata: { notes: 'Posts diarios, sin presupuesto pagado.' },
      },
      {
        id: SEED_CAMPAIGN_IDS.promotion,
        organizationId: ORG,
        brandId: SEED_IDS.brand.trattoria,
        name: 'Promo Mayo — Pasta del Día',
        goal: 'promotion',
        status: 'active',
        startsAt: new Date(NOW - 14 * DAY),
        endsAt: new Date(NOW + 7 * DAY),
        ownerId: SEED_IDS.user.admin1,
        budgetCents: 50_000, // $500 USD
        metadata: { audience: 'returning_customers' },
      },
      {
        id: SEED_CAMPAIGN_IDS.awareness,
        organizationId: ORG,
        brandId: SEED_IDS.brand.clinica,
        name: 'Clínica Solis — Awareness Q2',
        goal: 'awareness',
        status: 'active',
        startsAt: new Date(NOW),
        endsAt: new Date(NOW + 30 * DAY),
        ownerId: SEED_IDS.user.admin2,
        budgetCents: 120_000, // $1,200 USD
        metadata: { audience: 'new_patients' },
      },
    ])
    .onConflictDoNothing({ target: campaigns.id });
}
