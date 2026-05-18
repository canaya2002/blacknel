import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

import { NewCustomReportForm } from '@/components/custom-reports/new-report-form';
import { PageHeader } from '@/components/common/page-header';
import { UpgradePrompt } from '@/components/billing/upgrade-prompt';
import { Button } from '@/components/ui/button';
import { requireUser } from '@/lib/auth/server';
import { TEMPLATE_LIST, type TemplateId } from '@/lib/custom-reports/templates';
import { authorize } from '@/lib/permissions/can';
import { planAllowsNamedFeature } from '@/lib/plans/gates';
import { getOrgPlanCode } from '@/lib/queries/plan';

export const dynamic = 'force-dynamic';

interface NewPageProps {
  searchParams: Promise<{ template?: string }>;
}

export default async function NewCustomReportPage({
  searchParams,
}: NewPageProps): Promise<React.ReactElement> {
  const session = await requireUser();
  authorize(session.role, 'custom_reports:write');

  const plan = await getOrgPlanCode(session);
  if (!planAllowsNamedFeature(plan, 'custom_reports')) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Nuevo reporte" description="Enterprise only." />
        <UpgradePrompt
          unlocksOn="enterprise"
          featureName="Custom Report Builder"
          valueBullets={['Crear reportes custom requiere Enterprise.']}
          currentPlan={plan}
          organizationId={session.orgId}
        />
      </div>
    );
  }

  const sp = await searchParams;
  const templateId =
    sp.template &&
    TEMPLATE_LIST.some((t) => t.id === sp.template)
      ? (sp.template as TemplateId)
      : null;
  const template = templateId
    ? TEMPLATE_LIST.find((t) => t.id === templateId) ?? null
    : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={template ? `Nuevo reporte · ${template.name}` : 'Nuevo reporte custom'}
        description={
          template
            ? template.description
            : 'Empezá en blanco — vas a poder agregar widgets desde el builder.'
        }
        actions={
          <Link href="/reports/custom">
            <Button size="sm" variant="outline">
              <ArrowLeft className="h-3.5 w-3.5" />
              Volver
            </Button>
          </Link>
        }
      />
      <NewCustomReportForm templateId={templateId} />
    </div>
  );
}
