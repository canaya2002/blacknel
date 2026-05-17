import { notFound } from 'next/navigation';

import { CompetitorForm } from '@/components/competitors/competitor-form';
import { PageHeader } from '@/components/common/page-header';
import { requireUser } from '@/lib/auth/server';
import { authorize } from '@/lib/permissions/can';
import { planAllowsNamedFeature } from '@/lib/plans/gates';
import { getOrgPlanCode } from '@/lib/queries/plan';

export const dynamic = 'force-dynamic';

export default async function NewCompetitorPage(): Promise<React.ReactElement> {
  const session = await requireUser();
  authorize(session.role, 'competitors:manage');

  const plan = await getOrgPlanCode(session);
  if (!planAllowsNamedFeature(plan, 'competitors_tracking')) {
    notFound();
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-6">
      <PageHeader
        title="Nuevo competidor"
        description="Identificá los handles del competidor. El cron diario va a empezar a capturar métricas la próxima hora."
      />
      <CompetitorForm />
    </div>
  );
}
