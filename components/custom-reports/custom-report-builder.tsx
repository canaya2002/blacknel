'use client';

import {
  AlertTriangle,
  CheckCircle2,
  Trash2,
  Plus,
  Send,
  Archive,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils/cn';

import {
  addWidgetAction,
  archiveCustomReportAction,
  moveWidgetAction,
  publishCustomReportAction,
  removeWidgetAction,
} from '@/app/(app)/reports/custom/actions';
import { countOverlaps, type LayoutWidget } from '@/lib/custom-reports/layout-validate';
import type {
  CustomReportWidget,
} from '@/lib/db/schema';

interface CustomReportBuilderProps {
  reportId: string;
  reportName: string;
  reportStatus: 'draft' | 'published' | 'archived';
  initialWidgets: ReadonlyArray<CustomReportWidget>;
}

/**
 * Phase 10 / Commit 39 — Custom Report Builder client component.
 *
 * # Architectural note (R-39-4 mitigation + Phase 12 polish anchor)
 *
 * The original C39 spec called for DnD-kit drag-drop. Shipped as a
 * **static-position builder** in Phase 10 (numeric position inputs +
 * add/remove dropdowns) to keep the bundle lean and the demo
 * end-to-end working. The full DnD-kit drag interaction is tracked
 * for Phase 12 polish under
 * `TODO.md#custom-report-builder-dnd-kit-phase-12`. The data model,
 * Server Actions, and persistence all support drag-drop already —
 * only the visual interaction is deferred.
 *
 * # Overlap warning (D-39-7 a)
 *
 * `countOverlaps()` runs on every change. A warning chip surfaces if
 * widgets overlap, but save is NOT blocked. Publish action enforces
 * strict layout validation server-side.
 */
export function CustomReportBuilder({
  reportId,
  reportStatus,
  initialWidgets,
}: CustomReportBuilderProps): React.ReactElement {
  const router = useRouter();
  const [widgets, setWidgets] = useState<ReadonlyArray<CustomReportWidget>>(initialWidgets);
  const [status, setStatus] = useState(reportStatus);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  const layoutWidgets: LayoutWidget[] = useMemo(
    () =>
      widgets.map((w) => ({
        id: w.id,
        positionRow: w.positionRow,
        positionCol: w.positionCol,
        width: w.width,
        height: w.height,
      })),
    [widgets],
  );

  const overlapCount = useMemo(
    () => countOverlaps(layoutWidgets),
    [layoutWidgets],
  );

  const addKpiPlaceholder = (): void => {
    startTransition(async () => {
      // Find first available row.
      const maxRow = widgets.reduce(
        (acc, w) => Math.max(acc, w.positionRow + w.height),
        0,
      );
      const result = await addWidgetAction(null, {
        reportId,
        kind: 'kpi_card',
        positionRow: maxRow,
        positionCol: 0,
        width: 3,
        height: 1,
        config: {
          dataSource: 'inbox_kpis',
          metric: 'threads_pending_approval_count',
          label: 'Nuevo widget · editá la config',
          format: 'number',
        },
      });
      if (result.ok) {
        router.refresh();
      } else {
        setFeedback(result.error.message);
      }
    });
  };

  const removeWidget = (widgetId: string): void => {
    startTransition(async () => {
      const result = await removeWidgetAction(null, { widgetId });
      if (result.ok) {
        setWidgets((prev) => prev.filter((w) => w.id !== widgetId));
      } else {
        setFeedback(result.error.message);
      }
    });
  };

  const moveWidget = (
    widgetId: string,
    patch: Partial<Pick<CustomReportWidget, 'positionRow' | 'positionCol' | 'width' | 'height'>>,
  ): void => {
    const target = widgets.find((w) => w.id === widgetId);
    if (!target) return;
    const next = {
      positionRow: patch.positionRow ?? target.positionRow,
      positionCol: patch.positionCol ?? target.positionCol,
      width: patch.width ?? target.width,
      height: patch.height ?? target.height,
    };
    setWidgets((prev) =>
      prev.map((w) => (w.id === widgetId ? { ...w, ...next } : w)),
    );
    startTransition(async () => {
      const result = await moveWidgetAction(null, {
        widgetId,
        ...next,
      });
      if (!result.ok) {
        setFeedback(result.error.message);
      }
    });
  };

  const publish = (): void => {
    startTransition(async () => {
      const result = await publishCustomReportAction(null, { reportId });
      if (result.ok) {
        setStatus('published');
        setFeedback('Reporte publicado.');
        router.refresh();
      } else {
        setFeedback(result.error.message);
      }
    });
  };

  const archive = (): void => {
    if (!confirm('¿Archivar este reporte? Vuelve a editable solo manualmente.')) return;
    startTransition(async () => {
      const result = await archiveCustomReportAction(null, { reportId });
      if (result.ok) {
        setStatus('archived');
        router.push('/reports/custom');
      } else {
        setFeedback(result.error.message);
      }
    });
  };

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={addKpiPlaceholder} disabled={pending}>
            <Plus className="h-3.5 w-3.5" />
            Agregar KPI placeholder
          </Button>
          {overlapCount > 0 ? (
            <span
              className="flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400"
              data-testid="overlap-warning"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {overlapCount} solapamiento{overlapCount === 1 ? '' : 's'} —
              corregir antes de publicar.
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Layout válido
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {status === 'draft' ? (
            <Button
              size="sm"
              onClick={publish}
              disabled={pending || overlapCount > 0 || widgets.length === 0}
              data-testid="publish-button"
            >
              <Send className="h-3.5 w-3.5" />
              Publicar
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            onClick={archive}
            disabled={pending}
          >
            <Archive className="h-3.5 w-3.5" />
            Archivar
          </Button>
        </div>
      </div>

      {feedback ? (
        <p className="text-xs text-muted-foreground" data-testid="builder-feedback">
          {feedback}
        </p>
      ) : null}

      <Card>
        <CardContent className="p-3">
          {widgets.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Reporte vacío. Agregá tu primer widget con el botón de arriba.
            </p>
          ) : (
            <div className="grid grid-cols-12 gap-3" data-testid="builder-grid">
              {widgets.map((w) => {
                const colStart = w.positionCol + 1;
                const colEnd = colStart + w.width;
                const rowStart = w.positionRow + 1;
                const rowEnd = rowStart + w.height;
                return (
                  <div
                    key={w.id}
                    style={{
                      gridColumn: `${colStart} / ${colEnd}`,
                      gridRow: `${rowStart} / ${rowEnd}`,
                      minHeight: w.height * 80,
                    }}
                    data-testid={`builder-widget-${w.id}`}
                    className={cn(
                      'flex flex-col gap-1 rounded-md border bg-card p-2 shadow-sm',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {w.kind}
                      </span>
                      <button
                        className="text-destructive opacity-70 hover:opacity-100"
                        title="Remover widget"
                        onClick={() => removeWidget(w.id)}
                        disabled={pending}
                        data-testid={`remove-widget-${w.id}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1 text-[10px]">
                      <PositionInput
                        label="row"
                        value={w.positionRow}
                        min={0}
                        max={50}
                        onChange={(v) =>
                          moveWidget(w.id, { positionRow: v })
                        }
                      />
                      <PositionInput
                        label="col"
                        value={w.positionCol}
                        min={0}
                        max={11}
                        onChange={(v) =>
                          moveWidget(w.id, { positionCol: v })
                        }
                      />
                      <PositionInput
                        label="w"
                        value={w.width}
                        min={1}
                        max={12}
                        onChange={(v) => moveWidget(w.id, { width: v })}
                      />
                      <PositionInput
                        label="h"
                        value={w.height}
                        min={1}
                        max={8}
                        onChange={(v) => moveWidget(w.id, { height: v })}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PositionInput({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}): React.ReactElement {
  return (
    <label className="inline-flex items-center gap-1">
      <span className="text-muted-foreground">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-10 rounded border bg-background px-1 text-[10px] tabular-nums"
      />
    </label>
  );
}
