import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

import { AiGenerationsFilterBar } from '@/components/audit-ai/ai-generations-filter-bar';
import { AiGenerationsKpiCards } from '@/components/audit-ai/ai-generations-kpi-cards';
import { AiGenerationsTable } from '@/components/audit-ai/ai-generations-table';
import { Button } from '@/components/ui/button';
import { requireUser } from '@/lib/auth/server';
import { parseAiAuditFilters } from '@/lib/ai/audit-filters';
import {
  getGenerationKpis,
  listGenerationsForOrg,
} from '@/lib/ai/persistence';
import { authorize } from '@/lib/permissions/can';

export const dynamic = 'force-dynamic';

interface AiAuditPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * /audit/ai — Cost dashboard for the Claude SDK adapter
 * (Phase 7 / Commit 22, Ajuste 2).
 *
 * Observability-only in Phase 7. Phase 11 enriches with budget
 * alerts when monthly cap exceeded.
 *
 *   - KPIs:        cost this month, generations this month,
 *                  cache hit rate, most-used model.
 *   - Table:       last 100 generations, columns
 *                  (created_at, skill, model, tokens, cost, cache_hit, via).
 *   - Filters:     skill, model, dateRange preset (7d / 30d / 90d).
 *
 * Gated by `audit:read`. Tenant isolation by RLS (the persistence
 * layer uses `dbAs`).
 */
export default async function AiAuditPage({
  searchParams,
}: AiAuditPageProps): Promise<React.ReactElement> {
  const session = await requireUser();
  authorize(session.role, 'audit:read');

  const sp = await searchParams;
  const filters = parseAiAuditFilters(sp);

  const [kpis, generations] = await Promise.all([
    getGenerationKpis({ orgId: session.orgId, userId: session.userId }),
    listGenerationsForOrg({
      orgId: session.orgId,
      userId: session.userId,
      ...(filters.skill ? { skill: filters.skill } : {}),
      ...(filters.model ? { model: filters.model } : {}),
      ...(filters.since ? { since: filters.since } : {}),
      limit: 100,
    }),
  ]);

  return (
    <div className="flex flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b bg-card/30 px-6 py-3">
        <Button asChild size="icon" variant="ghost" className="h-8 w-8">
          <Link href="/audit" prefetch={false} aria-label="Volver al audit log">
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Link>
        </Button>
        <div className="flex flex-col">
          <h1 className="text-base font-semibold tracking-tight">
            AI cost &amp; usage
          </h1>
          <p className="text-xs text-muted-foreground">
            Costos, latencias y cache hit rate de las generaciones IA en esta
            organización. Fase 7 lanza con mock adapter; los tokens y costos
            son estimados hasta el cutover real en Fase 11.
          </p>
        </div>
      </header>

      <div className="px-6 py-3">
        <AiGenerationsKpiCards kpis={kpis} />
      </div>

      <AiGenerationsFilterBar filters={filters} />

      <AiGenerationsTable generations={generations} />
    </div>
  );
}
