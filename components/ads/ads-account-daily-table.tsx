import { Card } from '@/components/ui/card';
import type { AdsAccountDailyRow } from '@/lib/ads/queries';

interface AdsAccountDailyTableProps {
  rows: ReadonlyArray<AdsAccountDailyRow>;
}

/**
 * Per-day spend rollup table for the /ads/[id] drill-down
 * (Phase 8 / Commit 30). Last 30 days, newest first. Table
 * only — chart polish lands in Phase 9.
 */
export function AdsAccountDailyTable({
  rows,
}: AdsAccountDailyTableProps): React.ReactElement {
  if (rows.length === 0) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Aún no hay spend registrado para esta cuenta. El cron
        sincroniza cada 24h (ventana 2d para atribución tardía).
      </Card>
    );
  }

  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 text-left font-medium">Fecha</th>
              <th className="px-4 py-3 text-right font-medium">Impressions</th>
              <th className="px-4 py-3 text-right font-medium">Clicks</th>
              <th className="px-4 py-3 text-right font-medium">CTR</th>
              <th className="px-4 py-3 text-right font-medium">
                Spend nativo
              </th>
              <th className="px-4 py-3 text-right font-medium">Spend USD</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => {
              const ctr =
                r.impressions > 0 ? (r.clicks / r.impressions) * 100 : 0;
              return (
                <tr key={`${r.date}-${r.currency}`} className="text-sm">
                  <td className="px-4 py-3 font-mono text-xs">{r.date}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {r.impressions.toLocaleString('en-US')}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {r.clicks.toLocaleString('en-US')}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {ctr.toFixed(2)}%
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatMoney(r.spendCents, r.currency)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatMoney(r.spendUsdCents, 'USD')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}
