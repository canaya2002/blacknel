import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CategoryBadge } from '@/components/nps/category-badge';
import { NpsKpiCards } from '@/components/nps/kpi-cards';
import { NpsExportButton } from '@/components/nps/nps-export-button';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/server';
import {
  getOrgAggregates,
  getSurveyById,
  listResponses,
} from '@/lib/nps/queries';
import { authorize, can } from '@/lib/permissions/can';
import { planAllowsNamedFeature } from '@/lib/plans/gates';
import { getOrgPlanCode } from '@/lib/queries/plan';

export const dynamic = 'force-dynamic';

interface SurveyDetailPageProps {
  params: Promise<{ id: string }>;
}

/**
 * /nps/surveys/[id] — Phase 9 / Commit 35 (Detail-page template,
 * doc/PATTERNS.md).
 *
 * 5 sections in fixed order:
 *
 *   1. PageHeader        — title + back link + Edit action
 *   2. KPI cards row     — NPS score + bucket %s + response rate
 *   3. Timeline section  — placeholder (real sparkline lands Phase 10)
 *   4. Survey meta + responses table
 *   5. Footer actions    — export CSV
 */
export default async function NpsSurveyDetailPage({
  params,
}: SurveyDetailPageProps): Promise<React.ReactElement> {
  const session = await requireUser();
  authorize(session.role, 'nps:read');

  const plan = await getOrgPlanCode(session);
  if (!planAllowsNamedFeature(plan, 'nps_surveys')) {
    notFound();
  }

  const { id } = await params;
  const survey = await getSurveyById({
    orgId: session.orgId,
    userId: session.userId,
    surveyId: id,
  });
  if (!survey) {
    notFound();
  }

  const [aggregates, responses] = await Promise.all([
    getOrgAggregates({
      orgId: session.orgId,
      userId: session.userId,
      surveyId: id,
      sinceDays: 90,
    }),
    listResponses({
      orgId: session.orgId,
      userId: session.userId,
      surveyId: id,
      limit: 100,
    }),
  ]);

  const canManage = can(session.role, 'nps:manage');

  return (
    <div
      className="flex flex-col gap-6 px-6 py-6"
      data-testid="nps-survey-detail"
    >
      {/* 1. PageHeader */}
      <PageHeader
        title={survey.name}
        description={survey.questionText}
        eyebrow={
          <Link href="/nps" className="hover:underline">
            ← Volver a NPS
          </Link>
        }
        actions={
          canManage ? (
            <Button asChild size="sm" variant="outline">
              <Link href={`/nps/surveys/${survey.id}/edit`}>Editar</Link>
            </Button>
          ) : null
        }
      />

      {/* 2. KPI cards row */}
      <NpsKpiCards aggregates={aggregates} />

      {/* 3. Timeline placeholder */}
      <Card
        className="p-4 text-sm text-muted-foreground"
        data-testid="nps-survey-trend-placeholder"
      >
        Trend rolling 90d sparkline aterriza en Fase 10. Por ahora,
        los KPIs arriba reflejan respuestas de los últimos 90 días.
      </Card>

      {/* 4. Survey meta + responses table */}
      <Card className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
        <Field label="Trigger" value={survey.trigger} />
        <Field label="Estado" value={survey.status} />
        <Field label="Idioma" value={survey.locale} />
        <Field label="Canales" value={survey.channels.join(' + ')} />
        <Field
          label="Mínimo días entre envíos"
          value={String(survey.minDaysBetweenSends)}
        />
        <Field label="Respuestas" value={String(survey.responseCount)} />
      </Card>

      <section
        className="flex flex-col gap-2"
        data-testid="nps-survey-responses"
      >
        <h2 className="text-sm font-semibold">Respuestas recientes</h2>
        {responses.length === 0 ? (
          <Card className="p-4 text-sm text-muted-foreground">
            Aún no hay respuestas para este survey.
          </Card>
        ) : (
          <Card className="divide-y">
            {responses.map((r) => (
              <div
                key={r.id}
                className="flex items-start gap-4 p-3"
                data-testid={`nps-response-${r.id}`}
              >
                <span className="w-10 flex-none text-2xl font-semibold tabular-nums">
                  {r.score}
                </span>
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
                    <p className="text-sm leading-relaxed">{r.comment}</p>
                  ) : (
                    <p className="text-xs italic text-muted-foreground">
                      (sin comentario)
                    </p>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {r.respondedAt.toLocaleString()}
                  </span>
                </div>
              </div>
            ))}
          </Card>
        )}
      </section>

      {/* 5. Footer actions */}
      <footer className="flex items-center justify-between border-t pt-4">
        <span className="text-sm font-medium">Exportar respuestas</span>
        <NpsExportButton period="90d" surveyId={survey.id} />
      </footer>
    </div>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}
