import { type LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils/cn';

interface EmptyStateCTA {
  label: string;
  /** When set, the action is disabled and the tooltip explains why
   * (e.g. "Available in Phase 4"). */
  disabledReason?: string;
  /** When omitted, the button renders as a disabled placeholder. */
  href?: string;
  onClick?: () => void;
}

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Primary action — usually the canonical "create / connect" verb for the module. */
  primary?: EmptyStateCTA;
  /** Optional secondary action — typically docs or a "learn more". */
  secondary?: EmptyStateCTA;
  className?: string;
}

/**
 * Every `(app)/<module>/page.tsx` in Phase 1 renders this. Each module
 * supplies its own icon, title and a *specific* description of what
 * the surface will show once data exists — never generic "no items yet"
 * copy. CTAs are usually `disabledReason` placeholders pointing at the
 * phase that turns them on.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  primary,
  secondary,
  className,
}: EmptyStateProps): React.ReactElement {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed bg-card/30 px-8 py-16 text-center',
        className,
      )}
    >
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="h-7 w-7" aria-hidden />
      </div>
      <h2 className="mb-2 text-lg font-semibold tracking-tight">{title}</h2>
      <p className="mb-6 max-w-md text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>
      {(primary ?? secondary) ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {primary ? <CTA cta={primary} variant="default" /> : null}
          {secondary ? <CTA cta={secondary} variant="ghost" /> : null}
        </div>
      ) : null}
    </div>
  );
}

function CTA({
  cta,
  variant,
}: {
  cta: EmptyStateCTA;
  variant: 'default' | 'ghost';
}): React.ReactElement {
  const disabled = Boolean(cta.disabledReason);
  const button = (
    <Button
      variant={variant}
      disabled={disabled}
      {...(cta.href && !disabled ? { asChild: true as const } : {})}
      onClick={cta.onClick}
    >
      {cta.href && !disabled ? <a href={cta.href}>{cta.label}</a> : cta.label}
    </Button>
  );

  if (disabled && cta.disabledReason) {
    return (
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          {/* Wrap in span so the tooltip can capture pointer events on the disabled button. */}
          <TooltipTrigger asChild>
            <span tabIndex={0}>{button}</span>
          </TooltipTrigger>
          <TooltipContent>{cta.disabledReason}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return button;
}
