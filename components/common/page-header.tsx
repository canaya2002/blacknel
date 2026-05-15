import { cn } from '@/lib/utils/cn';

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Optional ribbon shown above the title — e.g. an "Available in Phase 4" badge. */
  eyebrow?: React.ReactNode;
  /** Right-side actions (e.g. primary CTA buttons). */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * Standard page header used by every `(app)/<module>/page.tsx`. Keeps
 * typographic scale and spacing consistent across the 19 modules and
 * gives downstream pages an obvious slot for primary actions.
 */
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  className,
}: PageHeaderProps): React.ReactElement {
  return (
    <header className={cn('flex flex-col gap-3 pb-6', className)}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          {eyebrow ? (
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {eyebrow}
            </div>
          ) : null}
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
