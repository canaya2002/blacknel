'use client';

import { Check, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils/cn';
import type { ChecklistItem } from '@/lib/queries/checklist';

const DISMISS_COOKIE = 'blacknel_checklist_dismissed';

interface OnboardingChecklistProps {
  items: ReadonlyArray<ChecklistItem>;
  doneCount: number;
  total: number;
  /** True when the user already dismissed the panel — server reads cookie. */
  initiallyDismissed: boolean;
}

export function OnboardingChecklist({
  items,
  doneCount,
  total,
  initiallyDismissed,
}: OnboardingChecklistProps): React.ReactElement | null {
  const [dismissed, setDismissed] = useState(initiallyDismissed);
  if (dismissed) return null;

  function dismiss(): void {
    document.cookie = `${DISMISS_COOKIE}=1; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    setDismissed(true);
  }

  const ratio = total === 0 ? 0 : Math.round((doneCount / total) * 100);

  return (
    <Card className="border-primary/30 bg-primary/[0.025]">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="flex flex-col gap-1.5">
          <CardTitle className="text-base">Pon en marcha tu workspace</CardTitle>
          <CardDescription>
            {doneCount} de {total} pasos listos. Cada uno desbloquea una parte del
            producto — algunos se completan cuando aterricen sus módulos.
          </CardDescription>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Ocultar checklist"
          onClick={dismiss}
        >
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Progress value={ratio} className="h-1.5" />
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {items.map((item) => (
            <li
              key={item.id}
              className={cn(
                'flex items-start gap-2 rounded-md p-2 text-sm',
                item.done ? 'text-muted-foreground' : '',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px]',
                  item.done
                    ? 'border-emerald-500 bg-emerald-500 text-white'
                    : 'border-muted-foreground/40',
                )}
                aria-hidden
              >
                {item.done ? <Check className="h-2.5 w-2.5" /> : null}
              </span>
              <Link
                href={item.href}
                className={cn(
                  'flex flex-col gap-0.5 transition-colors hover:text-foreground',
                  item.done && 'line-through decoration-emerald-500/60',
                )}
              >
                <span>{item.label}</span>
                {item.hint && !item.done ? (
                  <span className="text-[11px] text-muted-foreground">{item.hint}</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
