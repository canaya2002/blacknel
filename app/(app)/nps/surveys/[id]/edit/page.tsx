import { notFound } from 'next/navigation';

import { NpsSurveyForm } from '@/components/nps/survey-form';
import { PageHeader } from '@/components/common/page-header';
import { requireUser } from '@/lib/auth/server';
import { getSurveyById } from '@/lib/nps/queries';
import { authorize } from '@/lib/permissions/can';
import { planAllowsNamedFeature } from '@/lib/plans/gates';
import { getOrgPlanCode } from '@/lib/queries/plan';

export const dynamic = 'force-dynamic';

interface EditSurveyPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditNpsSurveyPage({
  params,
}: EditSurveyPageProps): Promise<React.ReactElement> {
  const session = await requireUser();
  authorize(session.role, 'nps:manage');

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

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-6">
      <PageHeader
        title={`Editar: ${survey.name}`}
        description="Ajustá el trigger, los canales, el texto de la pregunta. Cambiar el status de active → paused frena los nuevos envíos."
      />
      <NpsSurveyForm mode="edit" initial={survey} />
    </div>
  );
}
