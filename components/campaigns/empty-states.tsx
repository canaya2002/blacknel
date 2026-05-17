import Link from 'next/link';
import { FlaskConical, Plus, SearchX } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface CampaignsEmptyStateProps {
  hasFilters: boolean;
  canCreate: boolean;
}

/**
 * Two flavors. `hasFilters=true` → "no matches" (offers a clear).
 * `hasFilters=false` → "no campaigns at all" (offers a CTA when
 * the user has the permission). Same shape as the inbox / reviews
 * empty states.
 */
export function CampaignsEmptyState({
  hasFilters,
  canCreate,
}: CampaignsEmptyStateProps): React.ReactElement {
  if (hasFilters) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-card/30 px-6 py-12 text-center">
        <SearchX className="h-6 w-6 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-semibold tracking-tight">Sin resultados</h2>
        <p className="max-w-sm text-xs text-muted-foreground">
          Ninguna campaña coincide con los filtros actuales. Ajusta los
          criterios o limpia los filtros para ver todas las campañas.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-card/30 px-6 py-12 text-center">
      <FlaskConical className="h-6 w-6 text-muted-foreground" aria-hidden />
      <h2 className="text-sm font-semibold tracking-tight">Sin campañas</h2>
      <p className="max-w-sm text-xs text-muted-foreground">
        Las campañas agrupan posts en torno a un objetivo (lanzamiento,
        promoción, evergreen). Crea la primera para empezar a categorizar
        tu publicación.
      </p>
      {canCreate ? (
        <Button asChild size="sm" className="mt-2">
          <Link href="/publish/campaigns/new" prefetch={false}>
            <Plus className="h-4 w-4" aria-hidden />
            Nueva campaña
          </Link>
        </Button>
      ) : null}
    </div>
  );
}
