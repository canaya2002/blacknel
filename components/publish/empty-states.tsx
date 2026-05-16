import { CalendarOff, CheckCircle2, FilterX, Send } from 'lucide-react';

import { EmptyState } from '@/components/common/empty-state';
import type { PublishView } from '@/lib/publish/filters';

/**
 * Centralized empty-state surface for /publish. Three variants:
 *
 *   - `NoPostsAtAll`  — org has zero posts AND no filters applied.
 *   - `NoMatches`     — at least one filter is active and there are
 *                       no matches.
 *   - `TabClean`      — tab-specific zero state (e.g. `failed` tab
 *                       with no failed posts: "todos al día").
 *
 * The parent page picks the right one based on
 * `posts.length === 0` × `hasActiveFilters(filters)`.
 */

export function NoPostsAtAll(): React.ReactElement {
  return (
    <div className="px-6 py-6">
      <EmptyState
        icon={Send}
        title="Aún no has creado posts"
        description="Cuando crees tu primer post, lo verás aquí. Programa contenido para Facebook, Instagram, GBP, TikTok, LinkedIn y más desde un solo composer."
        primary={{
          label: 'Crear primer post',
          href: '/publish/composer/new',
          disabledReason: 'El composer multi-red llega en Commit 19.',
        }}
      />
    </div>
  );
}

export function NoMatches(): React.ReactElement {
  return (
    <div className="px-6 py-6">
      <EmptyState
        icon={FilterX}
        title="Sin coincidencias"
        description="Ningún post coincide con los filtros actuales. Ajusta los filtros o limpia la búsqueda para ver más resultados."
      />
    </div>
  );
}

interface TabCleanProps {
  view: PublishView;
}

export function TabClean({ view }: TabCleanProps): React.ReactElement {
  const spec = TAB_CLEAN_COPY[view];
  return (
    <div className="px-6 py-6">
      <EmptyState
        icon={spec.icon}
        title={spec.title}
        description={spec.description}
      />
    </div>
  );
}

const TAB_CLEAN_COPY: Readonly<
  Record<
    PublishView,
    { icon: typeof Send; title: string; description: string }
  >
> = {
  calendar: {
    icon: CalendarOff,
    title: 'Mes vacío',
    description: 'No hay posts en este mes con los filtros actuales.',
  },
  drafts: {
    icon: Send,
    title: 'Sin borradores',
    description: 'Todos los posts están programados, publicados o ya cerrados. Crea uno nuevo cuando estés listo.',
  },
  scheduled: {
    icon: CalendarOff,
    title: 'Sin posts agendados',
    description: 'Cuando programes contenido para publicar a futuro, lo verás aquí.',
  },
  published: {
    icon: CheckCircle2,
    title: 'Aún no has publicado',
    description: 'Los posts marcados como publicados aparecerán aquí con su rendimiento.',
  },
  failed: {
    icon: CheckCircle2,
    title: 'Todos al día',
    description: 'Sin fallas recientes. Si algún post falla al publicarse, lo verás aquí con la razón para reintentarlo.',
  },
};
