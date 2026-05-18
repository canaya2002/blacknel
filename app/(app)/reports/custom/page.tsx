import { ArrowRight, FileBarChart, Plus } from 'lucide-react';
import Link from 'next/link';

import { PageHeader } from '@/components/common/page-header';
import { UpgradePrompt } from '@/components/billing/upgrade-prompt';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/server';
import { listCustomReportsForUser } from '@/lib/custom-reports/queries';
import { TEMPLATE_LIST } from '@/lib/custom-reports/templates';
import { authorize, can } from '@/lib/permissions/can';
import { planAllowsNamedFeature } from '@/lib/plans/gates';
import { getOrgPlanCode } from '@/lib/queries/plan';

export const dynamic = 'force-dynamic';

/**
 * /reports/custom — Phase 10 / Commit 39.
 *
 * Custom Report Builder list page. Server component. Plan gate
 * displays an `<UpgradePrompt>` for Standard / Growth instead of
 * the report list.
 */
export default async function CustomReportsListPage(): Promise<React.ReactElement> {
  const session = await requireUser();
  authorize(session.role, 'custom_reports:read');

  const plan = await getOrgPlanCode(session);
  const allowed = planAllowsNamedFeature(plan, 'custom_reports');

  if (!allowed) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Custom Reports"
          description="Dashboards configurables con widgets drag-drop. Disponible en Enterprise."
        />
        <UpgradePrompt
          unlocksOn="enterprise"
          featureName="Custom Report Builder"
          valueBullets={[
            'Drag-drop dashboards con 5 tipos de widgets (KPI, tablas, sparklines, distribuciones, texto).',
            '7 fuentes de datos integradas (inbox, reviews, posts, ads, NPS, listening, crisis).',
            'Templates pre-armados: Marketing Performance, Customer Service Overview, Executive Dashboard.',
            'Comparte dashboards con tu equipo o mantenelos privados.',
          ]}
          currentPlan={plan}
          organizationId={session.orgId}
        />
      </div>
    );
  }

  const reports = await listCustomReportsForUser({
    orgId: session.orgId,
    userId: session.userId,
  });
  const canWrite = can(session.role, 'custom_reports:write');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Custom Reports"
        description="Dashboards configurables — drag-drop widgets sobre fuentes de datos integradas. Enterprise only."
        actions={
          canWrite ? (
            <Link href="/reports/custom/new">
              <Button size="sm">
                <Plus className="h-3.5 w-3.5" />
                Nuevo reporte
              </Button>
            </Link>
          ) : null
        }
      />

      {reports.length === 0 ? (
        <EmptyState canWrite={canWrite} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {reports.map((r) => (
            <Link key={r.id} href={`/reports/custom/${r.id}`}>
              <Card className="h-full transition-colors hover:bg-accent/40">
                <CardContent className="flex flex-col gap-2 p-4">
                  <div className="flex items-center gap-2">
                    <FileBarChart className="h-4 w-4 text-muted-foreground" />
                    <span className="truncate text-sm font-medium">{r.name}</span>
                    <StatusBadge status={r.status} />
                  </div>
                  {r.description ? (
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {r.description}
                    </p>
                  ) : null}
                  <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                    <span>
                      {r.widgetCount} widget{r.widgetCount === 1 ? '' : 's'} ·{' '}
                      {r.shareScope}
                    </span>
                    <span>
                      {r.createdByName ?? 'desconocido'} ·{' '}
                      {r.updatedAt.toLocaleDateString()}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({
  status,
}: {
  status: 'draft' | 'published' | 'archived';
}): React.ReactElement {
  const variant = {
    draft: { tone: 'bg-amber-500/15 text-amber-700 dark:text-amber-300', label: 'borrador' },
    published: {
      tone: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
      label: 'publicado',
    },
    archived: { tone: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400', label: 'archivado' },
  }[status];
  return (
    <span
      className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${variant.tone}`}
    >
      {variant.label}
    </span>
  );
}

function EmptyState({ canWrite }: { canWrite: boolean }): React.ReactElement {
  return (
    <div className="flex flex-col gap-6">
      <Card className="border-dashed bg-card/30">
        <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
          <FileBarChart className="h-8 w-8 text-muted-foreground" />
          <p className="text-base font-medium">Aún no tenés reportes custom</p>
          <p className="max-w-md text-xs text-muted-foreground">
            Empezá desde un template prearmado o creá uno en blanco. Cada widget
            arrastra-y-soltá una fuente de datos sobre el grid.
          </p>
          {canWrite ? (
            <Link href="/reports/custom/new">
              <Button>
                <Plus className="h-4 w-4" />
                Crear primer reporte custom
              </Button>
            </Link>
          ) : null}
        </CardContent>
      </Card>
      {canWrite ? <TemplatesGallery /> : null}
    </div>
  );
}

function TemplatesGallery(): React.ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">Templates sugeridos</h3>
      <div className="grid gap-3 md:grid-cols-3">
        {TEMPLATE_LIST.map((t) => (
          <Card key={t.id}>
            <CardContent className="flex h-full flex-col gap-2 p-4">
              <Badge variant="muted" className="w-fit text-[10px]">
                {t.persona}
              </Badge>
              <span className="text-sm font-medium">{t.name}</span>
              <p className="line-clamp-3 flex-1 text-xs text-muted-foreground">
                {t.description}
              </p>
              <span className="text-[10px] text-muted-foreground">
                {t.widgets.length} widgets
              </span>
              <Link
                href={`/reports/custom/new?template=${t.id}`}
                className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Usar template
                <ArrowRight className="h-3 w-3" />
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
