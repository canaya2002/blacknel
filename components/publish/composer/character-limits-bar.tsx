'use client';

import { Ruler } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils/cn';
import type { AccountLimitUsage } from '@/lib/publish/composer/character-limits';
import type { PlatformCode } from '@/lib/connectors/base';

interface CharacterLimitsBarProps {
  usages: ReadonlyArray<AccountLimitUsage>;
}

const PLATFORM_SHORT: Partial<Record<PlatformCode, string>> = {
  facebook: 'FB',
  instagram: 'IG',
  gbp: 'GBP',
  whatsapp: 'WA',
  tiktok: 'TT',
  linkedin: 'LI',
  x: 'X',
  youtube: 'YT',
  pinterest: 'Pi',
  reddit: 'Rd',
};

/**
 * Compact per-account char-usage strip. Each chip shows the
 * platform shortcode, the effective text length, and the
 * declared max. Color escalates with the usage ratio:
 *
 *   - 0-90%   neutral
 *   - 90-100% amber ("near limit")
 *   - 100%+   red ("over limit")
 *
 * Hidden when there are no selected accounts.
 */
export function CharacterLimitsBar({
  usages,
}: CharacterLimitsBarProps): React.ReactElement | null {
  if (usages.length === 0) return null;

  return (
    <section className="flex flex-wrap items-center gap-2 rounded-lg border bg-card/30 px-3 py-2 text-xs">
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Ruler className="h-3.5 w-3.5" aria-hidden />
        Límites por red
      </span>
      {usages.map((u) => (
        <Chip key={u.accountId} usage={u} />
      ))}
    </section>
  );
}

function Chip({ usage }: { usage: AccountLimitUsage }): React.ReactElement {
  const short = PLATFORM_SHORT[usage.platform] ?? usage.platform.slice(0, 2);
  const ratio =
    usage.maxLength === null ? 0 : Math.min(1, usage.length / usage.maxLength);
  const tone: 'neutral' | 'amber' | 'red' = usage.over
    ? 'red'
    : ratio > 0.9
      ? 'amber'
      : 'neutral';
  return (
    <Badge
      variant="muted"
      className={cn(
        'gap-1 px-2 py-0.5 tabular-nums',
        tone === 'amber' &&
          'bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100',
        tone === 'red' &&
          'bg-red-100 text-red-900 dark:bg-red-950/40 dark:text-red-100',
      )}
    >
      <span className="font-semibold">{short}</span>
      <span>
        {usage.length}
        {usage.maxLength !== null ? ` / ${usage.maxLength}` : ''}
      </span>
    </Badge>
  );
}
