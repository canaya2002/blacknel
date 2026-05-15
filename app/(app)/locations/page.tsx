import { eq } from 'drizzle-orm';
import { MapPin } from 'lucide-react';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/server';
import { dbAs } from '@/lib/db/client';
import { brands, locations } from '@/lib/db/schema';

export default async function LocationsPage(): Promise<React.ReactElement> {
  const session = await requireUser();

  const rows = await dbAs<
    Array<{
      id: string;
      name: string;
      city: string | null;
      country: string | null;
      brandName: string;
    }>
  >({ orgId: session.orgId, userId: session.userId }, async (tx) =>
    tx
      .select({
        id: locations.id,
        name: locations.name,
        city: locations.city,
        country: locations.country,
        brandName: brands.name,
      })
      .from(locations)
      .leftJoin(brands, eq(locations.brandId, brands.id))
      .orderBy(locations.name),
  );

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Locations"
        description="Cada ubicación física o lógica de tu negocio. Filtra reseñas, inbox y reportes por sucursal; asigna responsables por ubicación; conecta el GBP correspondiente a cada una."
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title="Aún no tienes ubicaciones"
          description="Las ubicaciones agrupan reseñas, GBP y métricas por sucursal. Esencial cuando una marca opera en varias ciudades — la página de Reputación compara entre ellas automáticamente."
          primary={{
            label: 'Agregar ubicación',
            disabledReason: 'El CRUD de ubicaciones aterriza en la Fase 2',
          }}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((loc) => (
            <Card key={loc.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{loc.name}</CardTitle>
                  <Badge variant="muted">{loc.brandName}</Badge>
                </div>
                <CardDescription>
                  {[loc.city, loc.country].filter(Boolean).join(', ') || 'Sin dirección'}
                </CardDescription>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                GBP, asignaciones y horarios — disponibles en la Fase 2.
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
