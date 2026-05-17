import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { loadUserTimelineWithTx } from '@/lib/audit-advanced/queries';
import { PageHeader } from '@/components/common/page-header';
import { Card } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/server';
import { dbAs } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { authorize } from '@/lib/permissions/can';
import { planAllowsNamedFeature } from '@/lib/plans/gates';
import { getOrgPlanCode } from '@/lib/queries/plan';

export const dynamic = 'force-dynamic';

interface TimelinePageProps {
  params: Promise<{ userId: string }>;
}

export default async function AuditTimelinePage({
  params,
}: TimelinePageProps): Promise<React.ReactElement> {
  const session = await requireUser();
  authorize(session.role, 'audit:read');

  const plan = await getOrgPlanCode(session);
  if (!planAllowsNamedFeature(plan, 'audit_advanced')) {
    notFound();
  }

  const { userId } = await params;

  const [user, events] = await Promise.all([
    dbAs<Array<{ email: string; name: string | null }>>(
      { orgId: session.orgId, userId: session.userId },
      (tx) =>
        tx
          .select({ email: users.email, name: users.name })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1),
    ),
    dbAs(
      { orgId: session.orgId, userId: session.userId },
      (tx) => loadUserTimelineWithTx(tx, session.orgId, userId, 90, 200),
    ),
  ]);
  const actor = user[0];
  if (!actor) {
    notFound();
  }

  return (
    <div
      className="flex flex-col gap-6 px-6 py-6"
      data-testid="audit-timeline"
    >
      <PageHeader
        title={`Timeline: ${actor.name ?? actor.email}`}
        description={`Últimos 90 días de actividad auditada de ${actor.email}. Útil para investigación post-incidente o compliance review.`}
        eyebrow={
          <Link href="/audit" className="hover:underline">
            ← Volver a Audit
          </Link>
        }
      />
      {events.length === 0 ? (
        <Card className="p-4 text-sm text-muted-foreground">
          Sin actividad auditada en los últimos 90 días.
        </Card>
      ) : (
        <Card className="divide-y">
          {events.map((e) => (
            <div
              key={e.id}
              className="flex flex-col gap-1 p-3 text-sm"
              data-testid={`timeline-event-${e.id}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono">{e.action}</span>
                <span className="text-xs text-muted-foreground">
                  {e.createdAt.toLocaleString()}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                {e.entityType ? `${e.entityType}` : ''}
                {e.entityId ? ` (${e.entityId.slice(0, 8)}…)` : ''}
                {e.riskLevel ? ` · risk=${e.riskLevel}` : ''}
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
