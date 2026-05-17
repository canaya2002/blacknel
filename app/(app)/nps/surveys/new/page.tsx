import { notFound } from 'next/navigation';

import { NpsSurveyForm } from '@/components/nps/survey-form';
import { PageHeader } from '@/components/common/page-header';
import { requireUser } from '@/lib/auth/server';
import { authorize } from '@/lib/permissions/can';
import { planAllowsNamedFeature } from '@/lib/plans/gates';
import { getOrgPlanCode } from '@/lib/queries/plan';

export const dynamic = 'force-dynamic';

export default async function NewNpsSurveyPage(): Promise<React.ReactElement> {
  const session = await requireUser();
  authorize(session.role, 'nps:manage');

  const plan = await getOrgPlanCode(session);
  if (!planAllowsNamedFeature(plan, 'nps_surveys')) {
    notFound();
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-6">
      <PageHeader
        title="Nuevo NPS survey"
        description="Definí el trigger, el canal y la pregunta. Podés activar el survey ahora o dejarlo en draft hasta que esté listo."
      />
      <NpsSurveyForm mode="create" />
    </div>
  );
}
