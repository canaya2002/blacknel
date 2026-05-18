import { eq } from 'drizzle-orm';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { dbAdmin } from '@/lib/db/client';
import {
  organizationMembers,
  organizations as orgsTable,
  users as usersTable,
} from '@/lib/db/schema';
import { env } from '@/lib/env';
import type { Role } from '@/lib/permissions/roles';

import { startFreshAccountAction } from './actions';
import { LoginForm } from './login-form';
import { MagicLinkForm } from './magic-link-form';

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
 * Login page. Branches by `BLACKNEL_USE_REAL_AUTH`:
 *
 *   false → dev impersonation (Phase 1-10): list seeded users +
 *           "fresh account" shortcut.
 *   true  → magic-link sign-in (Phase 11 / C42a): single email input,
 *           Supabase sends the link, callback handler exchanges code
 *           for session.
 *
 * The DB query that builds the seed account list only runs in the mock
 * branch — under real auth the page is static aside from the form.
 */
export default async function LoginPage(): Promise<React.ReactElement> {
  if (env.BLACKNEL_USE_REAL_AUTH) {
    return (
      <section className="mx-auto flex max-w-md flex-col gap-6 px-6 py-16">
        <div className="flex flex-col gap-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Blacknel · acceso
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">Inicia sesión</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Ingresa tu correo y te enviaremos un enlace para entrar. No
            necesitas contraseña — el link expira en 1 hora y solo
            funciona desde tu bandeja.
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Enlace mágico</CardTitle>
            <CardDescription>
              Si es tu primera vez, te crearemos la cuenta al confirmar
              el correo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MagicLinkForm />
          </CardContent>
        </Card>
      </section>
    );
  }

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
      <Card>
        <CardHeader>
          <CardTitle className="text-base">¿Sin cuenta?</CardTitle>
          <CardDescription>
            Crea una cuenta nueva en blanco para probar el flujo de onboarding —
            organización, plan, marca, ubicación y equipo. Ideal para QA.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={startFreshAccountAction}>
            <Button type="submit" variant="outline" className="w-full">
              Empezar como nuevo usuario
            </Button>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
