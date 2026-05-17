'use client';

import { Megaphone } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/common/empty-state';
import type { AdsAccountRow } from '@/lib/ads/queries';

import { AdsRowActions } from './ads-row-actions';

interface AdsAccountsTableProps {
  accounts: AdsAccountRow[];
  canManage: boolean;
}

/**
 * Simple table — NO chart (Ajuste 3). Phase 9 may add a sparkline
 * column once we have cross-platform comparison data worth
 * plotting.
 *
 * Spend column shows the USD-frozen 30d rollup. The native
 * currency is implicit via the badge under `accountName` so a
 * customer paying in MXN can sanity-check against their provider
 * dashboard.
 */
export function AdsAccountsTable({
  accounts,
  canManage,
}: AdsAccountsTableProps): React.ReactElement {
  if (accounts.length === 0) {
    return (
      <Card className="p-6">
        <EmptyState
          icon={Megaphone}
          title="No tenés cuentas de ads conectadas todavía"
          description={
            canManage
              ? "Usá 'Conectar cuenta' arriba para vincular Google Ads o Meta Ads. El cron sincronizará el spend de los últimos 2 días en el próximo tick."
              : 'Pedile a un admin que conecte una cuenta para empezar a ver métricas.'
          }
        />
      </Card>
    );
  }

  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 text-left font-medium">Plataforma</th>
              <th className="px-4 py-3 text-left font-medium">Cuenta</th>
              <th className="px-4 py-3 text-left font-medium">Marca</th>
              <th className="px-4 py-3 text-right font-medium">Spend 30d (USD)</th>
              <th className="px-4 py-3 text-left font-medium">Estado</th>
              <th className="px-4 py-3 text-left font-medium">Último sync</th>
              <th className="px-4 py-3 text-right font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {accounts.map((a) => (
              <tr key={a.id} className="text-sm">
                <td className="px-4 py-3">
                  <PlatformBadge platform={a.platform} />
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/ads/${a.id}`}
                    prefetch={false}
                    className="flex flex-col hover:underline"
                  >
                    <span className="font-medium">
                      {a.accountName ?? a.externalAccountId}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {a.externalAccountId} · {a.currency}
                    </span>
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {a.brandName ?? '—'}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {(a.spendUsdCents30d / 100).toLocaleString('en-US', {
                    style: 'currency',
                    currency: 'USD',
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0,
                  })}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={a.status} />
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {a.lastSyncAt
                    ? a.lastSyncAt.toISOString().replace('T', ' ').slice(0, 16)
                    : 'Nunca'}
                </td>
                <td className="px-4 py-3 text-right">
                  {canManage && a.status === 'connected' ? (
                    <AdsRowActions adsAccountId={a.id} />
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function PlatformBadge({
  platform,
}: {
  platform: 'google' | 'meta';
}): React.ReactElement {
  return (
    <Badge variant="outline" className="font-normal">
      {platform === 'google' ? 'Google Ads' : 'Meta Ads'}
    </Badge>
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
