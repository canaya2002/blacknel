import Link from 'next/link';

import { cn } from '@/lib/utils/cn';
import type { ReportSection } from '@/lib/reports/period';

interface ReportTabNavProps {
  current: ReportSection;
  /** Carry-through of the rest of the searchParams (period, brandId). */
  searchParamsCarry: string;
}

const TABS: ReadonlyArray<{ key: ReportSection; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'inbox', label: 'Inbox' },
  { key: 'publishing', label: 'Publishing' },
  { key: 'ai', label: 'AI' },
  { key: 'ads', label: 'Ads' },
  // Phase 9 / Commit 34 — D-34-6 (a) scheduled reports tab.
  { key: 'scheduled', label: 'Scheduled' },
];

/**
 * URL-driven tab navigation (D-27-1) for /reports. Each tab
 * preserves the existing `period` + `brandId` query params via
 * `searchParamsCarry`.
 */
export function ReportTabNav({
  current,
  searchParamsCarry,
}: ReportTabNavProps): React.ReactElement {
  return (
    <nav className="flex gap-1 border-b bg-card/20 px-6">
      {TABS.map((t) => {
        const params = new URLSearchParams(searchParamsCarry);
        params.delete('section');
        params.delete('fresh');
        if (t.key !== 'overview') params.set('section', t.key);
        const qs = params.toString();
        const href = qs.length === 0 ? '/reports' : `/reports?${qs}`;
        const active = current === t.key;
        return (
          <Link
            key={t.key}
            href={href}
            prefetch={false}
            scroll={false}
            className={cn(
              'border-b-2 px-3 py-2 text-sm',
              active
                ? 'border-foreground font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
