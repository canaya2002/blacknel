'use client';

import { CheckCircle2, Filter, ListChecks } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { dynamicRoute } from '@/lib/routes';
import { useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Three explicit empty-state variants for /approvals, matching the
 * shape used by /inbox:
 *
 *   - QueueClear   → no pending/escalated approvals waiting. CTA: see
 *                    decided history (status filter switch).
 *   - NoMatches    → user-filtered combination yielded nothing. CTA:
 *                    clear filters.
 *   - NarrowSlice  → filters resolved to a less-common slice (e.g.
 *                    decided history). CTA: back to pending defaults.
 */

export function EmptyApprovalsQueueClear(): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const seeDecided = (): void => {
    startTransition(() => {
      router.replace(
        dynamicRoute(`${pathname}?status=approved,rejected,edited_approved`),
      );
    });
  };
  return (
    <Card className="m-6">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
            aria-hidden
          >
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-base">Sin aprobaciones pendientes</CardTitle>
            <CardDescription>
              Cuando un agente envíe una respuesta marcada por compliance, o
              cuando un manager solicite revisión, aparecerá aquí con todo el
              contexto.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Button size="sm" variant="outline" onClick={seeDecided} disabled={pending}>
          Ver decididas
        </Button>
      </CardContent>
    </Card>
  );
}

export function EmptyApprovalsNoMatches(): React.ReactElement {
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
              No hay aprobaciones que coincidan con estos filtros
            </CardTitle>
            <CardDescription>
              Ajusta los criterios o vuelve al filtro por defecto para ver lo
              accionable.
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

export function EmptyApprovalsNarrowSlice({
  scopeLabel,
}: {
  scopeLabel: string;
}): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const backToPending = (): void => {
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
              No hay aprobaciones {scopeLabel}.
            </CardTitle>
            <CardDescription>
              Vuelve a la cola pendiente para ver lo que requiere acción ahora.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Button size="sm" variant="outline" onClick={backToPending} disabled={pending}>
          Ver pendientes
        </Button>
      </CardContent>
    </Card>
  );
}
