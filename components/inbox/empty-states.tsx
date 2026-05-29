'use client';

import { Filter, Inbox as InboxIcon, ListChecks, Plug } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { dynamicRoute } from '@/lib/routes';
import { useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Three explicit empty-state shapes for /inbox. The page picks the
 * right one based on (a) whether the org has any thread at all and
 * (b) whether the current filters are active. The three states
 * communicate fundamentally different things and the right next action
 * is different in each — collapsing them would be a UX regression.
 */

/** No threads in the org ever — needs to wire integrations. */
export function EmptyInboxNoThreads(): React.ReactElement {
  return (
    <Card className="m-6">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary"
            aria-hidden
          >
            <InboxIcon className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-base">Tu inbox está vacío</CardTitle>
            <CardDescription>
              Cuando conectes redes en /integrations, los mensajes aparecerán aquí.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Link href="/integrations">
          <Button size="sm">
            <Plug className="h-3.5 w-3.5" />
            Conectar primera red
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}

/**
 * Org has threads, but the current filter combination matches none.
 * The action is to relax the filters — clearing them all is the safest
 * default. The button mutates the URL via `router.replace`.
 */
export function EmptyInboxNoMatches(): React.ReactElement {
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
            <CardTitle className="text-base">No hay threads que coincidan con estos filtros</CardTitle>
            <CardDescription>
              Ajusta los criterios o limpia los filtros para ver todo el inbox.
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

/**
 * Filters resolve to a less-common slice (e.g. status=closed within a
 * short time window) and that slice has no rows. Distinguished from
 * "no matches" because the user explicitly asked for a narrow cut — the
 * right CTA is "show me everything" rather than "clear", to avoid
 * losing brand/location scoping they probably want to keep.
 */
export function EmptyInboxNarrowSlice({
  scopeLabel,
}: {
  scopeLabel: string;
}): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const showAll = (): void => {
    startTransition(() => {
      // Keep nothing but the path — the parent decides what "scoped"
      // filters to preserve before invoking this component. For Commit 8
      // the simplest default is to clear all and let the user re-scope.
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
              No hay threads {scopeLabel} en este período.
            </CardTitle>
            <CardDescription>
              Si esperabas ver actividad aquí, prueba abriendo el rango — los
              filtros activos pueden estar ocultando lo que buscas.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Button size="sm" variant="outline" onClick={showAll} disabled={pending}>
          Ver todos los threads
        </Button>
      </CardContent>
    </Card>
  );
}
