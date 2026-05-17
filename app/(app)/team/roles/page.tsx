import { Shield } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/server';
import {
  countCustomRolesByOrg,
  listCustomRoles,
} from '@/lib/custom-roles/queries';
import { authorize } from '@/lib/permissions/can';
import { planAllowsNamedFeature } from '@/lib/plans/gates';
import { getPlan } from '@/lib/plans/plans';
import { getOrgPlanCode } from '@/lib/queries/plan';

export const dynamic = 'force-dynamic';

/**
 * /team/roles — Phase 10 / Commit 36b.
 *
 * List of custom roles with KPI header (count / cap). Wizard CTA
 * lives in the page actions slot.
 */
export default async function CustomRolesListPage(): Promise<React.ReactElement> {
  const session = await requireUser();
  authorize(session.role, 'team:manage_roles');

  const plan = await getOrgPlanCode(session);
  if (!planAllowsNamedFeature(plan, 'custom_roles')) {
    notFound();
  }

  const [roles, activeCount] = await Promise.all([
    listCustomRoles({ orgId: session.orgId, userId: session.userId }),
    countCustomRolesByOrg({
      orgId: session.orgId,
      userId: session.userId,
      status: 'active',
    }),
  ]);
  const cap = getPlan(plan).limits.maxCustomRoles;
  const capLabel = cap < 0 ? '∞' : String(cap);

  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      <PageHeader
        title="Custom Roles"
        description="Roles personalizados con grants y revokes sobre los 5 default roles. Owner es singleton y NO se puede usar como base."
        actions={
          <div className="flex items-center gap-3">
            <span
              className="rounded-md border bg-muted/40 px-2 py-1 font-mono text-xs"
              data-testid="custom-role-cap"
            >
              {activeCount} / {capLabel} activos
            </span>
            <Button asChild size="sm">
              <Link href="/team/roles/new">Nuevo custom role</Link>
            </Button>
          </div>
        }
      />

      {roles.length === 0 ? (
        <EmptyState
          icon={Shield}
          title="Sin custom roles todavía"
          description="Empezá con una plantilla (Brand Manager, Regional Director, Read-only Analyst) o construí uno desde cero."
          primary={{
            label: 'Crear primer custom role',
            href: '/team/roles/new',
          }}
        />
      ) : (
        <Card className="divide-y">
          {roles.map((r) => (
            <div
              key={r.id}
              className="flex flex-col gap-1 p-4 sm:flex-row sm:items-center sm:justify-between"
              data-testid={`custom-role-row-${r.id}`}
            >
              <div className="flex flex-col gap-0.5">
                <Link
                  href={`/team/roles/${r.id}`}
                  className="text-sm font-semibold hover:underline"
                >
                  {r.name}
                </Link>
                <span className="text-xs text-muted-foreground">
                  base: <code className="font-mono">{r.baseRole}</code> ·{' '}
                  +{r.grants.length} grants · −{r.revokes.length} revokes
                </span>
                <span className="text-xs text-muted-foreground">
                  {r.memberCount} member{r.memberCount === 1 ? '' : 's'} asignado
                  {r.memberCount === 1 ? '' : 's'}
                </span>
              </div>
              <span
                className={
                  r.status === 'active'
                    ? 'rounded-md border border-emerald-500/40 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                    : 'rounded-md border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
                }
              >
                {r.status}
              </span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
