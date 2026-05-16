import { buildPayloadDiff } from '@/lib/approvals/diff';
import { cn } from '@/lib/utils/cn';

interface DiffViewProps {
  original: unknown | null;
  proposed: unknown;
}

/**
 * Side-by-side diff render. CSS grid with a media-query breakpoint so
 * the panels stack vertically on narrow screens — Phase 4 doesn't
 * design for mobile, but we structure the markup to avoid rework when
 * Phase 12 polish lands.
 */
export function DiffView({ original, proposed }: DiffViewProps): React.ReactElement {
  const { left, right } = buildPayloadDiff(original, proposed);
  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}
    >
      <DiffPanel
        label="Original"
        muted={original === null}
        lines={left}
      />
      <DiffPanel label="Propuesta" lines={right} />
    </div>
  );
}

interface DiffPanelProps {
  label: string;
  muted?: boolean;
  lines: ReadonlyArray<{ text: string; diff: boolean }>;
}

function DiffPanel({ label, muted, lines }: DiffPanelProps): React.ReactElement {
  return (
    <div className="flex min-w-0 flex-col rounded-md border bg-muted/20">
      <div className="border-b px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <pre
        className={cn(
          'overflow-x-auto px-3 py-2 text-[11px] leading-relaxed',
          muted && 'italic text-muted-foreground',
        )}
      >
        {lines.map((line, i) => (
          <div
            key={i}
            className={cn(
              'whitespace-pre-wrap rounded px-1',
              line.diff && !muted && 'bg-amber-500/10 text-amber-900 dark:text-amber-200',
            )}
          >
            {line.text || ' '}
          </div>
        ))}
      </pre>
    </div>
  );
}
