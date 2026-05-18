import { ArrowLeft, Eye } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PageHeader } from '@/components/common/page-header';
import { UpgradePrompt } from '@/components/billing/upgrade-prompt';
import { CustomReportBuilder } from '@/components/custom-reports/custom-report-builder';
import { Button } from '@/components/ui/button';
import { requireUser } from '@/lib/auth/server';
import { getCustomReportWithWidgets } from '@/lib/custom-reports/queries';
import { authorize } from '@/lib/permissions/can';
import { planAllowsNamedFeature } from '@/lib/plans/gates';
import { getOrgPlanCode } from '@/lib/queries/plan';

export const dynamic = 'force-dynamic';

interface EditPageProps {
  params: Promise<{ id: string }>;
}

export default async function CustomReportEditPage({
  params,
}: EditPageProps): Promise<React.ReactElement> {
  const session = await requireUser();
  authorize(session.role, 'custom_reports:write');

  const plan = await getOrgPlanCode(session);
  if (!planAllowsNamedFeature(plan, 'custom_reports')) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Edit Custom Report" description="Enterprise only." />
        <UpgradePrompt
          unlocksOn="enterprise"
          featureName="Custom Report Builder"
          valueBullets={['Editar reportes custom requiere Enterprise.']}
          currentPlan={plan}
          organizationId={session.orgId}
        />
      </div>
    );
  }

  const { id } = await params;
  const loaded = await getCustomReportWithWidgets({
    orgId: session.orgId,
    userId: session.userId,
    reportId: id,
  });
  if (!loaded) notFound();
  if (loaded.report.status === 'archived') {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title={loaded.report.name}
          description="Reporte archivado — restorá para editar."
        />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <PageHeader
        title={`Editando · ${loaded.report.name}`}
        description="Drag-drop widgets sobre el grid. Cambios guardan en cada movimiento. Publicá cuando esté listo."
        actions={
          <div className="flex items-center gap-2">
            <Link href={`/reports/custom/${id}`}>
              <Button size="sm" variant="outline">
                <Eye className="h-3.5 w-3.5" />
                Vista
              </Button>
            </Link>
            <Link href="/reports/custom">
              <Button size="sm" variant="outline">
                <ArrowLeft className="h-3.5 w-3.5" />
                Volver
              </Button>
            </Link>
          </div>
        }
      />
      <CustomReportBuilder
        reportId={id}
        reportName={loaded.report.name}
        reportStatus={loaded.report.status}
        initialWidgets={[...loaded.widgets]}
      />
    </div>
  );
}
