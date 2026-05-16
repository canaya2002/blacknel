import Link from 'next/link';
import { AlertTriangle, PlusCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface NewPostCtaProps {
  /** Does the current role hold `posts:create`? When false, nothing renders. */
  canCreate: boolean;
  /** Current postsPerMonth value for the org. */
  current: number;
  /** Plan cap (-1 for unlimited / enterprise). */
  cap: number;
  /** Has the org already hit the cap for the current period? */
  reached: boolean;
}

/**
 * The header CTA on /publish (Section A + B).
 *
 * Three branches:
 *
 *   1. The role lacks `posts:create` → render nothing. The user
 *      shouldn't even see the affordance; viewing-only stakeholders
 *      browse the calendar without a create button at all.
 *
 *   2. The org has hit `postsPerMonth` for the current period →
 *      render the amber banner pointing at /billing. This is the
 *      *only* state where the composer entry is hidden behind a
 *      payment gate. Drafts can still be saved through the
 *      composer once Commit 19 lands — only schedule/approval
 *      consumes the budget — but the bare "Nuevo post" CTA is
 *      replaced so the user understands why scheduling will fail.
 *
 *   3. Otherwise → primary "Nuevo post" button pointing at the
 *      composer route (stub in Commit 18, real wizard in Commit 19).
 */
export function NewPostCta({
  canCreate,
  current,
  cap,
  reached,
}: NewPostCtaProps): React.ReactElement | null {
  if (!canCreate) return null;

  if (reached && cap !== -1) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100"
        data-testid="publish-cap-banner"
      >
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
        <span>
          Has usado <strong className="tabular-nums">{current}</strong> de{' '}
          <strong className="tabular-nums">{cap}</strong> posts este mes.
        </span>
        <Button
          asChild
          size="sm"
          variant="outline"
          className="ml-auto h-7 text-xs"
        >
          <Link href={'/billing' as never}>Actualizar plan</Link>
        </Button>
      </div>
    );
  }

  return (
    <Button asChild size="sm" data-testid="publish-new-post-cta">
      <Link href={'/publish/composer' as never}>
        <PlusCircle className="h-4 w-4" aria-hidden />
        Nuevo post
      </Link>
    </Button>
  );
}
