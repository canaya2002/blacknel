import { and, eq, gt } from 'drizzle-orm';
import { Users } from 'lucide-react';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { InviteDialog } from '@/components/team/invite-dialog';
import { MemberActions } from '@/components/team/member-actions';
import { PendingInvitations } from '@/components/team/pending-invitations';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/server';
import { dbAs } from '@/lib/db/client';
import { invitations, organizationMembers, users as usersTable } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { invitationAcceptUrl } from '@/lib/invitations/tokens';
import { sessionCan } from '@/lib/permissions/can';
import type { Role } from '@/lib/permissions/roles';
import { cn } from '@/lib/utils/cn';

const ROLE_TONE: Record<Role, string> = {
  owner: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  admin: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  manager: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  agent: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  viewer: 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
};

const ASSIGNABLE_BY_ROLE: Record<Role, ReadonlyArray<Role>> = {
  owner: ['owner', 'admin', 'manager', 'agent', 'viewer'],
  admin: ['admin', 'manager', 'agent', 'viewer'],
  manager: [],
  agent: [],
  viewer: [],
};

interface MemberRow {
  userId: string;
  email: string;
  name: string | null;
  role: Role;
  joinedAt: Date | null;
}

interface PendingInviteRow {
  id: string;
  email: string;
  role: Role;
  token: string;
  expiresAt: Date;
}

export default async function TeamPage(): Promise<React.ReactElement> {
  const session = await requireUser();
  const ctx = { orgId: session.orgId, userId: session.userId };

  const [members, pending] = await Promise.all([
    dbAs<MemberRow[]>(ctx, async (tx) =>
      tx
        .select({
          userId: organizationMembers.userId,
          email: usersTable.email,
          name: usersTable.name,
          role: organizationMembers.role,
          joinedAt: organizationMembers.joinedAt,
        })
        .from(organizationMembers)
        .innerJoin(usersTable, eq(usersTable.id, organizationMembers.userId))
        .where(eq(organizationMembers.organizationId, session.orgId))
        .orderBy(usersTable.name),
    ),
    dbAs<PendingInviteRow[]>(ctx, async (tx) =>
      tx
        .select({
          id: invitations.id,
          email: invitations.email,
          role: invitations.role,
          token: invitations.token,
          expiresAt: invitations.expiresAt,
        })
        .from(invitations)
        .where(
          and(
            eq(invitations.organizationId, session.orgId),
            gt(invitations.expiresAt, new Date()),
          ),
        )
        .orderBy(invitations.expiresAt),
    ),
  ]);

  const ownersTotal = members.filter((m) => m.role === 'owner').length;
  const canInvite = sessionCan(session, 'team:invite');
  const canManageRoles = sessionCan(session, 'team:manage_roles');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Team"
        description="Invita compañeros con roles claros — owner, admin, manager, agent, viewer — y limita lo que cada uno puede ver y hacer. Los permisos siguen el rol asignado a esta organización."
        actions={canInvite ? <InviteDialog /> : null}
      />

      <PendingInvitations
        invitations={pending.map((p) => ({
          id: p.id,
          email: p.email,
          role: p.role,
          link: invitationAcceptUrl(env.NEXT_PUBLIC_APP_URL, p.token),
          expiresAt: p.expiresAt.toISOString(),
        }))}
      />

      {members.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No hay miembros aún"
          description="Tu organización todavía no tiene miembros. Invita a tu primer compañero para empezar."
          primary={
            canInvite
              ? { label: 'Invitar a alguien' }
              : { label: 'Invitar a alguien', disabledReason: 'Tu rol no permite invitar.' }
          }
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Miembros ({members.length})</CardTitle>
            <CardDescription>
              Los permisos se derivan del rol. Por convención, sólo los owners
              pueden gestionar billing.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col divide-y">
            {members.map((m) => {
              const isSelf = m.userId === session.userId;
              const isLastOwner = m.role === 'owner' && ownersTotal === 1;
              const assignable = canManageRoles
                ? ASSIGNABLE_BY_ROLE[session.role].filter((r) => {
                    // Self can't demote out of owner if they're the last owner.
                    if (isSelf && isLastOwner && r !== 'owner') return false;
                    return true;
                  })
                : [];
              return (
                <div
                  key={m.userId}
                  className="flex items-center gap-4 py-3 first:pt-0 last:pb-0"
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {m.name ?? m.email}
                      </span>
                      {isSelf ? (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          Tú
                        </span>
                      ) : null}
                    </div>
                    <span className="text-xs text-muted-foreground">{m.email}</span>
                    {m.joinedAt ? (
                      <span className="mt-0.5 text-[10px] text-muted-foreground">
                        Se unió {m.joinedAt.toLocaleDateString()}
                      </span>
                    ) : null}
                  </div>
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                      ROLE_TONE[m.role],
                    )}
                  >
                    {m.role}
                  </span>
                  {canManageRoles ? (
                    <MemberActions
                      member={{
                        userId: m.userId,
                        name: m.name ?? m.email,
                        email: m.email,
                        role: m.role,
                      }}
                      assignableRoles={assignable}
                      canRemove={!isLastOwner && !isSelf}
                      isLastOwner={isLastOwner}
                    />
                  ) : null}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
