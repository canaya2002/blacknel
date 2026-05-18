import { cn } from '@/lib/utils/cn';

import { WidgetRenderer } from './widget-renderer';

import type { RenderedWidget } from '@/lib/custom-reports/run';

interface CustomReportCanvasProps {
  widgets: ReadonlyArray<RenderedWidget>;
  readOnly?: boolean;
}

/**
 * Phase 10 / Commit 39 — server-renderable read canvas.
 *
 * 12-col CSS grid. Each widget positions via grid-column-start/-end
 * + grid-row-start/-end derived from `positionRow`, `positionCol`,
 * `width`, `height`. Pure layout — no client interactivity.
 */
export function CustomReportCanvas({
  widgets,
  readOnly = false,
}: CustomReportCanvasProps): React.ReactElement {
  if (widgets.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-card/30 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Este reporte no tiene widgets todavía.
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'grid grid-cols-12 gap-3 p-4',
        readOnly ? 'bg-transparent' : 'bg-card/20',
      )}
      data-testid="custom-report-canvas"
    >
      {widgets.map((w) => {
        const colStart = w.positionCol + 1;
        const colEnd = colStart + w.width;
        const rowStart = w.positionRow + 1;
        const rowEnd = rowStart + w.height;
        return (
          <div
            key={w.widgetId}
            style={{
              gridColumn: `${colStart} / ${colEnd}`,
              gridRow: `${rowStart} / ${rowEnd}`,
              minHeight: w.height * 120,
            }}
            data-testid={`widget-${w.widgetId}`}
            className="rounded-md border bg-card p-3 shadow-sm"
          >
            <WidgetRenderer widget={w} />
          </div>
        );
      })}
    </div>
  );
}
