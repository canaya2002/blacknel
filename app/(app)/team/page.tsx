import { eq } from 'drizzle-orm';
import { Users } from 'lucide-react';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { requireUser } from '@/lib/auth/server';
import { dbAs } from '@/lib/db/client';
import { organizationMembers, users as usersTable } from '@/lib/db/schema';
import type { Role } from '@/lib/permissions/roles';
import { cn } from '@/lib/utils/cn';

const ROLE_TONE: Record<Role, string> = {
  owner: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  admin: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  manager: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  agent: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  viewer: 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
};

interface MemberRow {
  userId: string;
  email: string;
  name: string | null;
  role: Role;
}

export default async function TeamPage(): Promise<React.ReactElement> {
  const session = await requireUser();

  const members = await dbAs<MemberRow[]>(
    { orgId: session.orgId, userId: session.userId },
    async (tx) =>
      tx
        .select({
          userId: organizationMembers.userId,
          email: usersTable.email,
          name: usersTable.name,
          role: organizationMembers.role,
        })
        .from(organizationMembers)
        .innerJoin(usersTable, eq(usersTable.id, organizationMembers.userId))
        .orderBy(usersTable.name),
  );

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Team"
        description="Invita compañeros con roles claros — owner, admin, manager, agent, viewer — y limita lo que cada uno puede ver y hacer. Los permisos siguen el rol asignado a esta organización."
        actions={
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button disabled>Invitar a alguien</Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Las invitaciones llegan en la Fase 2 con el flujo de onboarding.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        }
      />
      {members.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No hay miembros aún"
          description="Tu organización todavía no tiene miembros. Las invitaciones llegan en la Fase 2 — hasta entonces, los usuarios del seed pueden impersonarse desde /login."
          primary={{
            label: 'Invitar primer compañero',
            disabledReason: 'Invitaciones disponibles en la Fase 2',
          }}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {members.map((m) => (
            <Card key={m.userId}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{m.name ?? m.email}</CardTitle>
                    <CardDescription className="text-xs">{m.email}</CardDescription>
                  </div>
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                      ROLE_TONE[m.role],
                    )}
                  >
                    {m.role}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Permisos derivados del rol. La gestión granular llega en la Fase 10.
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
