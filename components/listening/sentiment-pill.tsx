import { cn } from '@/lib/utils/cn';

interface SentimentPillProps {
  sentiment: 'positive' | 'neutral' | 'negative' | 'unknown';
  score?: number;
  className?: string;
}

const STYLES: Record<SentimentPillProps['sentiment'], { label: string; cls: string }> = {
  positive: {
    label: 'Positive',
    cls:
      'border-emerald-500/40 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  },
  neutral: {
    label: 'Neutral',
    cls:
      'border-zinc-300/60 bg-zinc-50 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300',
  },
  negative: {
    label: 'Negative',
    cls:
      'border-rose-500/40 bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300',
  },
  unknown: {
    label: 'Unknown',
    cls:
      'border-zinc-300/60 bg-muted text-muted-foreground',
  },
};

export function SentimentPill({
  sentiment,
  score,
  className,
}: SentimentPillProps): React.ReactElement {
  const { label, cls } = STYLES[sentiment];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium',
        cls,
        className,
      )}
      data-testid={`listening-sentiment-${sentiment}`}
    >
      {label}
      {typeof score === 'number' && score > 0 ? (
        <span className="text-[10px] tabular-nums opacity-70">
          {(score * 100).toFixed(0)}%
        </span>
      ) : null}
    </span>
  );
}
