import { TrendingUp } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { TagStat } from '@/lib/reputation/queries';
import { cn } from '@/lib/utils/cn';

interface TopTagsListProps {
  tags: ReadonlyArray<TagStat>;
}

const SENTIMENT_TONE = {
  positive: 'text-emerald-600 dark:text-emerald-400',
  neutral: 'text-zinc-500',
  negative: 'text-red-600 dark:text-red-400',
  unknown: 'text-zinc-500',
} as const;

const SENTIMENT_LABEL = {
  positive: 'positivo',
  neutral: 'neutral',
  negative: 'negativo',
  unknown: 'sin clasificar',
} as const;

const MIN_TAGS_THRESHOLD = 5;

/**
 * Top-10 frequent tags filtered to count ≥ 3 (Ajuste 4). When fewer
 * than 5 qualifying tags exist, we render the explicit "aún no hay
 * temas frecuentes identificables" empty state rather than a
 * misleading partial list. Phase 7 will replace this with IA topic
 * extraction from review bodies — JSDoc'd on `getTopTagsWithTx`.
 */
export function TopTagsList({ tags }: TopTagsListProps): React.ReactElement {
  if (tags.length < MIN_TAGS_THRESHOLD) {
    return (
      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="text-sm">Temas frecuentes</CardTitle>
          <CardDescription className="text-[11px]">
            Calculados desde las etiquetas que los agentes asignan a las reseñas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-dashed bg-card/30 px-4 py-6 text-center text-xs text-muted-foreground">
            Aún no hay temas frecuentes identificables. Los temas se calculan
            automáticamente cuando hay suficientes reseñas etiquetadas.
          </div>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-sm">Temas frecuentes</CardTitle>
        <CardDescription className="text-[11px]">
          Top tags con al menos 3 menciones. El sentimiento dominante refleja la
          mayoría de las reseñas con cada tag.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y" data-testid="top-tags-list">
          {tags.map((tag) => (
            <li
              key={tag.tag}
              className="flex items-center gap-3 py-2 text-xs"
              data-testid="top-tag-row"
            >
              <TrendingUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="flex-1 truncate font-medium">{tag.tag}</span>
              <Badge variant="muted" className="text-[10px] tabular-nums">
                {tag.count}
              </Badge>
              <span className="w-10 text-right text-[10px] tabular-nums text-muted-foreground">
                {tag.percentOfReviews}%
              </span>
              <span
                className={cn(
                  'w-20 text-right text-[10px] capitalize',
                  SENTIMENT_TONE[tag.dominantSentiment],
                )}
              >
                {SENTIMENT_LABEL[tag.dominantSentiment]}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
