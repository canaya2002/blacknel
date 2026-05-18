import { ArrowLeft, Edit2 } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PageHeader } from '@/components/common/page-header';
import { UpgradePrompt } from '@/components/billing/upgrade-prompt';
import { CustomReportCanvas } from '@/components/custom-reports/custom-report-canvas';
import { Button } from '@/components/ui/button';
import { requireUser } from '@/lib/auth/server';
import { runCustomReport } from '@/lib/custom-reports/run';
import { getCustomReportWithWidgets } from '@/lib/custom-reports/queries';
import { authorize, can } from '@/lib/permissions/can';
import { planAllowsNamedFeature } from '@/lib/plans/gates';
import { getOrgPlanCode } from '@/lib/queries/plan';

export const dynamic = 'force-dynamic';

interface ViewPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ fresh?: string }>;
}

export default async function CustomReportViewPage({
  params,
  searchParams,
}: ViewPageProps): Promise<React.ReactElement> {
  const session = await requireUser();
  authorize(session.role, 'custom_reports:read');

  const plan = await getOrgPlanCode(session);
  if (!planAllowsNamedFeature(plan, 'custom_reports')) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Custom Report" description="Enterprise only." />
        <UpgradePrompt
          unlocksOn="enterprise"
          featureName="Custom Report Builder"
          valueBullets={['Ver y editar reportes custom requiere Enterprise.']}
          currentPlan={plan}
          organizationId={session.orgId}
        />
      </div>
    );
  }

  const { id } = await params;
  const sp = await searchParams;

  const loaded = await getCustomReportWithWidgets({
    orgId: session.orgId,
    userId: session.userId,
    reportId: id,
  });
  if (!loaded) notFound();

  // 30-day window default for the view. Builder edit page lets the
  // user override via filters once the v2 ships in Phase 12.
  const now = new Date();
  const rangeStart = new Date(now.getTime() - 30 * 86_400_000);

  const result = await runCustomReport({
    orgId: session.orgId,
    userId: session.userId,
    reportId: id,
    rangeStart,
    rangeEnd: now,
    bypassCache: sp.fresh === '1',
  });

  const canWrite = can(session.role, 'custom_reports:write');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={loaded.report.name}
        description={loaded.report.description ?? undefined}
        actions={
          <div className="flex items-center gap-2">
            <Link href="/reports/custom">
              <Button size="sm" variant="outline">
                <ArrowLeft className="h-3.5 w-3.5" />
                Volver
              </Button>
            </Link>
            {canWrite && loaded.report.status !== 'archived' ? (
              <Link href={`/reports/custom/${id}/edit`}>
                <Button size="sm">
                  <Edit2 className="h-3.5 w-3.5" />
                  Editar
                </Button>
              </Link>
            ) : null}
          </div>
        }
      />
      <CustomReportCanvas readOnly widgets={result.widgets} />
    </div>
  );
}
