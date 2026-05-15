import { Headphones } from 'lucide-react';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { UpgradePrompt } from '@/components/common/upgrade-prompt';
import { requireUser } from '@/lib/auth/server';
import { getOrgPlanCode } from '@/lib/queries/plan';

const PLAN_RANK = { standard: 0, growth: 1, enterprise: 2 } as const;

export default async function ListeningPage(): Promise<React.ReactElement> {
  const session = await requireUser();
  const plan = await getOrgPlanCode(session);
  const gated = PLAN_RANK[plan] < PLAN_RANK.growth;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Social Listening"
        description="Monitor de menciones de marca, temas, hashtags y competidores en redes sociales, foros, blogs y prensa. Boolean queries, sentimiento por mención, alertas por volumen y share of voice."
      />
      {gated ? (
        <UpgradePrompt
          unlocksOn="growth"
          feature="Social Listening"
          description="Listening básico (keywords + sentimiento) en Growth, boolean queries y monitoreo de prensa en Enterprise."
        />
      ) : (
        <EmptyState
          icon={Headphones}
          title="Crea tu primer topic de listening"
          description="Define las palabras clave que quieres rastrear (tu marca, productos, competidores, hashtags de campaña) y recibe cada mención con su sentimiento, fuente, alcance estimado y enlace al post original. Genera alertas cuando el volumen sube o el sentimiento se voltea."
          primary={{
            label: 'Crear topic',
            disabledReason: 'Listening completo aterriza en la Fase 9 (básico) y Fase 10 (avanzado)',
          }}
        />
      )}
    </div>
  );
}
