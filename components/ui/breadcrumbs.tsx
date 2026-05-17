import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

import { cn } from '@/lib/utils/cn';

export interface BreadcrumbItem {
  /** Display label. Either a link or terminal text. */
  label: string;
  /** When set, the segment renders as a `<Link>`. Omit on the last (current) item. */
  href?: string;
}

interface BreadcrumbsProps {
  items: ReadonlyArray<BreadcrumbItem>;
  className?: string;
}

/**
 * Minimal drill-down breadcrumbs (Phase 8 / Commit 30, Ajuste 1).
 *
 * Used in detail pages like `/ads/[id]` where the user needs an
 * explicit trail back to the listing. The top-level
 * `components/layout/breadcrumbs.tsx` is a pathname-derived
 * helper for the global topbar and does NOT compose with
 * dynamic-segment context — this component lets the page provide
 * its own segments.
 *
 * Each item with `href` renders as a `<Link>`; the last item
 * should omit `href` so it renders as static text (and gets
 * `aria-current="page"`).
 *
 * **Accessibility.** Outer `<nav aria-label="breadcrumb">` so
 * assistive tech announces the trail; chevron separators are
 * hidden from a11y (`aria-hidden`); the terminal segment carries
 * `aria-current="page"`.
 */
export function Breadcrumbs({
  items,
  className,
}: BreadcrumbsProps): React.ReactElement {
  return (
    <nav
      aria-label="breadcrumb"
      className={cn('text-xs text-muted-foreground', className)}
    >
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          return (
            <li key={`${item.label}-${idx}`} className="flex items-center gap-1">
              {item.href && !isLast ? (
                <Link
                  href={item.href}
                  prefetch={false}
                  className="transition-colors hover:text-foreground"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  className={isLast ? 'text-foreground' : 'opacity-80'}
                  aria-current={isLast ? 'page' : undefined}
                >
                  {item.label}
                </span>
              )}
              {!isLast ? (
                <ChevronRight className="h-3 w-3" aria-hidden />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
