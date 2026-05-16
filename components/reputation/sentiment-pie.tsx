import { EmptyChart, PieChart, type ChartDataPoint } from '@/components/charts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { SentimentDistribution } from '@/lib/reputation/queries';

interface SentimentPieProps {
  sentiment: SentimentDistribution;
}

const SENTIMENT_COLOR = {
  positive: '#10b981',
  neutral: '#a1a1aa',
  negative: '#ef4444',
  unknown: '#71717a',
} as const;

const SENTIMENT_LABEL = {
  positive: 'Positivo',
  neutral: 'Neutral',
  negative: 'Negativo',
  unknown: 'Sin clasificar',
} as const;

export function SentimentPie({ sentiment }: SentimentPieProps): React.ReactElement {
  const data: ChartDataPoint[] = (
    ['positive', 'neutral', 'negative', 'unknown'] as const
  )
    .map((s) => ({
      label: SENTIMENT_LABEL[s],
      value: sentiment.counts[s] ?? 0,
      color: SENTIMENT_COLOR[s],
    }))
    .filter((p) => p.value > 0);

  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-sm">Sentimiento</CardTitle>
        <CardDescription className="text-[11px]">
          {sentiment.total} reseña{sentiment.total === 1 ? '' : 's'} clasificada
          {sentiment.total === 1 ? '' : 's'} por IA.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <EmptyChart height={220} message="Sin reseñas para clasificar." />
        ) : (
          <PieChart data={data} height={220} ariaLabel="Distribución de sentimiento" />
        )}
      </CardContent>
    </Card>
  );
}
