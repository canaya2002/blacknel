import { eq } from 'drizzle-orm';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { dbAdmin } from '@/lib/db/client';
import {
  organizationMembers,
  organizations as orgsTable,
  users as usersTable,
} from '@/lib/db/schema';
import type { Role } from '@/lib/permissions/roles';

import { LoginForm } from './login-form';

// /login lists the seeded users — the row set lives in pglite, which only
// exists at request time. Skip SSG.
export const dynamic = 'force-dynamic';

interface SeedAccount {
  userId: string;
  orgId: string;
  orgName: string;
  email: string;
  name: string;
  role: Role;
}

/**
 * Dev-only impersonation login. Lists every (user × organization) row
 * in the local pglite. Selecting one signs a session cookie via the
 * Server Action and bounces the user into the app.
 *
 * Phase 11 replaces this page entirely with Supabase Auth's magic-link
 * sign-in. The interface (cookie + getSession) stays — only the
 * issuer changes.
 */
export default async function LoginPage(): Promise<React.ReactElement> {
  const rows = await dbAdmin<SeedAccount[]>(async (tx) =>
    tx
      .select({
        userId: organizationMembers.userId,
        orgId: organizationMembers.organizationId,
        orgName: orgsTable.name,
        email: usersTable.email,
        name: usersTable.name,
        role: organizationMembers.role,
      })
      .from(organizationMembers)
      .innerJoin(usersTable, eq(usersTable.id, organizationMembers.userId))
      .innerJoin(orgsTable, eq(orgsTable.id, organizationMembers.organizationId))
      .orderBy(usersTable.name),
  );

  return (
    <section className="mx-auto flex max-w-md flex-col gap-6 px-6 py-16">
      <div className="flex flex-col gap-2">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Phase 1 · dev impersonation
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Selecciona uno de los usuarios del seed para entrar. Los magic links reales se
          activan en la Fase 11 con Supabase Auth — hasta entonces el cookie se firma
          localmente y todos los datos viven en{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            .blacknel/pglite-data/
          </code>
          .
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cuentas del seed</CardTitle>
          <CardDescription>
            Cada cuenta lleva un rol distinto para que pruebes los gates de permisos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm
            accounts={rows.map((r) => ({
              ...r,
              name: r.name ?? r.email,
            }))}
          />
        </CardContent>
      </Card>
    </section>
  );
}
