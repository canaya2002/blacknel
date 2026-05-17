import { notFound } from 'next/navigation';

import { TrackedTermForm } from '@/components/listening/tracked-term-form';
import { PageHeader } from '@/components/common/page-header';
import { requireUser } from '@/lib/auth/server';
import { authorize } from '@/lib/permissions/can';
import { planAllowsNamedFeature } from '@/lib/plans/gates';
import { getOrgPlanCode } from '@/lib/queries/plan';

export const dynamic = 'force-dynamic';

export default async function NewTrackedTermPage(): Promise<React.ReactElement> {
  const session = await requireUser();
  authorize(session.role, 'listening:manage');

  const plan = await getOrgPlanCode(session);
  if (!planAllowsNamedFeature(plan, 'listening_mentions')) {
    notFound();
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-6">
      <PageHeader
        title="Nuevo tracked term"
        description="El término empezará a capturar mentions en el próximo tick del cron de listening (cada 60 minutos)."
      />
      <TrackedTermForm />
    </div>
  );
}
