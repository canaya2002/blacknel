import { and, desc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CustomRoleAuditDiff } from '@/components/team/custom-role-audit-diff';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/server';
import { getCustomRoleByIdWithTx } from '@/lib/custom-roles/queries';
import { dbAs } from '@/lib/db/client';
import {
  auditEvents,
  organizationMembers,
  users,
  type AuditEvent,
} from '@/lib/db/schema';
import { authorize } from '@/lib/permissions/can';
import { planAllowsNamedFeature } from '@/lib/plans/gates';
import { getOrgPlanCode } from '@/lib/queries/plan';

export const dynamic = 'force-dynamic';

interface CustomRoleDetailProps {
  params: Promise<{ id: string }>;
}

/**
 * /team/roles/[id] — Phase 10 / Commit 36b.
 *
 * 5-section detail-page template (doc/PATTERNS.md):
 *   1. PageHeader + status badge + Edit action
 *   2. KPI cards (members assigned, grants, revokes, base_role)
 *   3. Permission summary lists
 *   4. Members assigned table + Audit diff history (Ajuste 2)
 *   5. Footer: archive action
 */
export default async function CustomRoleDetailPage({
  params,
}: CustomRoleDetailProps): Promise<React.ReactElement> {
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

  // Members + audit (parallel single-pass).
  const [members, auditRows] = await Promise.all([
    dbAs<
      Array<{
        memberId: string;
        userId: string;
        email: string;
        name: string | null;
        role: string;
      }>
    >({ orgId: session.orgId, userId: session.userId }, (tx) =>
      tx
        .select({
          memberId: organizationMembers.id,
          userId: organizationMembers.userId,
          email: users.email,
          name: users.name,
          role: organizationMembers.role,
        })
        .from(organizationMembers)
        .innerJoin(users, eq(users.id, organizationMembers.userId))
        .where(
          and(
            eq(organizationMembers.organizationId, session.orgId),
            eq(organizationMembers.customRoleId, id),
          ),
        )
        .limit(50),
    ),
    dbAs<AuditEvent[]>(
      { orgId: session.orgId, userId: session.userId },
      (tx) =>
        tx
          .select()
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.organizationId, session.orgId),
              eq(auditEvents.entityType, 'custom_role'),
              eq(auditEvents.entityId, id),
            ),
          )
          .orderBy(desc(auditEvents.createdAt))
          .limit(20),
    ),
  ]);

  // Resolve actor display names for audit rows.
  const userIds = new Set<string>();
  for (const a of auditRows) if (a.userId) userIds.add(a.userId);
  const actorRows: Array<{ id: string; email: string; name: string | null }> =
    userIds.size === 0
      ? []
      : await dbAs(
          { orgId: session.orgId, userId: session.userId },
          (tx) =>
            tx
              .select({
                id: users.id,
                email: users.email,
                name: users.name,
              })
              .from(users),
        );
  const actorById = new Map(actorRows.map((u) => [u.id, u]));

  return (
    <div
      className="flex flex-col gap-6 px-6 py-6"
      data-testid="custom-role-detail"
    >
      <PageHeader
        title={role.name}
        description={role.description ?? `Base role: ${role.baseRole}`}
        eyebrow={
          <Link href="/team/roles" className="hover:underline">
            ← Volver a Custom Roles
          </Link>
        }
        actions={
          <div className="flex items-center gap-2">
            <span
              className={
                role.status === 'active'
                  ? 'rounded-md border border-emerald-500/40 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : 'rounded-md border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
              }
            >
              {role.status}
            </span>
            <Button asChild size="sm" variant="outline">
              <Link href={`/team/roles/${role.id}/edit`}>Editar</Link>
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <KpiTile label="Members asignados" value={String(role.memberCount)} />
        <KpiTile label="Grants" value={String(role.grants.length)} />
        <KpiTile label="Revokes" value={String(role.revokes.length)} />
        <KpiTile label="Base role" value={role.baseRole} small />
      </div>

      <Card className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
            Grants (+)
          </span>
          {role.grants.length === 0 ? (
            <span className="text-xs italic text-muted-foreground">
              (ninguno — solo permisos base)
            </span>
          ) : (
            <ul className="flex flex-wrap gap-1">
              {role.grants.map((p) => (
                <li
                  key={p}
                  className="rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-xs text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                >
                  {p}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-rose-700 dark:text-rose-300">
            Revokes (−)
          </span>
          {role.revokes.length === 0 ? (
            <span className="text-xs italic text-muted-foreground">
              (ninguno)
            </span>
          ) : (
            <ul className="flex flex-wrap gap-1">
              {role.revokes.map((p) => (
                <li
                  key={p}
                  className="rounded bg-rose-50 px-1.5 py-0.5 font-mono text-xs text-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
                >
                  {p}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <section
        className="flex flex-col gap-2"
        data-testid="custom-role-members"
      >
        <h2 className="text-sm font-semibold">
          Members asignados ({members.length})
        </h2>
        {members.length === 0 ? (
          <Card className="p-4 text-sm text-muted-foreground">
            Nadie tiene este custom role asignado todavía.
          </Card>
        ) : (
          <Card className="divide-y">
            {members.map((m) => (
              <div
                key={m.memberId}
                className="flex items-center justify-between p-3 text-sm"
              >
                <div className="flex flex-col">
                  <span>{m.name ?? m.email}</span>
                  <span className="text-xs text-muted-foreground">
                    {m.email} · base: {m.role}
                  </span>
                </div>
              </div>
            ))}
          </Card>
        )}
      </section>

      <section
        className="flex flex-col gap-2"
        data-testid="custom-role-audit-history"
      >
        <h2 className="text-sm font-semibold">Historial de cambios</h2>
        <CustomRoleAuditDiff
          events={auditRows.map((a) => {
            const actor = a.userId ? actorById.get(a.userId) : null;
            return {
              id: a.id,
              action: a.action,
              actorLabel: actor
                ? actor.name ?? actor.email
                : a.actorType === 'system'
                  ? 'system'
                  : 'unknown',
              createdAt: a.createdAt,
              before: (a.before as Record<string, unknown> | null) ?? null,
              after: (a.after as Record<string, unknown> | null) ?? null,
            };
          })}
        />
      </section>
    </div>
  );
}

function KpiTile({
  label,
  value,
  small,
}: {
  label: string;
  value: string;
  small?: boolean;
}): React.ReactElement {
  return (
    <Card className="flex flex-col gap-1 p-3">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span
        className={
          small
            ? 'text-base font-medium tabular-nums'
            : 'text-2xl font-semibold tabular-nums'
        }
      >
        {value}
      </span>
    </Card>
  );
}
