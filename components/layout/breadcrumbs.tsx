'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { SIDEBAR_ITEMS_BY_HREF } from './nav-sections';

/**
 * Breadcrumbs derived from the current pathname. Shows the section
 * (Operación, Reputación, …) followed by the module label. Phase 1
 * keeps it two deep — sub-routes (e.g. an inbox thread detail) can
 * extend this in their own page when they land.
 */
export function Breadcrumbs(): React.ReactElement | null {
  const pathname = usePathname();
  const item = SIDEBAR_ITEMS_BY_HREF.get(pathname);
  if (!item) return null;

  return (
    <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
      <ol className="flex items-center gap-1">
        <li>
          <Link
            href="/dashboard"
            className="transition-colors hover:text-foreground"
          >
            Blacknel
          </Link>
        </li>
        <li aria-hidden>
          <ChevronRight className="h-3 w-3" />
        </li>
        <li>
          <span className="opacity-80">{item.sectionLabel}</span>
        </li>
        <li aria-hidden>
          <ChevronRight className="h-3 w-3" />
        </li>
        <li>
          <span className="text-foreground">{item.label}</span>
        </li>
      </ol>
    </nav>
  );
}
