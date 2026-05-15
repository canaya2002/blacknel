import { Swords } from 'lucide-react';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { UpgradePrompt } from '@/components/common/upgrade-prompt';
import { requireUser } from '@/lib/auth/server';
import { getOrgPlanCode } from '@/lib/queries/plan';

const PLAN_RANK = { standard: 0, growth: 1, enterprise: 2 } as const;

export default async function CompetitorsPage(): Promise<React.ReactElement> {
  const session = await requireUser();
  const plan = await getOrgPlanCode(session);
  const gated = PLAN_RANK[plan] < PLAN_RANK.growth;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Competitors"
        description="Snapshots diarios de tus competidores: followers, engagement, rating, share of voice y oportunidades detectadas por IA. Hasta tres en Growth, ilimitados en Enterprise."
      />
      {gated ? (
        <UpgradePrompt
          unlocksOn="growth"
          feature="Competitor tracking"
          description="Benchmarking básico en Growth, análisis con IA y detección de oportunidades en Enterprise."
        />
      ) : (
        <EmptyState
          icon={Swords}
          title="Aún no sigues a ningún competidor"
          description="Registra los handles de tus competidores y Blacknel toma snapshots diarios de sus métricas públicas. Compara seguidores, tasa de engagement, frecuencia de publicación y promedio de rating; descubre formatos que les funcionan y temas que generan respuestas."
          primary={{
            label: 'Agregar competidor',
            disabledReason: 'Competitor tracking aterriza en la Fase 9 (básico) y Fase 10 (avanzado)',
          }}
        />
      )}
    </div>
  );
}
