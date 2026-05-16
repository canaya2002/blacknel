import Link from 'next/link';
import { Plus } from 'lucide-react';

import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

interface PublishHeaderProps {
  /** True when the caller has `posts:create` AND is below the plan cap. */
  canCreate: boolean;
  /** Result of `checkPostsCap`. The banner reads `current` / `cap` from here. */
  cap: {
    reached: boolean;
    current: number;
    cap: number;
  };
}

/**
 * Header for /publish. Shows either:
 *
 *   - The CTA "Nuevo post" → /publish/composer/new (Commit 19),
 *   - An amber `PlanCapBanner` when `cap.reached`, with a link to
 *     `/billing`. Defense in depth: even if a stale tab kept the CTA
 *     visible, the Server Action gate in `createPostAction` rejects
 *     the request with `PLAN_LIMIT_REACHED`.
 *
 * The CTA is also hidden when `canCreate=false` (e.g. viewer role) —
 * `posts:create` gate in lib/permissions/roles.ts.
 */
export function PublishHeader({ canCreate, cap }: PublishHeaderProps): React.ReactElement {
  const showBanner = cap.reached;
  const showCta = canCreate && !showBanner;

  return (
    <div className="flex flex-col gap-3 px-6 pt-6">
      <PageHeader
        title="Publish"
        description="Composer multi-red con previews por plataforma, calendario mensual y lista, biblioteca de assets, agrupación en campañas y agendado con timezone correcto."
        actions={
          showCta ? (
            <Button asChild>
              <Link href="/publish/composer/new" prefetch={false}>
                <Plus className="h-4 w-4" aria-hidden />
                Nuevo post
              </Link>
            </Button>
          ) : null
        }
      />
      {showBanner ? <PlanCapBanner cap={cap} /> : null}
    </div>
  );
}

function PlanCapBanner({
  cap,
}: {
  cap: { current: number; cap: number };
}): React.ReactElement {
  const capLabel = cap.cap === -1 ? '∞' : String(cap.cap);
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3 text-sm',
        'border-amber-300/60 bg-amber-50 text-amber-900',
        'dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-100',
      )}
    >
      <div className="flex flex-col">
        <span className="font-medium">
          Has usado {cap.current} de {capLabel} posts este mes
        </span>
        <span className="text-xs text-amber-800/80 dark:text-amber-200/80">
          Sube de plan para programar y publicar más contenido sin esperar al
          siguiente período.
        </span>
      </div>
      <Button asChild size="sm" variant="outline" className="border-amber-400/70">
        <Link href="/billing" prefetch={false}>
          Ver opciones de plan
        </Link>
      </Button>
    </div>
  );
}
