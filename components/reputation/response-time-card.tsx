import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ResponseTimeStats } from '@/lib/reputation/queries';

interface ResponseTimeCardProps {
  stats: ResponseTimeStats;
}

/**
 * Avg / p50 / p90 hours from `review.posted_at` → first published
 * response. Only counts reviews that have at least one published
 * response inside the window (`responseSampleSize`).
 *
 * Shows "Sin datos suficientes" when no reviews in the window have a
 * published response yet — same hygiene as the KPI cards (don't
 * invent averages from a sample of 0).
 */
export function ResponseTimeCard({
  stats,
}: ResponseTimeCardProps): React.ReactElement {
  if (stats.responseSampleSize === 0) {
    return (
      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="text-sm">Tiempo de respuesta</CardTitle>
          <CardDescription className="text-[11px]">
            Horas desde que se publica una reseña hasta que la respondes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-dashed bg-card/30 px-4 py-6 text-center text-xs text-muted-foreground">
            Sin respuestas publicadas en el período. El tiempo se calculará una
            vez que publiques al menos una respuesta.
          </div>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-sm">Tiempo de respuesta</CardTitle>
        <CardDescription className="text-[11px]">
          Horas desde la publicación de una reseña a la primera respuesta — {stats.responseSampleSize} muestra
          {stats.responseSampleSize === 1 ? '' : 's'}.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-end gap-6">
        <Cell label="Promedio" value={stats.avgHours} />
        <Cell label="p50" value={stats.p50Hours} />
        <Cell label="p90" value={stats.p90Hours} />
      </CardContent>
    </Card>
  );
}

function Cell({
  label,
  value,
}: {
  label: string;
  value: number | null;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-xl font-semibold tabular-nums">
        {value === null ? '—' : `${formatHours(value)}h`}
      </span>
    </div>
  );
}

function formatHours(h: number): string {
  if (h < 1) return (Math.round(h * 60) / 60).toFixed(2);
  if (h < 10) return h.toFixed(1);
  return Math.round(h).toString();
}
