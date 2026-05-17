import { Swords } from 'lucide-react';
import Link from 'next/link';

import { SovBar } from '@/components/competitors/sov-bar';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { UpgradePrompt } from '@/components/billing/upgrade-prompt';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/server';
import {
  getCompetitorsAggregate,
  listCompetitors,
} from '@/lib/competitors/queries';
import { authorize, can } from '@/lib/permissions/can';
import { planAllowsNamedFeature } from '@/lib/plans/gates';
import { getOrgPlanCode } from '@/lib/queries/plan';

export const dynamic = 'force-dynamic';

/**
 * /competitors — Phase 9 / Commit 34.
 *
 * List of tracked competitors with last-30d SoV bars + aggregate
 * KPIs. Replaces the Phase-1 stub that pointed at the legacy
 * `components/common/upgrade-prompt`.
 */
export default async function CompetitorsPage(): Promise<React.ReactElement> {
  const session = await requireUser();
  authorize(session.role, 'competitors:read');

  const plan = await getOrgPlanCode(session);
  const allowed = planAllowsNamedFeature(plan, 'competitors_tracking');
  const canManage = can(session.role, 'competitors:manage');

  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      <PageHeader
        title="Competitors"
        description="Monitoreo de competidores: volumen de publicación, share of voice y sentiment. Datos mock hasta Fase 11 (Brand24 / SimilarWeb)."
        actions={
          allowed && canManage ? (
            <Button asChild size="sm">
              <Link href="/competitors/new">Nuevo competidor</Link>
            </Button>
          ) : null
        }
      />

      {!allowed ? (
        <UpgradePrompt
          unlocksOn="growth"
          featureName="Competitors tracking"
          currentPlan={plan}
          organizationId={session.orgId}
          valueBullets={[
            'Tracking de hasta 3 competidores por brand',
            'Share of voice rolling 30 días por plataforma',
            'Sentiment agregado de la conversación competitiva',
          ]}
        />
      ) : null}

      {allowed ? <CompetitorsBody session={session} canManage={canManage} /> : null}
    </div>
  );
}

async function CompetitorsBody({
  session,
  canManage,
}: {
  session: { orgId: string; userId: string };
  canManage: boolean;
}): Promise<React.ReactElement> {
  const [competitors, aggregate] = await Promise.all([
    listCompetitors({
      orgId: session.orgId,
      userId: session.userId,
    }),
    getCompetitorsAggregate({
      orgId: session.orgId,
      userId: session.userId,
      sinceDays: 30,
    }),
  ]);

  if (competitors.length === 0) {
    return (
      <EmptyState
        icon={Swords}
        title="Aún no seguís a ningún competidor"
        description="Agregá competidores con su handle por plataforma. El cron va a tomar snapshots diarios y calcular share of voice."
        primary={
          canManage
            ? { label: 'Agregar competidor', href: '/competitors/new' }
            : {
                label: 'Agregar competidor',
                disabledReason: 'Tu rol no permite gestionar competidores.',
              }
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiTile label="Competidores activos" value={String(aggregate.competitorCount)} />
        <KpiTile label="Posts (rivales) 30d" value={String(aggregate.totalPosts)} />
        <KpiTile
          label="SoV promedio"
          value={`${(aggregate.avgShareOfVoice * 100).toFixed(0)}%`}
        />
      </div>

      <Card className="divide-y">
        {competitors.map((c) => (
          <div
            key={c.id}
            className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
            data-testid={`competitor-${c.id}`}
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold">{c.name}</span>
              <span className="text-xs text-muted-foreground">
                {c.brandName ?? 'Todas las brands'} · {c.platforms.join(', ')}
              </span>
              <span className="text-xs text-muted-foreground">
                {c.postsLast30d} posts en últimos 30d
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">SoV 30d</span>
              <SovBar sov={c.avgSharOfVoiceLast30d} />
              <span
                className={
                  c.status === 'active'
                    ? 'rounded-md border border-emerald-500/40 bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                    : 'rounded-md border bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground'
                }
              >
                {c.status}
              </span>
            </div>
          </div>
        ))}
      </Card>

      <p className="text-xs text-muted-foreground" data-testid="competitors-note">
        {canManage ? null : 'Pedile a un manager para agregar más competidores.'}
      </p>
    </div>
  );
}

function KpiTile({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.ReactElement {
  return (
    <Card className="flex flex-col gap-1 p-3">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
    </Card>
  );
}
