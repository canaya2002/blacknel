import { Database, Sparkles } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import type { GenerationListItem } from '@/lib/ai/persistence';

interface AiGenerationsTableProps {
  generations: ReadonlyArray<GenerationListItem>;
}

const USD_FMT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

const TS_FMT = new Intl.DateTimeFormat('es-MX', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function AiGenerationsTable({
  generations,
}: AiGenerationsTableProps): React.ReactElement {
  if (generations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-12 text-center">
        <Sparkles className="h-6 w-6 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium">Sin generaciones IA todavía</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          Cada llamada al adapter Claude escribe una fila aquí — costo,
          tokens, latencia y cache-hit. Verás actividad cuando los Server
          Actions empiecen a invocar el cliente IA (Commits 23-26).
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="border-b bg-card/30 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-6 py-2">Fecha</th>
            <th className="px-3 py-2">Skill</th>
            <th className="px-3 py-2">Modelo</th>
            <th className="px-3 py-2 text-right">Input tokens</th>
            <th className="px-3 py-2 text-right">Cached</th>
            <th className="px-3 py-2 text-right">Output</th>
            <th className="px-3 py-2 text-right">Costo</th>
            <th className="px-3 py-2 text-right">Latencia</th>
            <th className="px-3 py-2">Cache</th>
            <th className="px-3 py-2">Via</th>
            <th className="px-3 py-2">Entidad</th>
            <th className="px-3 py-2">Prompt v</th>
          </tr>
        </thead>
        <tbody>
          {generations.map((g) => (
            <tr
              key={g.id}
              className="border-b last:border-b-0 hover:bg-muted/40"
              data-testid="ai-generation-row"
            >
              <td className="px-6 py-2 text-muted-foreground">
                <time dateTime={g.createdAt.toISOString()}>
                  {TS_FMT.format(g.createdAt)}
                </time>
              </td>
              <td className="px-3 py-2">
                <Badge variant="muted" className="text-[10px] uppercase">
                  {g.skill.replace(/_/g, ' ')}
                </Badge>
              </td>
              <td className="px-3 py-2 text-muted-foreground">{g.model}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {g.inputTokens.toLocaleString('en-US')}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                {g.cachedInputTokens.toLocaleString('en-US')}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {g.outputTokens.toLocaleString('en-US')}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {USD_FMT.format(g.costCents / 100)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                {g.durationMs} ms
              </td>
              <td className="px-3 py-2">
                {g.cacheHit ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600">
                    <Database className="h-3 w-3" aria-hidden />
                    hit
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="px-3 py-2 text-muted-foreground">via mock</td>
              <td className="px-3 py-2 text-muted-foreground">
                {g.entityType}
                {g.entityId ? (
                  <span className="ml-1 text-[10px]">
                    /{g.entityId.slice(0, 8)}
                  </span>
                ) : null}
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                {g.promptVersion}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
