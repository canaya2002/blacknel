import { AtSign, Hash, Search } from 'lucide-react';

import { cn } from '@/lib/utils/cn';
import type { ListeningTermKind } from '@/lib/db/schema';

interface TrackedTermPillProps {
  term: string;
  termKind: ListeningTermKind;
  className?: string;
}

const ICONS: Record<ListeningTermKind, React.ComponentType<{ className?: string }>> = {
  keyword: Search,
  hashtag: Hash,
  handle: AtSign,
};

export function TrackedTermPill({
  term,
  termKind,
  className,
}: TrackedTermPillProps): React.ReactElement {
  const Icon = ICONS[termKind];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border bg-muted/40 px-1.5 py-0.5 font-mono text-xs',
        className,
      )}
      data-testid={`tracked-term-${termKind}`}
    >
      <Icon className="h-3 w-3" />
      {term}
    </span>
  );
}
