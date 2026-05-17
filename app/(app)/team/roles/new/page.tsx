import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CustomRoleForm } from '@/components/team/custom-role-form';
import { PageHeader } from '@/components/common/page-header';
import { Card } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/server';
import { ROLE_TEMPLATES } from '@/lib/custom-roles/templates';
import { authorize } from '@/lib/permissions/can';
import { planAllowsNamedFeature } from '@/lib/plans/gates';
import { getOrgPlanCode } from '@/lib/queries/plan';

export const dynamic = 'force-dynamic';

interface NewRolePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * /team/roles/new — Phase 10 / Commit 36b · D-36b-1 wizard.
 *
 * Tabs (URL-driven via `?template=`):
 *
 *   - templates list (default landing) — 3 commercially-typical
 *     templates from `lib/custom-roles/templates.ts`.
 *   - `?template=brand_manager|regional_director|readonly_analyst`
 *     loads the picker pre-filled with that template's grants /
 *     revokes.
 *   - `?template=blank` loads the picker empty.
 */
export default async function NewCustomRolePage({
  searchParams,
}: NewRolePageProps): Promise<React.ReactElement> {
  const session = await requireUser();
  authorize(session.role, 'team:manage_roles');

  const plan = await getOrgPlanCode(session);
  if (!planAllowsNamedFeature(plan, 'custom_roles')) {
    notFound();
  }

  const sp = await searchParams;
  const templateId = typeof sp.template === 'string' ? sp.template : null;
  const template = templateId
    ? ROLE_TEMPLATES.find((t) => t.id === templateId) ?? null
    : null;
  const isBlank = templateId === 'blank';

  if (!templateId) {
    // Landing — show the three template cards + blank option.
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-6">
        <PageHeader
          title="Nuevo custom role"
          description="Empezá desde una plantilla común o construí desde cero. Los permisos siempre se pueden editar después."
          eyebrow={
            <Link href="/team/roles" className="hover:underline">
              ← Volver a Custom Roles
            </Link>
          }
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {ROLE_TEMPLATES.map((t) => (
            <Card
              key={t.id}
              className="flex flex-col gap-2 p-4"
              data-testid={`template-${t.id}`}
            >
              <h3 className="text-sm font-semibold">{t.label}</h3>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t.description}
              </p>
              <div className="text-[10px] text-muted-foreground">
                <span className="rounded bg-muted/50 px-1.5 py-0.5">
                  base: {t.baseRole}
                </span>
                {t.grants.length > 0 ? (
                  <span className="ml-1 rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                    +{t.grants.length} grants
                  </span>
                ) : null}
                {t.revokes.length > 0 ? (
                  <span className="ml-1 rounded bg-rose-50 px-1.5 py-0.5 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                    −{t.revokes.length} revokes
                  </span>
                ) : null}
              </div>
              <Link
                href={`/team/roles/new?template=${t.id}`}
                className="mt-2 inline-block rounded-md border border-primary bg-primary px-3 py-1.5 text-center text-xs font-medium text-primary-foreground hover:opacity-90"
              >
                Usar plantilla
              </Link>
            </Card>
          ))}
          <Card
            className="flex flex-col justify-between gap-2 p-4"
            data-testid="template-blank"
          >
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Empezar desde cero</h3>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Sin grants ni revokes. Picker en blanco — vos definís
                todos los permisos. Recomendado solo si ninguna plantilla
                encaja.
              </p>
            </div>
            <Link
              href="/team/roles/new?template=blank"
              className="mt-2 inline-block rounded-md border px-3 py-1.5 text-center text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Empezar en blanco
            </Link>
          </Card>
        </div>
      </div>
    );
  }

  // Template selected (or blank). Load the form.
  const initial = template
    ? {
        name: template.suggestedName,
        description: null,
        baseRole: template.baseRole,
        grants: template.grants,
        revokes: template.revokes,
      }
    : isBlank
      ? {
          name: '',
          description: null,
          baseRole: 'manager' as const,
          grants: [] as ReadonlyArray<never>,
          revokes: [] as ReadonlyArray<never>,
        }
      : null;
  if (!initial) {
    notFound();
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-6">
      <PageHeader
        title="Nuevo custom role"
        description="Ajustá nombre y permisos. Click en cada permission para cambiar entre base / grant / revoke."
        eyebrow={
          <Link href="/team/roles/new" className="hover:underline">
            ← Cambiar plantilla
          </Link>
        }
      />
      <CustomRoleForm mode="create" initial={initial} template={template} />
    </div>
  );
}
