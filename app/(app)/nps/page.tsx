import { Gauge } from 'lucide-react';
import Link from 'next/link';

import { CategoryBadge } from '@/components/nps/category-badge';
import { NpsKpiCards } from '@/components/nps/kpi-cards';
import { NpsExportButton } from '@/components/nps/nps-export-button';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { UpgradePrompt } from '@/components/billing/upgrade-prompt';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/server';
import {
  getOrgAggregates,
  listResponses,
  listSurveys,
} from '@/lib/nps/queries';
import { authorize, can } from '@/lib/permissions/can';
import { planAllowsNamedFeature } from '@/lib/plans/gates';
import { getOrgPlanCode } from '@/lib/queries/plan';

export const dynamic = 'force-dynamic';

type Tab = 'surveys' | 'responses' | 'analytics';

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'surveys', label: 'Surveys' },
  { id: 'responses', label: 'Respuestas' },
  { id: 'analytics', label: 'Analytics' },
];

interface NpsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * /nps — Phase 9 / Commit 32.
 *
 * Single page with three tabs (URL-driven via `?tab=`). Plan gate
 * applies at server level: standard plan sees the UpgradePrompt
 * overlay above an empty page; Growth+ sees full content.
 */
export default async function NpsPage({
  searchParams,
}: NpsPageProps): Promise<React.ReactElement> {
  const session = await requireUser();
  authorize(session.role, 'nps:read');

  const sp = await searchParams;
  const tabRaw = typeof sp.tab === 'string' ? sp.tab : 'surveys';
  const tab: Tab =
    tabRaw === 'responses' || tabRaw === 'analytics' ? tabRaw : 'surveys';

  const plan = await getOrgPlanCode(session);
  const allowed = planAllowsNamedFeature(plan, 'nps_surveys');
  const canManage = can(session.role, 'nps:manage');

  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      <PageHeader
        title="NPS"
        description="Mide el Net Promoter Score por survey, canal y periodo. Los managers reciben las respuestas en tiempo real."
        actions={
          allowed && canManage ? (
            <Button asChild size="sm">
              <Link href="/nps/surveys/new">Nuevo survey</Link>
            </Button>
          ) : null
        }
      />

      {!allowed ? (
        <UpgradePrompt
          unlocksOn="growth"
          featureName="NPS surveys"
          currentPlan={plan}
          organizationId={session.orgId}
          valueBullets={[
            'Envía surveys post-resolución de tickets de soporte',
            'Mide promoters / passives / detractors y el NPS por brand',
            'Exporta respuestas a CSV para análisis externo',
          ]}
        />
      ) : null}

      <nav className="flex items-center gap-1 border-b">
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <Link
              key={t.id}
              href={t.id === 'surveys' ? '/nps' : `/nps?tab=${t.id}`}
              className={
                active
                  ? 'border-b-2 border-primary px-4 py-2 text-sm font-medium text-foreground'
                  : 'border-b-2 border-transparent px-4 py-2 text-sm text-muted-foreground hover:text-foreground'
              }
              data-testid={`nps-tab-${t.id}`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      {allowed && tab === 'surveys' ? (
        <SurveysTab session={session} canManage={canManage} />
      ) : null}
      {allowed && tab === 'responses' ? (
        <ResponsesTab session={session} />
      ) : null}
      {allowed && tab === 'analytics' ? (
        <AnalyticsTab session={session} />
      ) : null}
    </div>
  );
}

async function SurveysTab({
  session,
  canManage,
}: {
  session: { orgId: string; userId: string };
  canManage: boolean;
}): Promise<React.ReactElement> {
  const surveys = await listSurveys({
    orgId: session.orgId,
    userId: session.userId,
  });
  if (surveys.length === 0) {
    return (
      <EmptyState
        icon={Gauge}
        title="Aún no hay surveys"
        description="Creá tu primer NPS survey y empezá a recoger feedback estructurado."
        primary={
          canManage
            ? { label: 'Crear survey', href: '/nps/surveys/new' }
            : {
                label: 'Crear survey',
                disabledReason:
                  'Tu rol no permite gestionar surveys NPS.',
              }
        }
      />
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {surveys.map((s) => (
        <Card key={s.id} className="flex flex-col gap-2 p-4">
          <div className="flex items-start justify-between gap-2">
            <Link
              href={`/nps/surveys/${s.id}`}
              className="text-sm font-semibold leading-tight hover:underline"
            >
              {s.name}
            </Link>
            <span
              className={
                s.status === 'active'
                  ? 'rounded-md border border-emerald-500/40 bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : s.status === 'paused'
                    ? 'rounded-md border border-amber-500/40 bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                    : s.status === 'archived'
                      ? 'rounded-md border bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground'
                      : 'rounded-md border px-1.5 py-0.5 text-xs font-medium text-muted-foreground'
              }
            >
              {s.status}
            </span>
          </div>
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {s.questionText}
          </p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>trigger: {s.trigger}</span>
            <span>·</span>
            <span>{s.channels.join(' + ')}</span>
            <span>·</span>
            <span>{s.responseCount} respuestas</span>
          </div>
        </Card>
      ))}
    </div>
  );
}

async function ResponsesTab({
  session,
}: {
  session: { orgId: string; userId: string };
}): Promise<React.ReactElement> {
  const responses = await listResponses({
    orgId: session.orgId,
    userId: session.userId,
    limit: 100,
  });

  if (responses.length === 0) {
    return (
      <EmptyState
        icon={Gauge}
        title="Sin respuestas todavía"
        description="Cuando tus contactos respondan los surveys, las respuestas aparecerán aquí en tiempo real."
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {responses.length} respuestas recientes
        </span>
        <NpsExportButton period="90d" surveyId={null} />
      </div>
      <Card className="divide-y">
        {responses.map((r) => (
          <div
            key={r.id}
            className="flex items-start gap-4 p-3"
            data-testid={`nps-response-${r.id}`}
          >
            <div className="flex w-10 flex-none flex-col items-center">
              <span className="text-2xl font-semibold tabular-nums">
                {r.score}
              </span>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-center gap-2 text-sm">
                <CategoryBadge category={r.category} />
                <span className="text-muted-foreground">
                  {r.contactName ?? r.contactIdentifier}
                </span>
                <span className="text-xs text-muted-foreground">
                  via {r.channel}
                </span>
              </div>
              {r.comment ? (
                <p className="text-sm leading-relaxed text-foreground">
                  {r.comment}
                </p>
              ) : (
                <p className="text-xs italic text-muted-foreground">
                  (sin comentario)
                </p>
              )}
              <span className="text-xs text-muted-foreground">
                {r.surveyName} · {r.respondedAt.toLocaleString()}
              </span>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

async function AnalyticsTab({
  session,
}: {
  session: { orgId: string; userId: string };
}): Promise<React.ReactElement> {
  const aggregates = await getOrgAggregates({
    orgId: session.orgId,
    userId: session.userId,
    sinceDays: 90,
  });
  return (
    <div className="flex flex-col gap-4">
      <NpsKpiCards aggregates={aggregates} />
      <Card className="p-4 text-sm text-muted-foreground">
        Trend rolling 90 días — gráfico inline disponible en Fase 10.
        Por ahora los KPIs arriba reflejan respuestas de los últimos 90
        días.
      </Card>
    </div>
  );
}
