import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CustomRoleForm } from '@/components/team/custom-role-form';
import { PageHeader } from '@/components/common/page-header';
import { requireUser } from '@/lib/auth/server';
import { getCustomRoleByIdWithTx } from '@/lib/custom-roles/queries';
import { dbAs } from '@/lib/db/client';
import { authorize } from '@/lib/permissions/can';
import type { Permission } from '@/lib/permissions/roles';
import { planAllowsNamedFeature } from '@/lib/plans/gates';
import { getOrgPlanCode } from '@/lib/queries/plan';

export const dynamic = 'force-dynamic';

interface EditPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditCustomRolePage({
  params,
}: EditPageProps): Promise<React.ReactElement> {
  const session = await requireUser();
  authorize(session.role, 'team:manage_roles');

  const plan = await getOrgPlanCode(session);
  if (!planAllowsNamedFeature(plan, 'custom_roles')) {
    notFound();
  }

  const { id } = await params;
  const role = await dbAs(
    { orgId: session.orgId, userId: session.userId },
    (tx) => getCustomRoleByIdWithTx(tx, session.orgId, id),
  );
  if (!role) {
    notFound();
  }
  if (role.baseRole === 'owner') {
    notFound();
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-6">
      <PageHeader
        title={`Editar: ${role.name}`}
        description="Cambios crean entry en audit log con before/after diff."
        eyebrow={
          <Link
            href={`/team/roles/${role.id}`}
            className="hover:underline"
          >
            ← Volver al detalle
          </Link>
        }
      />
      <CustomRoleForm
        mode="edit"
        initial={{
          id: role.id,
          name: role.name,
          description: role.description,
          baseRole: role.baseRole as Exclude<typeof role.baseRole, 'owner'>,
          // grants/revokes stored as text[] in DB; the picker
          // only renders entries that survive the Permission
          // whitelist on save (Zod re-validates).
          grants: role.grants as unknown as ReadonlyArray<Permission>,
          revokes: role.revokes as unknown as ReadonlyArray<Permission>,
        }}
      />
    </div>
  );
}
