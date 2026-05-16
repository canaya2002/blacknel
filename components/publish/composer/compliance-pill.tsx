'use client';

import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { complianceCheck, type ComplianceResult } from '@/lib/ai/compliance-stub';
import { cn } from '@/lib/utils/cn';

interface CompliancePillProps {
  /** Editor body to check. */
  text: string;
  /** Brand name fed to the compliance context (e.g. allowlist for named-person rule). */
  brandName?: string | null;
  /** Location name fed to the compliance context. */
  locationName?: string | null;
  /**
   * Test seam: replaces the real `complianceCheck` so the
   * 3-state visual test in `compliance-pill-states.test.tsx` can
   * exercise green/amber/red branches deterministically. Production
   * code never passes this.
   */
  complianceCheckFn?: (
    text: string,
    ctx: { entityType: 'inbox'; brandName?: string; locationName?: string },
  ) => ComplianceResult;
  /**
   * Debounce window in milliseconds before the check runs. Default
   * 500ms (Ajuste Z). Lowered to 0 in tests for determinism.
   */
  debounceMs?: number;
}

type PillState = 'idle' | 'checking' | 'safe' | 'review' | 'blocked';

/**
 * Compliance pill (Ajuste Z, Commit 19c.2).
 *
 * Three terminal states + transient "checking":
 *
 *   - **Green** — `safe=true && requiresApproval=false`.
 *     "Listo para publicar".
 *   - **Amber** — `safe=true && requiresApproval=true`.
 *     "Requiere aprobación" (informativo, no bloquea).
 *   - **Red** — `safe=false`. "Contenido bloqueado" — el botón
 *     publicar debería estar disabled por el shell que lee
 *     `getComplianceState()` via prop.
 *
 * The pill itself doesn't gate the publish button — the shell
 * does — but the user sees the state at all times via the
 * colored chip + optional popover with flag details.
 *
 * Debounce: 500ms between keystrokes (default). Lower to 0 in
 * tests with `debounceMs={0}` so vitest assertions don't need to
 * advance timers.
 */
export function CompliancePill({
  text,
  brandName,
  locationName,
  complianceCheckFn,
  debounceMs = 500,
}: CompliancePillProps): React.ReactElement {
  const [debouncedText, setDebouncedText] = useState<string>(text);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Derived "pending" state — true while the timer hasn't fired
  // yet. Avoids the React-19 `set-state-in-effect` warning that
  // would trip a `setIsPending(true)` inside the effect body.
  const isPending = text !== debouncedText;

  useEffect(() => {
    if (debouncedText === text) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    // Always schedule async — even `debounceMs=0` goes through
    // `setTimeout(..., 0)` so the setState is never synchronous
    // inside the effect body (React 19 set-state-in-effect rule).
    timeoutRef.current = setTimeout(() => {
      setDebouncedText(text);
    }, Math.max(0, debounceMs));
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [text, debouncedText, debounceMs]);

  const result = useMemo<ComplianceResult>(
    () =>
      (complianceCheckFn ?? complianceCheck)(debouncedText, {
        entityType: 'inbox',
        ...(brandName ? { brandName } : {}),
        ...(locationName ? { locationName } : {}),
      }),
    [debouncedText, complianceCheckFn, brandName, locationName],
  );

  const state: PillState = isPending
    ? 'checking'
    : !result.safe
      ? 'blocked'
      : result.requiresApproval
        ? 'review'
        : 'safe';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Estado de compliance"
          data-testid={`compliance-pill-${state}`}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
            state === 'safe' &&
              'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700/60 dark:bg-emerald-950/40 dark:text-emerald-200',
            state === 'review' &&
              'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100',
            state === 'blocked' &&
              'border-red-300 bg-red-50 text-red-900 dark:border-red-700/60 dark:bg-red-950/40 dark:text-red-100',
            state === 'checking' &&
              'border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400',
          )}
        >
          <PillIcon state={state} />
          <span>{LABELS[state]}</span>
          {result.flags.length > 0 && state !== 'checking' ? (
            <Badge variant="muted" className="h-4 px-1 text-[10px]">
              {result.flags.length}
            </Badge>
          ) : null}
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-80 p-3" align="end">
        <header className="mb-2 text-[11px] font-medium text-muted-foreground">
          Análisis de contenido · {LABELS[state]}
        </header>
        {state === 'checking' ? (
          <p className="text-xs text-muted-foreground">Analizando…</p>
        ) : result.flags.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Sin flags detectados. {result.reasoning}
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {result.flags.map((flag) => (
              <li
                key={flag}
                className="flex items-start gap-2 rounded-md border bg-card/30 px-2 py-1.5 text-[11px]"
              >
                <AlertTriangle
                  className="mt-0.5 h-3 w-3 shrink-0 text-amber-500"
                  aria-hidden
                />
                <span>
                  <span className="font-mono font-medium">{flag}</span>
                  {result.matchedKeywords.length > 0 ? (
                    <span className="ml-1 text-muted-foreground">
                      ({result.matchedKeywords.slice(0, 3).join(', ')})
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
        <footer className="mt-2 border-t pt-2 text-[10px] italic text-muted-foreground">
          Phase-4 stub · Phase 7 swap a Claude Opus.
        </footer>
      </PopoverContent>
    </Popover>
  );
}

const LABELS: Record<PillState, string> = {
  idle: '—',
  checking: 'Analizando…',
  safe: 'Listo para publicar',
  review: 'Requiere aprobación',
  blocked: 'Contenido bloqueado',
};

function PillIcon({ state }: { state: PillState }): React.ReactElement {
  switch (state) {
    case 'checking':
      return <Loader2 className="h-3 w-3 animate-spin" aria-hidden />;
    case 'safe':
      return <CheckCircle2 className="h-3 w-3" aria-hidden />;
    case 'review':
      return <ShieldCheck className="h-3 w-3" aria-hidden />;
    case 'blocked':
      return <AlertOctagon className="h-3 w-3" aria-hidden />;
    default:
      return <ShieldCheck className="h-3 w-3" aria-hidden />;
  }
}

/**
 * Pure helper exported for the shell — given the same inputs the
 * pill uses, returns the terminal state without rendering. Drives
 * the publish button's disabled state ("blocked" → disabled).
 */
export function getComplianceState(
  text: string,
  ctx: { brandName?: string | null; locationName?: string | null } = {},
): PillState {
  const result = complianceCheck(text, {
    entityType: 'inbox',
    ...(ctx.brandName ? { brandName: ctx.brandName } : {}),
    ...(ctx.locationName ? { locationName: ctx.locationName } : {}),
  });
  if (!result.safe) return 'blocked';
  if (result.requiresApproval) return 'review';
  return 'safe';
}
