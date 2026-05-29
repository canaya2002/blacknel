'use client';

import { Filter, ListChecks, Plug, Star } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { dynamicRoute } from '@/lib/routes';
import { useTransition } from 'react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/**
 * Three empty-state shapes for /reviews. Each communicates a different
 * situation and the correct next action differs — collapsing them
 * would be a UX regression (Ajuste 5). Copy is verbatim from the
 * approved spec.
 *
 *   1. `EmptyReviewsNoReviews`  → org has never had a review yet.
 *      Action: connect a review platform.
 *   2. `EmptyReviewsNoMatches`  → org has reviews, current filters
 *                                 exclude every one. Action: clear
 *                                 filters.
 *   3. `EmptyReviewsNarrowSlice`→ user explicitly narrowed to a
 *                                 less-common slice (archived, spam,
 *                                 or rating=1) and it's empty. Action:
 *                                 widen ("Ver todas") rather than
 *                                 clear, to keep brand/location scoping.
 */

export function EmptyReviewsNoReviews(): React.ReactElement {
  return (
    <Card className="m-6">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary"
            aria-hidden
          >
            <Star className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-base">Aún no tienes reseñas</CardTitle>
            <CardDescription>
              Conecta Google Business Profile o cualquier plataforma de reseñas en
              /integrations para empezar a recibirlas.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Link href="/integrations">
          <Button size="sm">
            <Plug className="h-3.5 w-3.5" />
            Conectar plataforma de reseñas
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}

export function EmptyReviewsNoMatches(): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const clear = (): void => {
    startTransition(() => {
      router.replace(dynamicRoute(pathname));
    });
  };

  return (
    <Card className="m-6">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-300"
            aria-hidden
          >
            <Filter className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-base">
              No hay reseñas que coincidan con estos filtros.
            </CardTitle>
            <CardDescription>
              Ajusta los criterios o limpia los filtros para ver todas las reseñas.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Button size="sm" onClick={clear} disabled={pending}>
          <Filter className="h-3.5 w-3.5" />
          Limpiar filtros
        </Button>
      </CardContent>
    </Card>
  );
}

interface NarrowSliceProps {
  scopeLabel: string;
}

export function EmptyReviewsNarrowSlice({
  scopeLabel,
}: NarrowSliceProps): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const showAll = (): void => {
    startTransition(() => {
      router.replace(dynamicRoute(pathname));
    });
  };

  return (
    <Card className="m-6">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-md bg-zinc-500/15 text-zinc-700 dark:text-zinc-300"
            aria-hidden
          >
            <ListChecks className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-base">
              No hay reseñas {scopeLabel} en este período.
            </CardTitle>
            <CardDescription>
              Si esperabas ver actividad aquí, prueba abrir el rango o cambiar los
              filtros activos.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Button size="sm" variant="outline" onClick={showAll} disabled={pending}>
          Ver todas
        </Button>
      </CardContent>
    </Card>
  );
}
