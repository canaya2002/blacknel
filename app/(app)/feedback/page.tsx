import { Bell } from 'lucide-react';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { UpgradePrompt } from '@/components/common/upgrade-prompt';
import { requireUser } from '@/lib/auth/server';
import { getOrgPlanCode } from '@/lib/queries/plan';

const PLAN_RANK = { standard: 0, growth: 1, enterprise: 2 } as const;

export default async function FeedbackPage(): Promise<React.ReactElement> {
  const session = await requireUser();
  const plan = await getOrgPlanCode(session);
  const gated = PLAN_RANK[plan] < PLAN_RANK.growth;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Feedback"
        description="Campañas de NPS, CSAT y CES por email, SMS o WhatsApp. Los promoters se enrutan automáticamente a pedir una reseña pública; los detractors escalan a soporte."
      />
      {gated ? (
        <UpgradePrompt
          unlocksOn="growth"
          feature="NPS / CSAT"
          description="Las encuestas y el enrutado automático de promoters / detractors se incluyen desde el plan Growth."
        />
      ) : (
        <EmptyState
          icon={Bell}
          title="Aún no tienes campañas de feedback"
          description="Lanza una NPS o CSAT a tu base de clientes, recoge la respuesta vía email o WhatsApp, y deja que Blacknel rute los promoters al review request y los detractors a una escalada interna. Cada respuesta se conecta con la marca, la ubicación y el agente que atendió."
          primary={{
            label: 'Lanzar primera encuesta',
            disabledReason: 'El módulo NPS completo aterriza en la Fase 9',
          }}
        />
      )}
    </div>
  );
}
