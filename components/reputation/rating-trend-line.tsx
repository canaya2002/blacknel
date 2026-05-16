import {
  EmptyChart,
  LineChart,
  type SeriesDataPoint,
} from '@/components/charts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { RatingTrendPoint } from '@/lib/reputation/queries';

interface RatingTrendLineProps {
  trend: ReadonlyArray<RatingTrendPoint>;
}

export function RatingTrendLine({ trend }: RatingTrendLineProps): React.ReactElement {
  // SeriesDataPoint requires `x` + numeric columns. We map empty
  // buckets (avg === null) to `null` so recharts skips them rather
  // than drawing them as 0 (a 0★ point would misrepresent a week
  // with no reviews as the worst week ever).
  const data: SeriesDataPoint[] = trend.map((p) => ({
    x: shortWeek(p.week),
    rating: p.avg ?? null,
  }));

  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-sm">Rating semanal</CardTitle>
        <CardDescription className="text-[11px]">
          Promedio semanal del período. Semanas sin reseñas se omiten en la línea.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <EmptyChart height={220} message="Sin datos suficientes para la tendencia." />
        ) : (
          <LineChart
            data={data}
            series={[{ key: 'rating', label: 'Rating promedio', color: '#3f4753' }]}
            height={220}
            yAxisMax={5}
            formatValue={(v) => v.toFixed(2)}
            ariaLabel="Tendencia semanal del rating promedio"
          />
        )}
      </CardContent>
    </Card>
  );
}

function shortWeek(iso: string): string {
  // 2026-05-11 → "11 may". Localized to es so the dashboard reads
  // consistent with the rest of the surface.
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('es', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}
