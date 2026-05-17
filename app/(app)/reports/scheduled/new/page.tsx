import { notFound } from 'next/navigation';

import { ScheduledReportForm } from '@/components/reports/scheduled-report-form';
import { PageHeader } from '@/components/common/page-header';
import { requireUser } from '@/lib/auth/server';
import { authorize } from '@/lib/permissions/can';
import { planAllowsNamedFeature } from '@/lib/plans/gates';
import { getOrgPlanCode } from '@/lib/queries/plan';

export const dynamic = 'force-dynamic';

export default async function NewScheduledReportPage(): Promise<React.ReactElement> {
  const session = await requireUser();
  authorize(session.role, 'scheduled_reports:manage');

  const plan = await getOrgPlanCode(session);
  if (!planAllowsNamedFeature(plan, 'scheduled_report_emails')) {
    notFound();
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-6">
      <PageHeader
        title="Programar reporte"
        description="El reporte se envía a los destinatarios siguiendo el horario en la timezone de tu organización."
      />
      <ScheduledReportForm />
    </div>
  );
}
