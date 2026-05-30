import { notFound } from 'next/navigation';
import { z } from 'zod';

import { AdsAlertsBanner } from '@/components/ads/ads-alerts-banner';
import { AdsAccountDailyTable } from '@/components/ads/ads-account-daily-table';
import { AdsAccountAlertsHistory } from '@/components/ads/ads-account-alerts-history';
import { AdsRowActions } from '@/components/ads/ads-row-actions';
import { Badge } from '@/components/ui/badge';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { Card, CardContent } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/server';
import { listAdsAlertsWithTx } from '@/lib/ads/alerts-queries';
import {
  getAdsAccountDetailWithTx,
  listAdsAccountDailyWithTx,
} from '@/lib/ads/queries';
import { dbAs } from '@/lib/db/client';
import { authorize, can } from '@/lib/permissions/can';

export const dynamic = 'force-dynamic';

const idSchema = z.string().uuid();

interface AdsAccountDetailPageProps {
  params: Promise<{ adsAccountId: string }>;
}

/**
 * /ads/[adsAccountId] — Phase 8 / Commit 30.
 *
 * Full-page drill-down (D-30-1). Reuses the account row query
 * from Commit 28 + the alerts list query from Commit 29
 * (extended with `adsAccountId` filter).
 *
 * **Three sections**:
 *
 *   1. Account header — platform, currency, status, brand,
 *      connected_at, last_sync_at.
 *   2. Spend timeline — last 30 days, one row per date. Table
 *      only, NO chart (Phase 9 polish).
 *   3. Alerts history — pending + accepted + dismissed, sorted
 *      via `sortBySeverityThenAge` (Ajuste 3 from Commit 29).
 *
 * **Breadcrumbs (Ajuste 1)** — `<Breadcrumbs />` from
 * `components/ui/breadcrumbs.tsx`. Trail: `Ads · {accountName}`.
 * Note: the existing campaigns detail page uses an `<ArrowLeft />`
 * back-button instead of a breadcrumb trail — surfaced in the
 * Commit-30 close-out; we picked the user-specified breadcrumb
 * pattern here.
 */
export default async function AdsAccountDetailPage({
  params,
}: AdsAccountDetailPageProps): Promise<React.ReactElement> {
  const session = await requireUser();
  authorize(session.role, 'ads:read');

  const { adsAccountId } = await params;
  const parsed = idSchema.safeParse(adsAccountId);
  if (!parsed.success) notFound();

  const [account, daily, allAlerts, pendingAlerts] = await Promise.all([
    dbAs({ orgId: session.orgId, userId: session.userId }, (tx) =>
      getAdsAccountDetailWithTx(tx, session.orgId, adsAccountId),
    ),
    dbAs({ orgId: session.orgId, userId: session.userId }, (tx) =>
      listAdsAccountDailyWithTx(tx, session.orgId, adsAccountId),
    ),
    can(session.role, 'ads_alerts:read')
      ? dbAs({ orgId: session.orgId, userId: session.userId }, (tx) =>
          listAdsAlertsWithTx(tx, {
            orgId: session.orgId,
            userId: session.userId,
            adsAccountId,
            limit: 100,
          }),
        )
      : Promise.resolve([]),
    can(session.role, 'ads_alerts:read')
      ? dbAs({ orgId: session.orgId, userId: session.userId }, (tx) =>
          listAdsAlertsWithTx(tx, {
            orgId: session.orgId,
            userId: session.userId,
            adsAccountId,
            status: ['pending'],
            limit: 20,
          }),
        )
      : Promise.resolve([]),
  ]);

  if (!account) notFound();

  const canManage = can(session.role, 'ads:manage');
  const canDecideAlerts = can(session.role, 'ads_alerts:decide');
  const displayName = account.accountName ?? account.externalAccountId;

  return (
    <div className="flex flex-col">
      <header className="flex flex-col gap-3 border-b bg-card/30 px-6 py-4">
        <Breadcrumbs
          items={[
            { label: 'Ads', href: '/ads' },
            { label: displayName },
          ]}
        />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">
                {displayName}
              </h1>
              <Badge variant="outline" className="font-normal">
                {account.platform === 'google'
                  ? 'Google Ads'
                  : account.platform === 'tiktok'
                    ? 'TikTok Ads'
                    : 'Meta Ads'}
              </Badge>
              <StatusBadge status={account.status} />
            </div>
            <p className="text-sm text-muted-foreground">
              {account.brandName ? `${account.brandName} · ` : ''}
              {account.externalAccountId} · {account.currency} ·
              {' '}conectada el {account.connectedAt.toISOString().slice(0, 10)}
              {account.lastSyncAt
                ? ` · último sync ${account.lastSyncAt.toISOString().replace('T', ' ').slice(0, 16)}`
                : ' · sin sync aún'}
            </p>
          </div>
          {canManage && account.status === 'connected' ? (
            <AdsRowActions adsAccountId={account.id} />
          ) : null}
        </div>
      </header>

      <div className="flex flex-col gap-6 px-6 py-4">
        {pendingAlerts.length > 0 ? (
          <AdsAlertsBanner
            alerts={pendingAlerts}
            canDecide={canDecideAlerts}
          />
        ) : null}

        <section>
          <h2 className="mb-3 text-sm font-semibold">Spend últimos 30 días</h2>
          <AdsAccountDailyTable rows={daily} />
        </section>

        {can(session.role, 'ads_alerts:read') ? (
          <section>
            <h2 className="mb-3 text-sm font-semibold">Historial de alertas</h2>
            <AdsAccountAlertsHistory alerts={allAlerts} />
          </section>
        ) : null}
      </div>
    </div>
  );
}

function StatusBadge({
  status,
}: {
  status: 'connected' | 'disconnected' | 'error';
}): React.ReactElement {
  if (status === 'connected') {
    return <Badge className="bg-green-600 hover:bg-green-600">Conectada</Badge>;
  }
  if (status === 'error') {
    return <Badge variant="destructive">Error</Badge>;
  }
  return <Badge variant="secondary">Desconectada</Badge>;
}

void Card;
void CardContent;
