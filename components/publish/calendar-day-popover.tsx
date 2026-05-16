'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { type CalendarCell, formatHourEs } from './calendar-utils';
import { statusStyle } from './status-style';

interface CalendarDayPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cell: CalendarCell | null;
}

const DAY_NAMES_ES = [
  'domingo',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
];

const MONTH_NAMES_ES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/**
 * Modal opened from a day-cell's "+N más" affordance. Shows the
 * full post list for the day. We use the dialog (not a popover)
 * because: (a) the cell is too narrow to anchor a popover with
 * 4-20 rows readably, and (b) keyboard users get proper focus
 * trapping. Each row links to the composer entry for that post —
 * the composer (Commit 19) is the source of truth for editing.
 */
export function CalendarDayPopover({
  open,
  onOpenChange,
  cell,
}: CalendarDayPopoverProps): React.ReactElement | null {
  if (!cell) return null;
  const dayName = DAY_NAMES_ES[cell.date.getUTCDay()];
  const monthName = MONTH_NAMES_ES[cell.date.getUTCMonth()];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md"
        data-testid="publish-day-popover"
      >
        <DialogHeader>
          <DialogTitle className="capitalize">
            {dayName}, {cell.date.getUTCDate()} de {monthName}
          </DialogTitle>
        </DialogHeader>

        {cell.posts.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            No hay posts en este día.
          </p>
        ) : (
          <ul className="flex flex-col gap-2 py-2">
            {cell.posts.map((p) => {
              const s = statusStyle(p.status);
              return (
                <li
                  key={p.id}
                  className="flex items-start gap-2 rounded-md border bg-card/30 p-2"
                >
                  <span
                    className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${s.dot}`}
                    aria-hidden
                  />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <div className="flex items-baseline gap-2 text-[10px]">
                      <span className="font-medium uppercase text-muted-foreground">
                        {s.label}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {formatHourEs(p.displayTime)}
                      </span>
                    </div>
                    <a
                      href={`/publish/composer/${p.id}`}
                      className="line-clamp-3 text-sm hover:underline"
                    >
                      {p.text}
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
