import { BarChart, EmptyChart, type ChartDataPoint } from '@/components/charts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { StarDistribution } from '@/lib/reputation/queries';

interface RatingDistributionChartProps {
  stars: StarDistribution;
}

const STAR_COLORS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: '#ef4444', // red
  2: '#f97316', // orange
  3: '#f59e0b', // amber
  4: '#84cc16', // lime
  5: '#10b981', // emerald
};

export function RatingDistributionChart({
  stars,
}: RatingDistributionChartProps): React.ReactElement {
  const data: ChartDataPoint[] = ([1, 2, 3, 4, 5] as const).map((rating) => ({
    label: `${rating}★`,
    value: stars.counts[rating] ?? 0,
    color: STAR_COLORS[rating],
  }));

  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-sm">Distribución de estrellas</CardTitle>
        <CardDescription className="text-[11px]">
          {stars.total} reseña{stars.total === 1 ? '' : 's'} en el período.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {stars.total === 0 ? (
          <EmptyChart
            height={200}
            message="Sin reseñas en este período."
          />
        ) : (
          <BarChart data={data} height={200} ariaLabel="Distribución de reseñas por estrella" />
        )}
      </CardContent>
    </Card>
  );
}
