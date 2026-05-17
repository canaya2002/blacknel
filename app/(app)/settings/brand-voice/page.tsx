import Link from 'next/link';
import { Megaphone, Pencil, Plus } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/server';
import { listBrandsWithVoice } from '@/lib/brand-voice/queries';
import { authorize } from '@/lib/permissions/can';

export const dynamic = 'force-dynamic';

/**
 * /settings/brand-voice — Commit 26.
 *
 * Lists every brand in the org with the paired voice profile (or
 * an empty-state "Create voice" CTA when the brand has none).
 * Manager+/admin/owner can edit; agents and viewers see a
 * 403-style FORBIDDEN before this page renders.
 *
 * Each row links to `/settings/brand-voice/[brandId]/edit` —
 * that route handles both create (when no voice exists) and
 * update (when one does).
 */
export default async function BrandVoiceIndexPage(): Promise<React.ReactElement> {
  const session = await requireUser();
  authorize(session.role, 'brand_voice:manage');

  const brands = await listBrandsWithVoice({
    orgId: session.orgId,
    userId: session.userId,
  });

  return (
    <div className="flex flex-col">
      <header className="border-b bg-card/30 px-6 py-3">
        <h1 className="text-base font-semibold tracking-tight">
          Brand Voice
        </h1>
        <p className="text-xs text-muted-foreground">
          Tono, vocabulario y reglas de aprobación por cada marca de tu
          organización. La IA del composer y la cola de aprobación leen
          de aquí.
        </p>
      </header>

      <div className="flex flex-col gap-3 px-6 py-4">
        {brands.length === 0 ? (
          <Card className="border-dashed bg-card/30">
            <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
              <Megaphone className="h-6 w-6 text-muted-foreground" aria-hidden />
              <p className="text-sm font-medium">Sin marcas configuradas</p>
              <p className="max-w-md text-xs text-muted-foreground">
                Cada marca lleva su propia voz. Crea una marca desde la
                configuración general antes de definir su voz.
              </p>
            </CardContent>
          </Card>
        ) : (
          brands.map((b) => (
            <Card key={b.brandId} className="border bg-card/30">
              <CardContent className="flex flex-wrap items-center gap-3 p-4">
                <div className="flex flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{b.brandName}</span>
                    {b.brandVoiceId ? (
                      <Badge variant="muted" className="text-[10px] uppercase">
                        Con voz: {b.voiceName ?? '—'}
                      </Badge>
                    ) : (
                      <Badge
                        variant="muted"
                        className="text-[10px] uppercase text-muted-foreground"
                      >
                        Sin voz definida
                      </Badge>
                    )}
                    {b.approvalRulesActive ? (
                      <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200 text-[10px]">
                        Reglas de aprobación activas
                      </Badge>
                    ) : null}
                  </div>
                  {b.tone ? (
                    <p className="text-xs text-muted-foreground">
                      Tono: {b.tone}
                    </p>
                  ) : null}
                  {b.languages.length > 0 ? (
                    <p className="text-[11px] text-muted-foreground">
                      Idiomas: {b.languages.join(', ')}
                    </p>
                  ) : null}
                </div>
                <Button asChild size="sm" variant={b.brandVoiceId ? 'outline' : 'default'}>
                  <Link
                    href={`/settings/brand-voice/${b.brandId}/edit`}
                    prefetch={false}
                  >
                    {b.brandVoiceId ? (
                      <>
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                        Editar
                      </>
                    ) : (
                      <>
                        <Plus className="h-3.5 w-3.5" aria-hidden />
                        Crear voz
                      </>
                    )}
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
