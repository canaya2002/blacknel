import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { BrandVoiceForm } from '@/components/brand-voice/brand-voice-form';
import { Button } from '@/components/ui/button';
import { requireUser } from '@/lib/auth/server';
import { getBrandVoiceDetail } from '@/lib/brand-voice/queries';
import { dbAs } from '@/lib/db/client';
import { authorize } from '@/lib/permissions/can';
import { and, eq } from 'drizzle-orm';
import { brands } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

const idSchema = z.string().uuid();

interface EditPageProps {
  params: Promise<{ brandId: string }>;
}

export default async function BrandVoiceEditPage({
  params,
}: EditPageProps): Promise<React.ReactElement> {
  const session = await requireUser();
  authorize(session.role, 'brand_voice:manage');

  const { brandId } = await params;
  const parsed = idSchema.safeParse(brandId);
  if (!parsed.success) notFound();

  // Read the brand to know whether it already has a voice.
  const brandRows = await dbAs<
    Array<{ id: string; name: string; brandVoiceId: string | null }>
  >({ orgId: session.orgId, userId: session.userId }, (tx) =>
    tx
      .select({
        id: brands.id,
        name: brands.name,
        brandVoiceId: brands.brandVoiceId,
      })
      .from(brands)
      .where(
        and(eq(brands.id, parsed.data), eq(brands.organizationId, session.orgId)),
      )
      .limit(1),
  );
  const brand = brandRows[0];
  if (!brand) notFound();

  const detail = brand.brandVoiceId
    ? await getBrandVoiceDetail({
        orgId: session.orgId,
        userId: session.userId,
        brandVoiceId: brand.brandVoiceId,
      })
    : null;

  return (
    <div className="flex flex-col">
      <header className="flex items-center gap-3 border-b bg-card/30 px-6 py-3">
        <Button asChild size="icon" variant="ghost" className="h-8 w-8">
          <Link
            href="/settings/brand-voice"
            prefetch={false}
            aria-label="Volver"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Link>
        </Button>
        <div>
          <h1 className="text-base font-semibold tracking-tight">
            {detail ? 'Editar voz de marca' : 'Crear voz de marca'}: {brand.name}
          </h1>
          <p className="text-xs text-muted-foreground">
            Identidad de marca, vocabulario, idiomas habilitados y reglas
            de aprobación.
          </p>
        </div>
      </header>

      <div className="px-6 py-4">
        <BrandVoiceForm brandId={brand.id} initial={detail} />
      </div>
    </div>
  );
}
