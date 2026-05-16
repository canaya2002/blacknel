/**
 * Status color tokens for /publish (Ajuste 2).
 *
 * Locked to the palette in the master prompt section 11.4:
 *
 *   draft            → zinc
 *   pending_approval → amber
 *   scheduled        → blue
 *   publishing       → blue (transient — same hue as scheduled)
 *   published        → emerald
 *   failed           → red
 *   cancelled        → muted (very rarely shown)
 *
 * The calendar uses `chip` for the pill rendered inside a day cell,
 * `dot` for the leading dot in the list view's row, and
 * `leftBorder` for the day-cell side ribbon when ≥1 failed or
 * ≥1 pending_approval post lives in that day.
 */

import type { PostListStatus } from '@/lib/publish/queries';

export interface StatusStyle {
  /** Tailwind classes for the chip (background + text). */
  readonly chip: string;
  /** Tailwind classes for the leading dot (background only). */
  readonly dot: string;
  /** Spanish label rendered next to the dot in the list view. */
  readonly label: string;
}

const STYLES: Record<PostListStatus, StatusStyle> = {
  draft: {
    chip: 'bg-zinc-500/15 text-zinc-700 dark:bg-zinc-400/20 dark:text-zinc-200',
    dot: 'bg-zinc-500',
    label: 'Borrador',
  },
  pending_approval: {
    chip: 'bg-amber-500/15 text-amber-700 dark:bg-amber-400/20 dark:text-amber-200',
    dot: 'bg-amber-500',
    label: 'En aprobación',
  },
  scheduled: {
    chip: 'bg-blue-500/15 text-blue-700 dark:bg-blue-400/20 dark:text-blue-200',
    dot: 'bg-blue-500',
    label: 'Agendado',
  },
  publishing: {
    chip: 'bg-blue-500/25 text-blue-800 dark:bg-blue-400/30 dark:text-blue-100',
    dot: 'bg-blue-600',
    label: 'Publicando',
  },
  published: {
    chip: 'bg-emerald-500/15 text-emerald-700 dark:bg-emerald-400/20 dark:text-emerald-200',
    dot: 'bg-emerald-500',
    label: 'Publicado',
  },
  failed: {
    chip: 'bg-red-500/15 text-red-700 dark:bg-red-400/20 dark:text-red-200',
    dot: 'bg-red-500',
    label: 'Fallido',
  },
  cancelled: {
    chip: 'bg-muted text-muted-foreground',
    dot: 'bg-muted-foreground/40',
    label: 'Cancelado',
  },
};

export function statusStyle(status: PostListStatus): StatusStyle {
  return STYLES[status];
}

/**
 * Determine the left-border ribbon color for a day cell that
 * contains the given statuses. Red beats amber — a failed post is
 * more urgent than a pending approval.
 */
export function leftBorderForCell(
  statuses: ReadonlyArray<PostListStatus>,
): 'red' | 'amber' | null {
  if (statuses.includes('failed')) return 'red';
  if (statuses.includes('pending_approval')) return 'amber';
  return null;
}
