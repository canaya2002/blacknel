import { PageHeader } from '@/components/common/page-header';
import { UpgradePrompt } from '@/components/common/upgrade-prompt';
import { AdsAccountsTable } from '@/components/ads/ads-accounts-table';
import { AdsConnectDialog } from '@/components/ads/ads-connect-dialog';
import { AdsOverviewCards } from '@/components/ads/ads-overview-cards';
import { requireUser } from '@/lib/auth/server';
import { dbAs } from '@/lib/db/client';
import { authorize, can } from '@/lib/permissions/can';
import { listBrandOptionsWithTx } from '@/lib/publish/picker-data';
import { getAdsOverviewWithTx, listAdsAccountsWithTx } from '@/lib/ads/queries';
import { getOrgPlanCode } from '@/lib/queries/plan';

export const dynamic = 'force-dynamic';

const PLAN_RANK = { standard: 0, growth: 1, enterprise: 2 } as const;

/**
 * /ads — Phase 8 / Commit 28.
 *
 * Read-only dashboard powered by `lib/ads/queries.ts` +
 * `lib/jobs/ads-sync.ts` (mock connectors). Per Ajuste 3:
 * **tabla simple, NO chart yet** — line charts land in Phase 9
 * polish once the producer has real cross-platform data.
 *
 * **Manual connect dialog** (D-28-3). Until OAuth lands at
 * Phase 11, admin+ enters `(platform, external_account_id,
 * currency)` by hand. The sync cron picks the row up on its
 * next tick.
 *
 * **Enterprise gate.** Ads Intelligence sits at the top of the
 * pricing matrix; standard/growth see the upgrade prompt.
 */
export default async function AdsPage(): Promise<React.ReactElement> {
  const session = await requireUser();
  authorize(session.role, 'ads:read');
  const plan = await getOrgPlanCode(session);
  const gated = PLAN_RANK[plan] < PLAN_RANK.enterprise;

  if (gated) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Ads Intelligence"
          description="Spend consolidado de Meta y Google con conversión a USD frozen-at-insert. Disponible en Enterprise."
        />
        <UpgradePrompt
          unlocksOn="enterprise"
          feature="Ads Intelligence"
          description="Conecta tus cuentas de Ads y consolida métricas, alertas y recomendaciones. Disponible en Enterprise."
        />
      </div>
    );
  }

  const [accounts, overview, brandOptions] = await Promise.all([
    dbAs({ orgId: session.orgId, userId: session.userId }, (tx) =>
      listAdsAccountsWithTx(tx, session.orgId),
    ),
    dbAs({ orgId: session.orgId, userId: session.userId }, (tx) =>
      getAdsOverviewWithTx(tx, session.orgId),
    ),
    dbAs({ orgId: session.orgId, userId: session.userId }, (tx) =>
      listBrandOptionsWithTx(tx, session.orgId),
    ),
  ]);

  const canManage = can(session.role, 'ads:manage');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Ads Intelligence"
        description="Métricas consolidadas de Meta y Google con conversión a USD. Re-sync 24h con ventana de 2 días para atribución tardía."
        actions={canManage ? <AdsConnectDialog brandOptions={brandOptions} /> : null}
      />

      <div className="px-6">
        <AdsOverviewCards overview={overview} />
      </div>

      <div className="px-6 pb-6">
        <AdsAccountsTable accounts={accounts} canManage={canManage} />
      </div>
    </div>
  );
}
