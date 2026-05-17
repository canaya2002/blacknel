import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

import { CampaignForm } from '@/components/campaigns/campaign-form';
import { Button } from '@/components/ui/button';
import { requireUser } from '@/lib/auth/server';
import { dbAs } from '@/lib/db/client';
import { authorize } from '@/lib/permissions/can';
import { listBrandOptionsWithTx } from '@/lib/publish/picker-data';

export const dynamic = 'force-dynamic';

/**
 * /publish/campaigns/new — Commit 21.
 *
 * Dedicated page rather than a modal. The form is a Client
 * component (`<CampaignForm mode='create' />`); the page wraps it
 * with the brand picker options + back-link header so it doesn't
 * need to refetch anything.
 *
 * On success the form redirects to the new campaign's detail page
 * via `router.push(/publish/campaigns/[id])`.
 */
export default async function NewCampaignPage(): Promise<React.ReactElement> {
  const session = await requireUser();
  authorize(session.role, 'campaigns:create');

  const brandOptions = await dbAs(
    { orgId: session.orgId, userId: session.userId },
    (tx) => listBrandOptionsWithTx(tx, session.orgId),
  );

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-2 border-b bg-card/30 px-6 py-3">
        <Button asChild size="icon" variant="ghost" className="h-8 w-8">
          <Link href="/publish/campaigns" prefetch={false} aria-label="Volver a campañas">
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Link>
        </Button>
        <div>
          <h1 className="text-base font-semibold tracking-tight">
            Nueva campaña
          </h1>
          <p className="text-xs text-muted-foreground">
            La campaña inicia en estado &ldquo;draft&rdquo;. Puedes activarla
            desde la pestaña de Configuración en su detalle.
          </p>
        </div>
      </header>
      <div className="px-6 pb-8">
        <CampaignForm mode="create" brandOptions={brandOptions} />
      </div>
    </div>
  );
}
