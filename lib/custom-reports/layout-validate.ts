/**
 * Phase 10 / Commit 39 — layout validation.
 *
 * # When this runs (D-39-7 a)
 *
 * Draft reports allow overlapping widgets so authoring is smooth.
 * `publishCustomReportAction` runs this validator and rejects on
 * overlap or out-of-bounds. Save / move / addWidget actions do NOT
 * run it — the UI surfaces a warning chip when overlap is detected
 * but does not block save.
 *
 * # Grid model
 *
 * 12-col grid, unbounded rows (height per widget capped at 8 rows
 * via DB CHECK). Width capped at 12. Position 0-indexed (0..11 for
 * col, 0+ for row). `position_col + width <= 12` is enforced at DB
 * layer; this validator only checks for OVERLAP between widgets.
 *
 * # Algorithm
 *
 * O(n²) sweep — n is the number of widgets in a single report,
 * capped by sensible UX limits (~50). For each pair (a, b), check
 * if their rectangles intersect. Pure function — no DB access.
 */

export interface LayoutWidget {
  readonly id: string;
  readonly positionRow: number;
  readonly positionCol: number;
  readonly width: number;
  readonly height: number;
}

export type LayoutValidationError =
  | { readonly kind: 'overlap'; readonly aId: string; readonly bId: string }
  | { readonly kind: 'out_of_bounds'; readonly widgetId: string; readonly reason: string }
  | { readonly kind: 'empty_layout' };

export interface LayoutValidationResult {
  readonly ok: boolean;
  readonly errors: ReadonlyArray<LayoutValidationError>;
}

const GRID_COLUMNS = 12;
const MAX_WIDGET_HEIGHT = 8;
const MAX_WIDGET_WIDTH = 12;

function widgetsOverlap(a: LayoutWidget, b: LayoutWidget): boolean {
  const aRight = a.positionCol + a.width;
  const aBottom = a.positionRow + a.height;
  const bRight = b.positionCol + b.width;
  const bBottom = b.positionRow + b.height;
  // Two rectangles overlap if neither lies entirely to one side
  // of the other.
  if (aRight <= b.positionCol) return false;
  if (bRight <= a.positionCol) return false;
  if (aBottom <= b.positionRow) return false;
  if (bBottom <= a.positionRow) return false;
  return true;
}

function checkBounds(w: LayoutWidget): LayoutValidationError[] {
  const errors: LayoutValidationError[] = [];
  if (w.positionRow < 0) {
    errors.push({
      kind: 'out_of_bounds',
      widgetId: w.id,
      reason: `position_row=${w.positionRow} must be >= 0`,
    });
  }
  if (w.positionCol < 0 || w.positionCol >= GRID_COLUMNS) {
    errors.push({
      kind: 'out_of_bounds',
      widgetId: w.id,
      reason: `position_col=${w.positionCol} must be in [0, ${GRID_COLUMNS - 1}]`,
    });
  }
  if (w.width < 1 || w.width > MAX_WIDGET_WIDTH) {
    errors.push({
      kind: 'out_of_bounds',
      widgetId: w.id,
      reason: `width=${w.width} must be in [1, ${MAX_WIDGET_WIDTH}]`,
    });
  }
  if (w.height < 1 || w.height > MAX_WIDGET_HEIGHT) {
    errors.push({
      kind: 'out_of_bounds',
      widgetId: w.id,
      reason: `height=${w.height} must be in [1, ${MAX_WIDGET_HEIGHT}]`,
    });
  }
  if (w.positionCol + w.width > GRID_COLUMNS) {
    errors.push({
      kind: 'out_of_bounds',
      widgetId: w.id,
      reason: `position_col(${w.positionCol}) + width(${w.width}) exceeds grid columns(${GRID_COLUMNS})`,
    });
  }
  return errors;
}

/**
 * Strict layout validation — invoked by
 * `publishCustomReportAction`. Returns `{ ok: true }` only when
 * every widget fits in the grid AND no two widgets overlap AND
 * the layout is non-empty.
 */
export function validateLayout(
  widgets: ReadonlyArray<LayoutWidget>,
): LayoutValidationResult {
  const errors: LayoutValidationError[] = [];

  if (widgets.length === 0) {
    errors.push({ kind: 'empty_layout' });
    return { ok: false, errors };
  }

  for (const w of widgets) {
    errors.push(...checkBounds(w));
  }

  for (let i = 0; i < widgets.length; i += 1) {
    for (let j = i + 1; j < widgets.length; j += 1) {
      if (widgetsOverlap(widgets[i]!, widgets[j]!)) {
        errors.push({
          kind: 'overlap',
          aId: widgets[i]!.id,
          bId: widgets[j]!.id,
        });
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Cheap overlap-only check used by the UI to flag bad-state
 * drafts without bailing on save (D-39-7 a). Returns the count of
 * overlapping pairs rather than the full error set.
 */
export function countOverlaps(
  widgets: ReadonlyArray<LayoutWidget>,
): number {
  let count = 0;
  for (let i = 0; i < widgets.length; i += 1) {
    for (let j = i + 1; j < widgets.length; j += 1) {
      if (widgetsOverlap(widgets[i]!, widgets[j]!)) count += 1;
    }
  }
  return count;
}
