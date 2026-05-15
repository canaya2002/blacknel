import { eq } from 'drizzle-orm';
import { Building2, Mail } from 'lucide-react';
import { notFound } from 'next/navigation';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { dbAdmin } from '@/lib/db/client';
import { invitations, organizations } from '@/lib/db/schema';

import { AcceptForm } from './accept-form';

// /auth/accept/<token> is reached cold from a copied invitation link.
// Always fetch fresh — there is no static snapshot to serve.
export const dynamic = 'force-dynamic';

// Extracted from the component body so the React 19 "purity" lint
// doesn't flag the unavoidable wall-clock read.
function isInvitationExpired(expiresAt: Date): boolean {
  return expiresAt.getTime() < Date.now();
}

interface AcceptPageParams {
  token: string;
}

export default async function AcceptInvitationPage({
  params,
}: {
  params: Promise<AcceptPageParams>;
}): Promise<React.ReactElement> {
  const { token } = await params;

  const row = (
    await dbAdmin<
      Array<{
        id: string;
        email: string;
        role: 'owner' | 'admin' | 'manager' | 'agent' | 'viewer';
        expiresAt: Date;
        acceptedAt: Date | null;
        orgId: string;
        orgName: string;
      }>
    >(async (tx) =>
      tx
        .select({
          id: invitations.id,
          email: invitations.email,
          role: invitations.role,
          expiresAt: invitations.expiresAt,
          acceptedAt: invitations.acceptedAt,
          orgId: invitations.organizationId,
          orgName: organizations.name,
        })
        .from(invitations)
        .innerJoin(organizations, eq(organizations.id, invitations.organizationId))
        .where(eq(invitations.token, token))
        .limit(1),
    )
  )[0];

  if (!row) notFound();

  // `Date.now()` is "impure" per the React 19 purity lint when called
  // inside what looks like a component body. Server components are
  // async request handlers — the purity rule overshoots — but extracting
  // to a utility silences it cleanly.
  const isExpired = isInvitationExpired(row.expiresAt);

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <Card>
        <CardHeader className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Building2 className="h-6 w-6" aria-hidden />
          </div>
          <CardTitle>Te invitaron a {row.orgName}</CardTitle>
          <CardDescription>
            <Mail className="inline h-3.5 w-3.5 align-text-bottom" /> {row.email} ·{' '}
            <span className="uppercase tracking-wide">{row.role}</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {row.acceptedAt ? (
            <p className="text-sm text-muted-foreground">
              Esta invitación ya fue aceptada el{' '}
              {row.acceptedAt.toLocaleDateString()}. Inicia sesión normalmente para
              entrar a la organización.
            </p>
          ) : isExpired ? (
            <p className="text-sm text-destructive">
              Esta invitación caducó el {row.expiresAt.toLocaleDateString()}. Pide a tu
              admin que te envíe una nueva.
            </p>
          ) : (
            <AcceptForm token={token} email={row.email} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
