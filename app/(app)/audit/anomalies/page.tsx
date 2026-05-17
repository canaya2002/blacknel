import { Bell } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AnomalyCard } from '@/components/audit/anomaly-card';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { requireUser } from '@/lib/auth/server';
import { listAnomalies } from '@/lib/audit-advanced/queries';
import { authorize } from '@/lib/permissions/can';
import { planAllowsNamedFeature } from '@/lib/plans/gates';
import { getOrgPlanCode } from '@/lib/queries/plan';

export const dynamic = 'force-dynamic';

interface AnomaliesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AnomaliesPage({
  searchParams,
}: AnomaliesPageProps): Promise<React.ReactElement> {
  const session = await requireUser();
  authorize(session.role, 'audit:read');

  const plan = await getOrgPlanCode(session);
  if (!planAllowsNamedFeature(plan, 'audit_advanced')) {
    notFound();
  }

  const sp = await searchParams;
  const statusFilter =
    typeof sp.status === 'string' &&
    ['pending', 'dismissed', 'accepted', 'all'].includes(sp.status)
      ? (sp.status as 'pending' | 'dismissed' | 'accepted' | 'all')
      : 'pending';

  const anomalies = await listAnomalies({
    orgId: session.orgId,
    userId: session.userId,
    status: statusFilter,
    limit: 200,
  });

  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      <PageHeader
        title="Audit anomalies"
        description="Detección heurística sobre el audit log. Conservadora (3 kinds: off-hours access, new IP, mass export). Dismissal requiere reason ≥10 chars."
        eyebrow={
          <Link href="/audit" className="hover:underline">
            ← Volver a Audit
          </Link>
        }
      />
      <nav className="flex items-center gap-1 border-b">
        {(['pending', 'dismissed', 'accepted', 'all'] as const).map((s) => (
          <Link
            key={s}
            href={`/audit/anomalies?status=${s}`}
            className={
              statusFilter === s
                ? 'border-b-2 border-primary px-3 py-1.5 text-sm font-medium'
                : 'border-b-2 border-transparent px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground'
            }
            data-testid={`anomalies-tab-${s}`}
          >
            {s}
          </Link>
        ))}
      </nav>
      {anomalies.length === 0 ? (
        <EmptyState
          icon={Bell}
          title={`Sin anomalías en estado ${statusFilter}`}
          description="El cron-tick de detección corre cada hora. Si tu org no genera audit events sospechosos en la ventana, esto se queda vacío."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {anomalies.map((a) => (
            <AnomalyCard key={a.id} anomaly={a} />
          ))}
        </div>
      )}
    </div>
  );
}
