import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';

import { Card, CardContent } from '@/components/ui/card';
import { getActiveAdsAlertCount } from '@/lib/ads/alerts-queries';
import { log } from '@/lib/log';
import { can } from '@/lib/permissions/can';
import type { Role } from '@/lib/permissions/roles';

interface AdsAlertsWidgetProps {
  orgId: string;
  userId: string;
  role: Role;
}

/**
 * Pending ads-alerts widget on /dashboard (Phase 8 / Commit 30,
 * D-30-3).
 *
 * # Render rules
 *
 *   - role lacks `ads_alerts:read` → null
 *   - count === 0 → null (consistent with the crisis banner pattern)
 *   - query fails → null + log.error (Ajuste 3)
 *   - count > 0 → small card linking to /ads
 *
 * **Ajuste 3 — query-failure safety.** This widget is a NON-CORE
 * supplement on the dashboard. If the alerts query throws for
 * any reason (RLS misconfig, network blip, transient pglite
 * issue), we MUST NOT break the parent render — the dashboard's
 * core experience is the onboarding checklist + empty state. We
 * swallow the error here, log it, and render null. The user
 * sees a slightly-emptier dashboard rather than a 500.
 *
 * Server Component — count is fetched on render, no client
 * polling. The parent re-renders on its normal lifecycle (route
 * navigation, revalidatePath after decisions).
 */
export async function AdsAlertsWidget({
  orgId,
  userId,
  role,
}: AdsAlertsWidgetProps): Promise<React.ReactElement | null> {
  if (!can(role, 'ads_alerts:read')) return null;

  let count = 0;
  try {
    count = await getActiveAdsAlertCount({ orgId, userId });
  } catch (err) {
    log.error(
      { err: (err as Error).message, widget: 'ads-alerts' },
      'dashboard.widget.failed',
    );
    return null;
  }

  if (count === 0) return null;

  return (
    <Card className="border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/20">
      <CardContent className="flex items-center justify-between gap-4 pt-5">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden />
          <div className="flex flex-col">
            <div className="text-sm font-medium">
              {count === 1
                ? '1 alerta de ads pendiente'
                : `${count} alertas de ads pendientes`}
            </div>
            <div className="text-xs text-muted-foreground">
              CTR drop, spend spike o account error. Revisá y decidí en /ads.
            </div>
          </div>
        </div>
        <Link
          href="/ads"
          prefetch={false}
          className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
        >
          Ir a /ads →
        </Link>
      </CardContent>
    </Card>
  );
}
