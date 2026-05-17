import { ScrollText } from 'lucide-react';
import Link from 'next/link';

import { searchAuditEventsWithTx } from '@/lib/audit-advanced/queries';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { UpgradePrompt } from '@/components/billing/upgrade-prompt';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/server';
import { dbAs } from '@/lib/db/client';
import { authorize } from '@/lib/permissions/can';
import { planAllowsNamedFeature } from '@/lib/plans/gates';
import { getOrgPlanCode } from '@/lib/queries/plan';

export const dynamic = 'force-dynamic';

interface AuditPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * /audit — Phase 10 / Commit 37.
 *
 * Replaces the Phase-1 stub that used the legacy
 * `components/common/upgrade-prompt`. Two tiers:
 *
 *   - Standard/Growth: read-only view of audit_events with basic
 *     filters (last 30d default). UpgradePrompt overlay points to
 *     Enterprise extras.
 *   - Enterprise: full Advanced Audit — links to /audit/timeline/
 *     [userId], /audit/anomalies, /audit/retention.
 */
export default async function AuditPage({
  searchParams,
}: AuditPageProps): Promise<React.ReactElement> {
  const session = await requireUser();
  authorize(session.role, 'audit:read');

  const plan = await getOrgPlanCode(session);
  const auditAdvanced = planAllowsNamedFeature(plan, 'audit_advanced');

  const sp = await searchParams;
  const sinceDays = parseSince(sp.sinceDays);
  const actionPrefix =
    typeof sp.actionPrefix === 'string' ? sp.actionPrefix : null;

  const events = await dbAs(
    { orgId: session.orgId, userId: session.userId },
    (tx) =>
      searchAuditEventsWithTx(
        tx,
        session.orgId,
        { sinceDays, actionPrefix },
        200,
      ),
  );

  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      <PageHeader
        title="Audit log"
        description="Registro append-only de cada acción significativa. Quién hizo qué, cuándo, con qué cambio."
        actions={
          auditAdvanced ? (
            <div className="flex items-center gap-2">
              <Button asChild size="sm" variant="outline">
                <Link href="/audit/anomalies">Anomalías</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/audit/retention">Retention</Link>
              </Button>
            </div>
          ) : null
        }
      />

      {!auditAdvanced ? (
        <UpgradePrompt
          unlocksOn="enterprise"
          featureName="Advanced Audit"
          currentPlan={plan}
          organizationId={session.orgId}
          valueBullets={[
            'SOC 2 / ISO 27001 compliance trail con event_hash tamper detection',
            'Anomaly detection (off-hours access, new IP, mass export)',
            'Retention policies per acción con purga automática',
            'CSV export hasta 100K rows con dual enforcement',
          ]}
        />
      ) : null}

      <form className="flex flex-wrap items-end gap-2 text-xs" data-testid="audit-filter-form">
        <label className="flex flex-col gap-0.5">
          <span className="uppercase tracking-wide text-muted-foreground">
            Últimos N días
          </span>
          <select
            name="sinceDays"
            defaultValue={String(sinceDays)}
            className="rounded-md border bg-background px-2 py-1"
          >
            <option value="7">7</option>
            <option value="30">30</option>
            <option value="90">90</option>
            <option value="180">180</option>
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="uppercase tracking-wide text-muted-foreground">
            Action prefix
          </span>
          <input
            name="actionPrefix"
            defaultValue={actionPrefix ?? ''}
            placeholder="ej: billing.* o custom_role"
            className="rounded-md border bg-background px-2 py-1 font-mono"
          />
        </label>
        <Button type="submit" size="sm" variant="outline">
          Filtrar
        </Button>
      </form>

      {events.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="Sin eventos en este rango"
          description="Ajustá los filtros o ampliá el rango temporal."
        />
      ) : (
        <Card className="divide-y">
          {events.map((e) => (
            <div
              key={e.id}
              className="flex flex-col gap-1 p-3 text-sm"
              data-testid={`audit-event-${e.id}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-foreground">{e.action}</span>
                <span className="text-xs text-muted-foreground">
                  {e.createdAt.toLocaleString()}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                {e.actorName ?? e.actorEmail ?? 'system'}{' '}
                {e.entityType ? `· ${e.entityType}` : ''}
                {e.riskLevel ? ` · risk=${e.riskLevel}` : ''}
              </div>
              {auditAdvanced && e.userId ? (
                <Link
                  href={`/audit/timeline/${e.userId}`}
                  className="self-start text-[10px] text-primary hover:underline"
                >
                  Ver timeline de este actor →
                </Link>
              ) : null}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function parseSince(raw: string | string[] | undefined): number {
  const v = typeof raw === 'string' ? Number(raw) : 30;
  if (!Number.isFinite(v) || v < 1 || v > 365) return 30;
  return Math.round(v);
}
