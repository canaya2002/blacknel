import Link from 'next/link';
import { notFound } from 'next/navigation';

import { NpsKpiCards } from '@/components/nps/kpi-cards';
import { NpsExportButton } from '@/components/nps/nps-export-button';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/server';
import { getOrgAggregates, getSurveyById } from '@/lib/nps/queries';
import { authorize, can } from '@/lib/permissions/can';
import { planAllowsNamedFeature } from '@/lib/plans/gates';
import { getOrgPlanCode } from '@/lib/queries/plan';

export const dynamic = 'force-dynamic';

interface SurveyDetailPageProps {
  params: Promise<{ id: string }>;
}

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

  const aggregates = await getOrgAggregates({
    orgId: session.orgId,
    userId: session.userId,
    surveyId: id,
    sinceDays: 90,
  });

  const canManage = can(session.role, 'nps:manage');

  return (
    <div className="flex flex-col gap-6 px-6 py-6">
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

      <NpsKpiCards aggregates={aggregates} />

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

      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Exportar respuestas</span>
        <NpsExportButton period="90d" surveyId={survey.id} />
      </div>
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
